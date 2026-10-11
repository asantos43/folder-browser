import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'
import { builtinKeyCommands } from '../core/commands/builtin.ts'
import { effectiveKeyTable, setEffectiveKeyTable } from '../core/keys/effective.ts'
import { KeySchemes, type KeyPackage, type SchemeSelection } from '../core/keys/schemes.ts'
import { parseUserKeys, validateUserKeys, USER_KEYS_LIMIT, type KeysSnapshot, type KeysResult, type KeysPortableResult } from '../core/keys/user.ts'
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
  private schemes = new KeySchemes()
  private original = '[]'
  private broadcastPending = false
  private batching = false
  private batchChanged = false
  private subscribers = new Set<() => void>()
  private commands() { return this.schemes.compose(builtinKeyCommands, [], this.mac).commands }
  private parse(text: string): KeysSnapshot {
    this.original = text
    return parseUserKeys(text, this.commands(), this.mac)
  }
  /** Host-only lifecycle API: synchronous in-memory rebuild, one notification per batch. */
  setPlugin(owner: string, value: KeyPackage): void { this.schemes.set(owner, value); this.recompose() }
  removePlugin(owner: string): void { this.schemes.remove(owner); this.recompose() }
  selectScheme(selection?: SchemeSelection): void { this.schemes.select(selection); this.recompose() }
  listSchemes() { return this.schemes.list() }
  /** Effective, detached entries for the renderer generation, with user precedence. */
  resolvedEntries() { return effectiveKeyTable(this.mac).entries() }
  subscribe(listener: () => void): () => void { this.subscribers.add(listener); return () => { this.subscribers.delete(listener) } }
  /** No disk IO. Failed batches restore composition and discard their callbacks. */
  transaction(operation: () => void, enqueue: (listener: () => void) => void): void {
    if (this.batching) throw new Error('Nested keys transaction')
    const schemes = this.schemes.fork(), snapshot = this.snapshot, table = effectiveKeyTable(this.mac), previews = new Map(this.previews)
    this.batching = true; this.batchChanged = false
    try { operation() } catch (error) {
      this.schemes = schemes; this.snapshot = snapshot; this.previews = previews; setEffectiveKeyTable(table, this.mac)
      throw error
    } finally { this.batching = false }
    if (this.batchChanged) {
      this.broadcastPending = false
      enqueue(() => { if (!this.disposed) this.broadcast() })
    }
    this.batchChanged = false
  }
  private recompose(): void {
    if (this.disposed) return
    this.previews.clear()
    this.update(parseUserKeys(this.original, this.commands(), this.mac))
    if (this.batching) { this.batchChanged = true; return }
    if (this.broadcastPending) return
    this.broadcastPending = true
    queueMicrotask(() => {
      if (!this.broadcastPending) return
      this.broadcastPending = false
      if (!this.disposed) this.broadcast()
    })
  }
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
          this.snapshot = this.parse(buffer.toString('utf8', 0, size))
        } finally { fs.closeSync(fd) }
      }
    } catch (error) { this.original = '{'; this.snapshot = this.failure(String(error)) }
    this.update(this.snapshot)
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
      await atomicWrite(file, this.original)
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
      const snapshot = parseUserKeys(json, this.commands(), this.mac)
      // Structural errors cannot be confirmed as an empty replacement.
      if (snapshot.warnings.some(warning => warning.entry === -1)) return { error: snapshot.warnings[0].message }
      await this.flush()
      if (this.requests.get(event.sender) !== token) return { error: 'Import preview superseded' }
      this.previews.set(event.sender, { token, snapshot, before: JSON.stringify(this.snapshot.entries) })
      return { token, preview: { ...snapshot, conflicts: this.schemes.compose(builtinKeyCommands, snapshot.entries, this.mac).conflicts } }
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
    try { parsed = validateUserKeys(value, this.commands(), this.mac) } catch { parsed = this.failure('Invalid keybindings') }
    if (parsed.warnings.length) return Promise.resolve({ ok: false, warnings: parsed.warnings })
    const write = this.writes.then(async () => {
      const text = `${JSON.stringify(parsed.entries, null, 2)}\n`
      await atomicWrite(this.file, text)
      if (!this.disposed) this.publish(this.parse(text))
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
        snapshot = this.parse(buffer.toString('utf8', 0, bytesRead))
      } finally { await handle.close() }
    } catch (error) {
      this.original = '{'
      snapshot = (error as NodeJS.ErrnoException).code === 'ENOENT' ? this.parse('[]') : this.failure(String(error))
    }
    if (!this.disposed) this.publish(snapshot)
  }
  private publish(snapshot: KeysSnapshot): void {
    this.update(snapshot)
    this.broadcast()
  }
  private update(snapshot: KeysSnapshot): void {
    const merged = this.schemes.compose(builtinKeyCommands, snapshot.entries, this.mac)
    this.snapshot = { entries: snapshot.entries, warnings: [...snapshot.warnings, ...merged.warnings] }
    setEffectiveKeyTable(merged.table, this.mac)
  }
  private broadcast(): void {
    for (const subscriber of this.subscribers) { try { subscriber() } catch { /* Continue notifying other readers. */ } }
    try { this.changed() } catch { /* A subscriber cannot undo a committed catalog. */ }
    for (const win of this.windows()) if (!win.isDestroyed() && win.webContents.getURL().startsWith('fb-ui://')) {
      try { win.webContents.send('fb:keys-changed', this.snapshot) } catch { /* A closing window must not abort publication. */ }
    }
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
    this.subscribers.clear()
  }
}
