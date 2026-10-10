import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'
import { builtinKeyCommands } from '../core/commands/builtin.ts'
import { setUserKeys } from '../core/keys/effective.ts'
import { mergeUserKeys, parseUserKeys, validateUserKeys, USER_KEYS_LIMIT, type KeysSnapshot, type KeysResult, type KeysPortableResult } from '../core/keys/user.ts'
import { atomicWrite, jsonDialogs, readBoundedJson, type SettingsDialogs } from './settings-host.ts'
import { setKeyRecording } from './shortcuts.ts'

type SyncEvent = Pick<IpcMainEvent, 'sender' | 'senderFrame'> & { returnValue?: unknown }
export class KeysHost {
  readonly file: string
  snapshot: KeysSnapshot = { entries: [], warnings: [] }
  private watcher?: fs.FSWatcher
  private timer?: ReturnType<typeof setTimeout>
  private writes = Promise.resolve()
  private disposed = false
  private listeners: Array<[string, (...args: any[]) => void]> = []
  private ipc: Pick<IpcMain, 'on' | 'removeListener' | 'handle' | 'removeHandler'>
  private channels: string[] = []
  private previews = new Map<SyncEvent['sender'], { token: number; snapshot: KeysSnapshot; before: string }>()
  private sequence = 0
  private requests = new Map<SyncEvent['sender'], number>()
  private windows: () => readonly BrowserWindow[]
  private mac: boolean
  private changed: () => void
  private dialogs: SettingsDialogs
  constructor(userData: string, ipc: Pick<IpcMain, 'on' | 'removeListener' | 'handle' | 'removeHandler'>, windows: () => readonly BrowserWindow[], mac = process.platform === 'darwin', changed: () => void = () => {}, dialogs: SettingsDialogs = jsonDialogs('keybindings.json')) {
    this.ipc = ipc; this.windows = windows; this.mac = mac; this.changed = changed
    this.dialogs = dialogs
    this.file = path.join(userData, 'keybindings.json')
    // Missing file: one existence check, no read/stat and no table reconstruction.
    try {
      if (fs.existsSync(this.file)) {
        const fd = fs.openSync(this.file, 'r')
        try {
          const buffer = Buffer.alloc(USER_KEYS_LIMIT + 1)
          const size = fs.readSync(fd, buffer, 0, buffer.length, 0)
          this.snapshot = size > USER_KEYS_LIMIT ? this.failure('Keybindings exceed 256 KB') : parseUserKeys(buffer.toString('utf8', 0, size), builtinKeyCommands, mac)
        } finally { fs.closeSync(fd) }
      }
    } catch (error) { this.snapshot = this.failure(String(error)) }
    setUserKeys(this.snapshot.entries, this.mac)
    // Watch the directory: atomic replacement, creation and deletion all reload.
    try {
      this.watcher = fs.watch(userData, (_event, filename) => {
        if (filename !== null && filename.toString() !== 'keybindings.json') return
        clearTimeout(this.timer)
        this.timer = setTimeout(() => { void this.reload() }, 200)
      })
      this.watcher.on('error', error => { this.snapshot.warnings.push({ entry: -1, message: String(error) }) })
    } catch (error) { this.snapshot.warnings.push({ entry: -1, message: String(error) }) }
  }
  private failure(message: string): KeysSnapshot { return { entries: [], warnings: [{ entry: -1, message }] } }
  private validSender(event: SyncEvent): boolean {
    return this.windows().some(win => win.webContents === event.sender) && event.senderFrame === event.sender.mainFrame && !!event.senderFrame?.url.startsWith('fb-ui://')
  }
  register(): void {
    const recording = (event: SyncEvent, active: unknown) => {
      event.returnValue = false
      if (!this.validSender(event) || typeof active !== 'boolean') return
      setKeyRecording(event.sender, active)
      event.returnValue = true
    }
    this.ipc.on('fb:keys-recording', recording); this.listeners.push(['fb:keys-recording', recording])
    const get = (event: SyncEvent) => { event.returnValue = this.validSender(event) ? this.snapshot : this.failure('refused') }
    this.ipc.on('fb:keys-get', get); this.listeners.push(['fb:keys-get', get])
    const handle = (channel: string, action: (event: SyncEvent, args: unknown[]) => Promise<KeysPortableResult>) => {
      this.channels.push(channel)
      this.ipc.handle(channel, async (event, ...args: unknown[]) => {
        if (!this.validSender(event)) return { error: 'refused' }
        try { return await action(event, args) } catch (error) { return { error: String(error) } }
      })
    }
    handle('fb:keys-set', async (_event, args) => args.length === 1 ? this.save(args[0]) : { ok: false, warnings: [{ entry: -1, message: 'Invalid arguments' }] })
    handle('fb:keys-export', async (event, args) => {
      if (args.length) return { error: 'Invalid arguments' }
      const file = await this.dialogs.save(this.windows().find(win => win.webContents === event.sender)!)
      if (!file) return { canceled: true }
      await this.flush()
      await atomicWrite(file, `${JSON.stringify(this.snapshot.entries, null, 2)}\n`)
      return { ok: true, warnings: [] }
    })
    handle('fb:keys-import-preview', async (event, args) => {
      this.previews.delete(event.sender)
      const token = ++this.sequence
      this.requests.set(event.sender, token)
      if (args.length) return { error: 'Invalid arguments' }
      const file = await this.dialogs.open(this.windows().find(win => win.webContents === event.sender)!)
      if (!file) return { canceled: true }
      const json = await readBoundedJson(file, USER_KEYS_LIMIT, 'Keybindings exceed 256 KB')
      const snapshot = parseUserKeys(json, builtinKeyCommands, this.mac)
      // Structural errors cannot be confirmed as an empty replacement.
      if (snapshot.warnings.some(warning => warning.entry === -1)) return { error: snapshot.warnings[0].message }
      await this.flush()
      if (this.requests.get(event.sender) !== token) return { error: 'Import preview superseded' }
      this.previews.set(event.sender, { token, snapshot, before: JSON.stringify(this.snapshot.entries) })
      return { token, preview: { ...snapshot, conflicts: mergeUserKeys(builtinKeyCommands, snapshot.entries, this.mac).conflicts } }
    })
    handle('fb:keys-import-apply', async (event, args) => {
      const [token, confirmed] = args
      if (args.length !== 2 || typeof token !== 'number' || confirmed !== true) return { error: 'Confirmation required' }
      const pending = this.previews.get(event.sender)
      if (!pending || pending.token !== token) return { error: 'No matching import preview' }
      await this.flush()
      if (this.previews.get(event.sender) !== pending) return { error: 'No matching import preview' }
      if (pending.before !== JSON.stringify(this.snapshot.entries)) return { error: 'Keys changed; preview again' }
      this.previews.delete(event.sender)
      return this.save(pending.snapshot.entries)
    })
  }
  private save(value: unknown): Promise<KeysResult> {
    let parsed: KeysSnapshot
    try { parsed = validateUserKeys(value, builtinKeyCommands, this.mac) } catch { parsed = this.failure('Invalid keybindings') }
    if (parsed.warnings.length) return Promise.resolve({ ok: false, warnings: parsed.warnings })
    const write = this.writes.then(async () => {
      await atomicWrite(this.file, `${JSON.stringify(parsed.entries, null, 2)}\n`)
      if (!this.disposed) this.publish(parsed)
    })
    this.writes = write.catch(() => {})
    return write.then(() => ({ ok: true, warnings: [] }), error => ({ ok: false, warnings: [{ entry: -1, message: String(error) }] }))
  }
  async flush(): Promise<void> { await this.writes }
  private async reload(): Promise<void> {
    let snapshot: KeysSnapshot
    try {
      // Bound the read even if the file grows between opening and reading it.
      const handle = await fsp.open(this.file, 'r')
      try {
        const buffer = Buffer.alloc(USER_KEYS_LIMIT + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        snapshot = bytesRead > USER_KEYS_LIMIT ? this.failure('Keybindings exceed 256 KB') : parseUserKeys(buffer.toString('utf8', 0, bytesRead), builtinKeyCommands, this.mac)
      } finally { await handle.close() }
    } catch (error) {
      snapshot = (error as NodeJS.ErrnoException).code === 'ENOENT' ? { entries: [], warnings: [] } : this.failure(String(error))
    }
    if (!this.disposed) this.publish(snapshot)
  }
  private publish(snapshot: KeysSnapshot): void {
    this.snapshot = snapshot
    setUserKeys(snapshot.entries, this.mac)
    this.changed()
    for (const win of this.windows()) if (!win.isDestroyed() && win.webContents.getURL().startsWith('fb-ui://')) win.webContents.send('fb:keys-changed', snapshot)
  }
  dispose(): void {
    for (const win of this.windows()) if (!win.isDestroyed()) setKeyRecording(win.webContents, false)
    this.disposed = true
    clearTimeout(this.timer)
    this.watcher?.close()
    for (const [channel, listener] of this.listeners) this.ipc.removeListener(channel, listener)
    this.listeners = []
    for (const channel of this.channels) this.ipc.removeHandler(channel)
    this.channels = []; this.previews.clear(); this.requests.clear()
  }
}
