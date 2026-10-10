import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'
import { builtinKeyCommands } from '../core/commands/builtin.ts'
import { setUserKeys } from '../core/keys/effective.ts'
import { parseUserKeys, validateUserKeys, USER_KEYS_LIMIT, type KeysSnapshot } from '../core/keys/user.ts'
import { atomicWrite } from './settings-host.ts'

type SyncEvent = Pick<IpcMainEvent, 'sender' | 'senderFrame' | 'returnValue'>
export class KeysHost {
  readonly file: string
  snapshot: KeysSnapshot = { entries: [], warnings: [] }
  private watcher?: fs.FSWatcher
  private timer?: ReturnType<typeof setTimeout>
  private writes = Promise.resolve()
  private disposed = false
  private listeners: Array<[string, (...args: any[]) => void]> = []
  private ipc: Pick<IpcMain, 'on' | 'removeListener'>
  private windows: () => readonly BrowserWindow[]
  private mac: boolean
  private changed: () => void
  constructor(userData: string, ipc: Pick<IpcMain, 'on' | 'removeListener'>, windows: () => readonly BrowserWindow[], mac = process.platform === 'darwin', changed: () => void = () => {}) {
    this.ipc = ipc; this.windows = windows; this.mac = mac; this.changed = changed
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
    const get = (event: SyncEvent) => { event.returnValue = this.validSender(event) ? this.snapshot : this.failure('refused') }
    const set = (event: SyncEvent, value: unknown) => {
      if (!this.validSender(event)) return
      let parsed: KeysSnapshot
      try { parsed = validateUserKeys(value, builtinKeyCommands, this.mac) } catch { return }
      if (parsed.warnings.length) return
      // Serial writes avoid an older request replacing a newer one.
      this.writes = this.writes.then(async () => {
        await atomicWrite(this.file, `${JSON.stringify(parsed.entries, null, 2)}\n`)
        if (!this.disposed) this.publish(parsed)
      }).catch(error => { if (!this.disposed) this.publish({ ...this.snapshot, warnings: [{ entry: -1, message: String(error) }] }) })
    }
    for (const [channel, listener] of [['fb:keys-get', get], ['fb:keys-set', set]] as const) { this.ipc.on(channel, listener); this.listeners.push([channel, listener]) }
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
    this.disposed = true
    clearTimeout(this.timer)
    this.watcher?.close()
    for (const [channel, listener] of this.listeners) this.ipc.removeListener(channel, listener)
    this.listeners = []
  }
}
