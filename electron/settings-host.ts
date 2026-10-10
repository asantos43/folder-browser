import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'
import { builtinSettings } from '../core/settings/builtin.ts'
import { SettingsRegistry } from '../core/settings/registry.ts'
import { SettingsStore, SETTINGS_FILE_LIMIT, type SettingNotice } from '../core/settings/store.ts'
import { exportSettings, previewImport, applyImport, type ImportPreview } from '../core/settings/portable.ts'
import type { SettingsPortableResult } from '../core/api.ts'

const UI_ORIGIN = 'fb-ui://'
const MESSAGE_LIMIT = 64 * 1024
const PAIR_LIMIT = 100

type IpcLike = Pick<IpcMain, 'on' | 'removeListener' | 'handle' | 'removeHandler'>
export interface SettingsDialogs {
  save(win: BrowserWindow): Promise<string | undefined>
  open(win: BrowserWindow): Promise<string | undefined>
  show(file: string): Promise<void>
}
const systemDialogs: SettingsDialogs = {
  async save(win) { const { dialog } = await import('electron'); const result = await dialog.showSaveDialog(win, { defaultPath: 'settings.json', filters: [{ name: 'JSON', extensions: ['json'] }] }); return result.canceled ? undefined : result.filePath },
  async open(win) { const { dialog } = await import('electron'); const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] }); return result.canceled ? undefined : result.filePaths[0] },
  async show(file) { const { shell } = await import('electron'); shell.showItemInFolder(file) },
}
type SyncEvent = Pick<IpcMainEvent, 'sender' | 'senderFrame'> & { returnValue?: unknown }
type Sender = { send(channel: string, ...args: unknown[]): void }

export async function atomicWrite(file: string, contents: string): Promise<void> {
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' })
    await fsp.rename(temporary, file)
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export class SettingsHost {
  readonly store: SettingsStore
  readonly registry: SettingsRegistry
  readonly file: string
  private notices: readonly SettingNotice[] = []
  private listeners: Array<[string, (...args: any[]) => void]> = []
  private mayWrite = true
  private activeFlush: Promise<void> | undefined
  private ipc: IpcLike
  private windows: () => readonly BrowserWindow[]
  private previews = new Map<Sender, { token: number; preview: ImportPreview }>()
  private sequence = 0
  private channels: string[] = []
  private dialogs: SettingsDialogs

  constructor(userData: string, ipc: IpcLike, windows: () => readonly BrowserWindow[], writer?: (contents: string) => Promise<void>, dialogs: SettingsDialogs = systemDialogs) {
    this.ipc = ipc
    this.dialogs = dialogs
    this.windows = windows
    this.file = path.join(userData, 'settings.json')
    this.registry = new SettingsRegistry()
    for (const definition of builtinSettings) this.registry.defineSetting(definition)
    const persist = writer ?? (contents => atomicWrite(this.file, contents))
    this.store = new SettingsStore(this.registry, async contents => { if (this.mayWrite) await persist(contents) }, 100)
    try {
      if (fs.existsSync(this.file)) this.notices = this.store.load(fs.readFileSync(this.file, 'utf8'))
    } catch (error) {
      this.mayWrite = false
      this.notices = [{ id: 'settings.json', message: error instanceof Error ? error.message : 'Invalid settings file' }]
    }
    this.store.subscribe(ids => this.broadcast([...ids]))
  }

  register(): void {
    const validSender = (event: SyncEvent): boolean => {
      const win = this.windows().find(item => item.webContents === event.sender)
      return !!win && event.senderFrame === event.sender.mainFrame && event.senderFrame.url.startsWith(UI_ORIGIN)
    }
    const getAll = (event: SyncEvent) => {
      if (!validSender(event)) { event.returnValue = { values: {}, notices: [{ id: 'settings', message: 'refused' }] }; return }
      event.returnValue = { values: Object.fromEntries(this.store.snapshot()), notices: [...this.notices] }
    }
    const set = (event: { sender: Sender; senderFrame: { url: string } }, pairs: unknown) => {
      if (!validSender(event as SyncEvent)) return
      try { if (!Array.isArray(pairs) || pairs.length > PAIR_LIMIT || Buffer.byteLength(JSON.stringify(pairs)) > MESSAGE_LIMIT) return } catch { return }
      let anyValid = false
      for (const pair of pairs) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') continue
        if (!this.store.snapshot().has(pair[0])) continue
        try { this.store.set(pair[0], pair[1]); anyValid = true } catch { /* Invalid pair is isolated. */ }
      }
      if (!this.mayWrite && anyValid) this.mayWrite = true
    }
    this.listen('fb:settings-get-all', getAll)
    this.listen('fb:settings-set', set)
    this.listen('fb:settings-reset', (event: SyncEvent, ids: unknown) => {
      if (!validSender(event) || !Array.isArray(ids) || ids.length > PAIR_LIMIT) return
      try { if (Buffer.byteLength(JSON.stringify(ids)) > MESSAGE_LIMIT) return } catch { return }
      for (const id of ids) {
        if (typeof id !== 'string' || !this.registry.get(id)) continue
        this.store.reset(id)
        this.mayWrite = true
      }
    })
    const handle = (channel: string, action: (event: SyncEvent, args: unknown[]) => Promise<SettingsPortableResult>) => {
      this.channels.push(channel)
      this.ipc.handle(channel, async (event, ...args: unknown[]) => {
        if (!validSender(event)) return { error: 'refused' }
        try { return await action(event, args) } catch (error) { return { error: error instanceof Error ? error.message : 'Settings operation failed' } }
      })
    }
    const windowFor = (event: SyncEvent) => this.windows().find(win => win.webContents === event.sender)!
    handle('fb:settings-export', async (event, args) => {
      if (args.length) return { error: 'Invalid arguments' }
      const file = await this.dialogs.save(windowFor(event))
      if (!file) return { canceled: true }
      await atomicWrite(file, exportSettings(this.store))
      return { changed: [] }
    })
    handle('fb:settings-import-preview', async (event, args) => {
      this.previews.delete(event.sender)
      if (args.length) return { error: 'Invalid arguments' }
      const ticket = ++this.sequence
      const file = await this.dialogs.open(windowFor(event))
      if (!file) return { canceled: true }
      const reader = await fsp.open(file, 'r')
      let json: string
      try {
        const bytes = Buffer.alloc(SETTINGS_FILE_LIMIT + 1)
        let size = 0
        while (size < bytes.length) {
          const read = await reader.read(bytes, size, bytes.length - size, null)
          if (!read.bytesRead) break
          size += read.bytesRead
        }
        if (size > SETTINGS_FILE_LIMIT) throw new Error('Settings file exceeds 256 KB')
        json = bytes.subarray(0, size).toString('utf8')
      } finally { await reader.close() }
      const preview = previewImport(json, this.registry, this.store)
      this.previews.set(event.sender, { token: ticket, preview })
      return { preview, token: ticket, needsConfirm: preview.changes.some(change => change.needsConfirm) }
    })
    handle('fb:settings-import-apply', async (event, args) => {
      const [token, confirmed, safetyConfirmed] = args
      const pending = this.previews.get(event.sender)
      if (args.length !== 3 || typeof token !== 'number' || confirmed !== true || typeof safetyConfirmed !== 'boolean') return { error: 'Confirmation required' }
      if (!pending || pending.token !== token) return { error: 'No matching import preview' }
      if (pending.preview.changes.some(change => change.needsConfirm) && !safetyConfirmed) return { error: 'Safety confirmation required' }
      // Refuse a stale summary if another control/window changed a value meanwhile.
      if (pending.preview.changes.some(change => !change.reason && JSON.stringify(this.store.get(change.id)) !== JSON.stringify(change.before))) return { error: 'Settings changed; preview again' }
      this.previews.delete(event.sender)
      this.mayWrite = true
      await applyImport(pending.preview, this.store, safetyConfirmed)
      return { changed: pending.preview.changes.filter(change => !change.reason).map(change => change.id) }
    })
    handle('fb:settings-reset-all', async (_event, args) => {
      if (args.length !== 1 || args[0] !== true) return { error: 'Confirmation required' }
      const changed = this.registry.all().filter(def => JSON.stringify(this.store.get(def.id)) !== JSON.stringify(def.default)).map(def => def.id)
      this.previews.clear()
      this.mayWrite = true
      this.store.resetAll()
      await this.flush()
      return { changed }
    })
    handle('fb:settings-show-file', async (_event, args) => {
      if (args.length) return { error: 'Invalid arguments' }
      await this.dialogs.show(this.file)
      return { changed: [] }
    })
  }

  flush(): Promise<void> {
    if (this.activeFlush) return this.activeFlush
    const pending = this.store.flush().finally(() => { if (this.activeFlush === pending) this.activeFlush = undefined })
    this.activeFlush = pending
    return pending
  }
  dispose(): void { for (const [channel, listener] of this.listeners) this.ipc.removeListener(channel, listener); this.listeners = []; for (const channel of this.channels) this.ipc.removeHandler(channel); this.channels = []; this.previews.clear() }

  private listen(channel: string, listener: (...args: any[]) => void): void { this.listeners.push([channel, listener]); this.ipc.on(channel, listener) }
  private broadcast(ids: string[]): void {
    for (const win of this.windows()) {
      if (win.isDestroyed() || !win.webContents.getURL().startsWith(UI_ORIGIN)) continue
      win.webContents.send('fb:settings-changed', ids)
    }
  }
}

export interface QuitApp { on(event: 'before-quit' | 'will-quit', listener: (event: { preventDefault(): void }) => void): void; quit(): void }
export function flushBeforeQuit(app: QuitApp, host: SettingsHost): void {
  let flushing = false
  let done = false
  let finalFlush = false
  // The windows are closed by now: a change a window sent while it was closing has arrived after the first flush and is written before the process ends.
  app.on('will-quit', event => {
    if (finalFlush) return
    event.preventDefault()
    finalFlush = true
    // `quit` inside the event that is already quitting is ignored: it goes in the next turn.
    void host.flush().then(() => undefined, () => undefined).then(() => setImmediate(() => app.quit()))
  })
  app.on('before-quit', event => {
    if (done) return
    event.preventDefault()
    if (flushing) return
    flushing = true
    // A failed write must not trap the user: the app quits anyway.
    void host.flush().then(() => undefined, () => undefined).then(() => { done = true; app.quit() })
  })
}
