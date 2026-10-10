import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { KeysHost } from './keys-host.ts'
import { setUserKeys } from '../core/keys/effective.ts'
import { installShortcuts } from './shortcuts.ts'

const hosts: KeysHost[] = [], dirs: string[] = []
const binding = [{ key: 'Mod+Alt+J', command: 'toggleSideBar' }]
function make(seed?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-keys-')); dirs.push(dir)
  const file = path.join(dir, 'keybindings.json')
  if (seed !== undefined) fs.writeFileSync(file, seed)
  const handlers = new Map<string, (...args: any[]) => any>()
  const frame = { url: 'fb-ui://app/index.html' }
  const sender = Object.assign(new EventEmitter(), { mainFrame: frame, getURL: () => frame.url, send: vi.fn() })
  const win = { webContents: sender, isDestroyed: () => false } as any
  const host = new KeysHost(dir, { on: (channel: string, cb: (...args: any[]) => void) => { handlers.set(channel, cb) }, removeListener: vi.fn(), handle: (channel: string, cb: (...args: any[]) => any) => { handlers.set(channel, cb) }, removeHandler: vi.fn() } as any, () => [win], false)
  hosts.push(host); host.register()
  return { host, file, handlers, sender, frame, win, event: { sender, senderFrame: frame, returnValue: null } as any }
}
afterEach(() => { for (const host of hosts.splice(0)) host.dispose(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); setUserKeys([], false) })

it('missing file costs only one existence check, no read or stat', () => {
  const exists = vi.spyOn(fs, 'existsSync'), read = vi.spyOn(fs, 'readSync'), stat = vi.spyOn(fs, 'statSync')
  const x = make()
  expect(exists).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled()
  expect(x.host.snapshot).toEqual({ entries: [], warnings: [] })
})
it('preserves corrupt files, rejects child/foreign IPC and writes valid entries atomically', async () => {
  const x = make('{broken')
  expect(x.host.snapshot.warnings).toHaveLength(1)
  expect(fs.readFileSync(x.file, 'utf8')).toBe('{broken')
  const set = x.handlers.get('fb:keys-set')!, get = x.handlers.get('fb:keys-get')!
  expect(await set({ ...x.event, senderFrame: { url: 'fb-ui://app/child' } }, binding)).toEqual({ error: 'refused' })
  expect(await set({ ...x.event, sender: {} }, binding)).toEqual({ error: 'refused' })
  expect(await set(x.event, [{ key: 'Mod+V', command: 'toggleSideBar' }])).toMatchObject({ ok: false })
  expect(await set(x.event, binding, 'extra')).toMatchObject({ ok: false })
  expect(fs.readFileSync(x.file, 'utf8')).toBe('{broken')
  expect(await set(x.event, binding)).toEqual({ ok: true, warnings: [] })
  expect(JSON.parse(fs.readFileSync(x.file, 'utf8'))).toEqual(binding)
  expect(fs.readdirSync(path.dirname(x.file))).toEqual(['keybindings.json'])
  get(x.event); expect(x.event.returnValue.entries).toEqual(binding)
  const foreign = { ...x.event, senderFrame: { url: 'wsnp://page/' }, returnValue: null }
  get(foreign); expect(foreign.returnValue.entries).toEqual([]); expect(foreign.returnValue.warnings[0].message).toBe('refused')
  expect(x.sender.send).toHaveBeenCalledWith('fb:keys-changed', { entries: binding, warnings: [] })
})
it('reloads creation, atomic replacement and deletion after 200 ms through the real watcher', async () => {
  const x = make()
  fs.writeFileSync(x.file, JSON.stringify(binding))
  await vi.waitFor(() => expect(x.host.snapshot.entries).toEqual(binding), { timeout: 2000 })
  const replacement = [{ key: 'Mod+Alt+L', command: 'toggleHidden' }]
  fs.writeFileSync(`${x.file}.tmp`, JSON.stringify(replacement)); fs.renameSync(`${x.file}.tmp`, x.file)
  await vi.waitFor(() => expect(x.host.snapshot.entries).toEqual(replacement), { timeout: 2000 })
  fs.unlinkSync(x.file)
  await vi.waitFor(() => expect(x.host.snapshot.entries).toEqual([]), { timeout: 2000 })
})
it('the main bridge forwards user keys, leaves removals and conditional chords alone', () => {
  const x = make(JSON.stringify([...binding, { key: 'Mod+B', command: '-toggleSideBar' }, { key: 'Mod+Alt+L', command: 'toggleHidden', when: 'hasEditor' }]))
  installShortcuts(x.win, false)
  const press = (key: string, alt = false) => {
    const event = { preventDefault: vi.fn() }
    x.sender.emit('before-input-event', event, { type: 'keyDown', key, control: true, alt, meta: false, shift: false })
    return event.preventDefault
  }
  expect(press('j', true)).toHaveBeenCalledOnce()
  expect(x.sender.send).toHaveBeenCalledWith('fb:command', 'toggleSideBar')
  x.sender.send.mockClear()
  expect(press('b')).not.toHaveBeenCalled()
  expect(press('l', true)).not.toHaveBeenCalled()
  expect(x.sender.send).not.toHaveBeenCalled()
})
it('recording suspends native forwarding only for a validated top frame and resumes afterwards', () => {
  const x = make(JSON.stringify(binding))
  installShortcuts(x.win, false)
  const record = x.handlers.get('fb:keys-recording')!
  const press = () => {
    const event = { preventDefault: vi.fn() }
    x.sender.emit('before-input-event', event, { type: 'keyDown', key: 'j', control: true, alt: true, shift: false, meta: false })
    return event.preventDefault
  }
  record({ ...x.event, senderFrame: { url: 'fb-ui://app/child' } }, true)
  expect(press()).toHaveBeenCalledOnce()
  record(x.event, 'true'); expect(press()).toHaveBeenCalledOnce()
  record(x.event, true); expect(x.event.returnValue).toBe(true)
  x.sender.send.mockClear(); expect(press()).not.toHaveBeenCalled(); expect(x.sender.send).not.toHaveBeenCalled()
  record(x.event, false); expect(press()).toHaveBeenCalledOnce()
})
it('a reload or crash of the interface while recording resumes the native shortcuts, and no listener piles up', () => {
  const x = make(JSON.stringify(binding))
  installShortcuts(x.win, false)
  const record = x.handlers.get('fb:keys-recording')!
  const press = () => {
    const event = { preventDefault: vi.fn() }
    x.sender.emit('before-input-event', event, { type: 'keyDown', key: 'j', control: true, alt: true, shift: false, meta: false })
    return event.preventDefault
  }
  for (const gone of ['did-navigate', 'render-process-gone']) {
    record(x.event, true); expect(press()).not.toHaveBeenCalled()
    x.sender.emit(gone); expect(press()).toHaveBeenCalledOnce()
  }
  for (let i = 0; i < 20; i++) { record(x.event, true); record(x.event, false) }
  expect(x.sender.listenerCount('did-navigate')).toBe(0); expect(x.sender.listenerCount('render-process-gone')).toBe(0)
})
