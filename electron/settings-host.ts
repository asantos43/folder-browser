import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'
import { builtinSettings } from '../core/settings/builtin.ts'
import { SettingsRegistry } from '../core/settings/registry.ts'
import { SettingsStore, type SettingNotice } from '../core/settings/store.ts'

const UI_ORIGIN = 'fb-ui://'
const MESSAGE_LIMIT = 64 * 1024
const PAIR_LIMIT = 100

type IpcLike = Pick<IpcMain, 'on' | 'removeListener'>
type SyncEvent = Pick<IpcMainEvent, 'sender' | 'senderFrame' | 'returnValue'>
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

  constructor(userData: string, ipc: IpcLike, windows: () => readonly BrowserWindow[], writer?: (contents: string) => Promise<void>) {
    this.ipc = ipc
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
  }

  flush(): Promise<void> {
    if (this.activeFlush) return this.activeFlush
    const pending = this.store.flush().finally(() => { if (this.activeFlush === pending) this.activeFlush = undefined })
    this.activeFlush = pending
    return pending
  }
  dispose(): void { for (const [channel, listener] of this.listeners) this.ipc.removeListener(channel, listener); this.listeners = [] }

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
