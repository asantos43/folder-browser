import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { absoluteProgram, validProgram, buildInvocation, normalizeCommands, type Invocation, type RunCommand } from '../core/run.ts'
import type { RootRegistry } from '../core/roots.ts'
import { stageFile, removeStaged } from '../core/stage.ts'
import { atomicWrite } from './settings-host.ts'
import { UI_ORIGIN } from './ui-protocol.ts'

export type RunResult = { opened: true; chooser: true } | { opened: false; reason: 'cancelled' | 'error' | 'no-file'; message?: string }
export type ConfirmRun = (win: BrowserWindow, command: RunCommand, invocation: Invocation) => Promise<{ execute: boolean; always: boolean }>
export const commandHash = (command: RunCommand): string => createHash('sha256').update(JSON.stringify([command.program, command.args, command.cwd ?? null])).digest('hex')
const CONFIRMED_LIMIT = 32 * 1024

/** Ignore empty/relative PATH entries: a bare program must never resolve through cwd. */
export async function resolveProgram(program: string, env = process.env): Promise<string> {
  if (!validProgram(program)) throw new Error('Use an absolute program path or a PATH name')
  if (absoluteProgram(program)) {
    if (!nativeAbsolute(program)) throw new Error('Program path is not absolute on this system')
    return program
  }
  const search = env.PATH ?? env.Path ?? ''
  const extensions = process.platform === 'win32' && !path.extname(program) ? (env.PATHEXT ?? '.EXE;.COM').split(';').filter(ext => /^\.[a-z0-9]+$/i.test(ext)) : ['']
  for (const dir of search.split(path.delimiter).filter(dir => path.isAbsolute(dir))) {
    for (const ext of extensions) {
      const file = path.join(dir, program + ext)
      try { await fs.access(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); if ((await fs.stat(file)).isFile()) return file } catch { /* Try the next PATH directory. */ }
    }
  }
  throw new Error(`Program not found in PATH: ${program}`)
}
const nativeAbsolute = (file: string): boolean => path.isAbsolute(file) && (process.platform !== 'win32' || /^[a-z]:[\\/]|^\\\\[^\\]+\\[^\\]+/i.test(file))

/** Resolve only once started, report launch errors, and keep the optional kill timer off the event loop. */
export async function startInvocation(invocation: Invocation, timeoutMs?: number): Promise<RunResult> {
  try {
    const program = await resolveProgram(invocation.program)
    return await new Promise<RunResult>(resolve => {
      const child = spawn(program, invocation.args, { shell: false, detached: true, stdio: 'ignore', cwd: invocation.cwd })
      let timer: ReturnType<typeof setTimeout> | undefined
      child.once('error', error => { if (timer) clearTimeout(timer); resolve({ opened: false, reason: 'error', message: error.message }) })
      child.once('exit', () => { if (timer) clearTimeout(timer) })
      child.once('spawn', () => {
        if (timeoutMs !== undefined) { timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs); timer.unref() }
        child.unref()
        resolve({ opened: true, chooser: true })
      })
    })
  } catch (error) { return { opened: false, reason: 'error', message: error instanceof Error ? error.message : 'Could not start program' } }
}

const nativeConfirm: ConfirmRun = async (win, command, invocation) => {
  const { dialog, app } = await import('electron')
  const pt = app.getLocale().toLowerCase().startsWith('pt')
  const result = await dialog.showMessageBox(win, {
    type: 'warning', title: command.name,
    message: pt ? 'Executar este comando com suas permissões?' : 'Run this command with your permissions?',
    // JSON escaping keeps newlines/control characters visible; one indexed row for every literal argument.
    detail: [JSON.stringify(invocation.program), ...invocation.args.map((arg, i) => `[${i}] ${JSON.stringify(arg)}`), ...(invocation.cwd ? [`cwd: ${JSON.stringify(invocation.cwd)}`] : [])].join('\n'),
    buttons: pt ? ['Cancelar', 'Executar'] : ['Cancel', 'Run'], defaultId: 0, cancelId: 0,
    checkboxLabel: pt ? 'Sempre para este comando' : 'Always for this command', checkboxChecked: false,
  })
  return { execute: result.response === 1, always: result.checkboxChecked }
}

/** Configuration and authorised roots are owned by the main process. No renderer-supplied executable. */
export class RunHost {
  private confirmed = new Map<string, string>()
  private loaded: Promise<void> | undefined
  private busy = false
  private readonly file: string
  private roots: RootRegistry
  private configuration: () => unknown
  private keepCopy: (dir: string) => void
  private confirm: ConfirmRun
  private cachedValue: unknown
  private cachedCommands: RunCommand[] = []
  constructor(userData: string, roots: RootRegistry, configuration: () => unknown, keepCopy: (dir: string) => void, confirm: ConfirmRun = nativeConfirm) {
    this.file = path.join(userData, 'run-confirmed.json')
    this.roots = roots; this.configuration = configuration; this.keepCopy = keepCopy; this.confirm = confirm
  }
  commands(): RunCommand[] {
    const value = this.configuration()
    if (value !== this.cachedValue) { this.cachedCommands = normalizeCommands(value).value; this.cachedValue = value }
    return this.cachedCommands
  }
  private load(): Promise<void> {
    return this.loaded ??= (async () => {
      try {
        const handle = await fs.open(this.file, 'r')
        let raw: string
        try { const buffer = Buffer.alloc(CONFIRMED_LIMIT + 1); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); if (bytesRead > CONFIRMED_LIMIT) return; raw = buffer.subarray(0, bytesRead).toString('utf8') } finally { await handle.close() }
        const entries: unknown = JSON.parse(raw)
        if (!Array.isArray(entries) || entries.length > 100) return
        if (!entries.every(item => Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && /^[\w-]{1,128}$/.test(item[0]) && typeof item[1] === 'string' && /^[a-f0-9]{64}$/.test(item[1]))) return
        if (new Set(entries.map(item => item[0])).size !== entries.length) return
        this.confirmed = new Map(entries as Array<[string, string]>)
      } catch { /* Missing or malformed confirmations never grant permission. */ }
    })()
  }
  async run(win: BrowserWindow, request: unknown): Promise<RunResult> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return { opened: false, reason: 'error', message: 'Invalid command request' }
    const v = request as Record<string, unknown>
    if (Object.keys(v).some(key => !['commandId', 'root', 'path'].includes(key)) || typeof v.commandId !== 'string' || v.commandId.length > 128 || typeof v.root !== 'string' || v.root.length > 128 || typeof v.path !== 'string' || v.path.length > 4096 || !v.path || v.path.includes('\0') || v.path.includes('\\') || v.path.startsWith('/') || /^[a-z]:/i.test(v.path) || v.path.split(/[!/]/).some(part => part === '..' || part === '.')) return { opened: false, reason: 'error', message: 'Invalid command request' }
    if (this.busy) return { opened: false, reason: 'error', message: 'A command confirmation is already pending' }
    this.busy = true
    let scratch: string | undefined
    try {
      const command = this.commands().find(command => command.id === v.commandId)
      if (!command || !this.roots.has(v.root)) return { opened: false, reason: 'no-file' }
      const disk = await this.roots.diskFile(v.root, v.path)
      let file = disk
      if (!file) {
        const staged = await stageFile(this.roots, v.root, v.path, os.tmpdir(), { maxBytes: 256 * 2 ** 20 })
        if ('error' in staged) return { opened: false, reason: 'no-file', message: staged.error }
        file = staged.file; scratch = staged.dir
      }
      const invocation = buildInvocation(command, { file, dir: path.dirname(file), name: path.basename(file) })
      if (invocation.cwd && !nativeAbsolute(invocation.cwd)) throw new Error('Working directory must be absolute on this system')
      await this.load()
      const hash = commandHash(command)
      if (this.confirmed.get(command.id) !== hash) {
        const answer = await this.confirm(win, command, invocation)
        if (!answer.execute) return { opened: false, reason: 'cancelled' }
        if (commandHash(this.commands().find(c => c.id === command.id) ?? { ...command, program: '' }) !== hash) return { opened: false, reason: 'error', message: 'Command changed; try again' }
        if (answer.always) {
          // Retain only current commands, so removal cannot grow this file without bound.
          const ids = new Set(this.commands().map(c => c.id))
          const next = new Map([...this.confirmed].filter(([id]) => ids.has(id)))
          next.set(command.id, hash)
          const json = JSON.stringify([...next])
          if (Buffer.byteLength(json) > CONFIRMED_LIMIT) throw new Error('Confirmation file exceeds 32 KB')
          await atomicWrite(this.file, json)
          this.confirmed = next
        }
      }
      const current = this.commands().find(c => c.id === command.id)
      if (!current || commandHash(current) !== hash) return { opened: false, reason: 'error', message: 'Command changed; try again' }
      if (disk && await this.roots.diskFile(v.root, v.path) !== disk) return { opened: false, reason: 'no-file' }
      const result = await startInvocation(invocation, command.timeoutMs)
      if (result.opened && scratch) { this.keepCopy(scratch); scratch = undefined }
      return result
    } catch (error) { return { opened: false, reason: 'error', message: error instanceof Error ? error.message : 'Could not run command' } }
    finally { if (scratch) await removeStaged(scratch).catch(() => {}); this.busy = false }
  }
  register(ipc: Pick<IpcMain, 'handle'>, getWindow: () => BrowserWindow | undefined): void {
    ipc.handle('fb:run-command', (event: IpcMainInvokeEvent, request: unknown, ...extra: unknown[]) => {
      const win = getWindow()
      if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame?.url.startsWith(`${UI_ORIGIN}/`) || extra.length) return { opened: false, reason: 'error', message: 'refused' }
      return this.run(win, request)
    })
  }
}
