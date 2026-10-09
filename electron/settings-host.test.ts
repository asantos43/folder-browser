import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsHost, flushBeforeQuit } from './settings-host.ts'

const dirs: string[] = []
const make = (seed?: string, writer = vi.fn(async (_contents: string) => {})) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-settings-')); dirs.push(dir)
  if (seed !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), seed)
  const handlers = new Map<string, (...args: any[]) => void>()
  const ipc = { on: (channel: string, cb: (...args: any[]) => void) => handlers.set(channel, cb), removeListener: vi.fn() }
  const sent: unknown[][] = []
  const frame = { url: 'fb-ui://app/index.html' }
  const sender: any = { mainFrame: frame, getURL: () => frame.url, send: vi.fn((channel: string, ...args: unknown[]) => sent.push([channel, ...args])) }
  const win = { webContents: sender, isDestroyed: () => false } as any
  const host = new SettingsHost(dir, ipc as any, () => [win], writer)
  host.register()
  const sync = handlers.get('fb:settings-get-all')!
  const set = handlers.get('fb:settings-set')!
  return { dir, handlers, host, sync, set, sender, frame, win, sent, writer }
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('SettingsHost', () => {
  it('refuses a sender outside the top interface frame', () => {
    const x = make(); const event: any = { sender: x.sender, senderFrame: { url: 'fb-ui://app/child' }, returnValue: null }
    x.sync(event); expect(event.returnValue.notices[0].message).toBe('refused')
    x.set({ sender: x.sender, senderFrame: event.senderFrame }, [['appearance.theme', 'dark']])
    expect(x.host.store.get('appearance.theme')).toBe('auto')
  })
  it('drops unknown and invalid pairs individually, then broadcasts only actual changed keys', () => {
    const x = make(); const event = { sender: x.sender, senderFrame: x.frame }
    x.set(event, [['unknown.key', true], ['appearance.theme', 'bogus'], ['appearance.theme', 'dark'], ['appearance.theme', 'dark']])
    expect(x.host.store.get('appearance.theme')).toBe('dark')
    expect(x.sent).toEqual([['fb:settings-changed', ['appearance.theme']]])
  })
  it('batches up to 100 sets into one disk write and flushes pending data before quit', async () => {
    const x = make(); const pairs = Array.from({ length: 100 }, (_, i) => ['appearance.theme', i % 2 ? 'light' : 'dark'])
    x.set({ sender: x.sender, senderFrame: x.frame }, pairs)
    // 100 separate messages, one per turn of the event loop: still one write.
    for (let i = 0; i < 100; i++) { x.set({ sender: x.sender, senderFrame: x.frame }, [['appearance.theme', i % 2 ? 'dark' : 'light']]); await new Promise(resolve => setImmediate(resolve)) }
    await new Promise(resolve => setTimeout(resolve, 150)); expect(x.writer).toHaveBeenCalledTimes(1)
    x.set({ sender: x.sender, senderFrame: x.frame }, [['appearance.theme', 'auto']])
    let quit: ((event: { preventDefault(): void }) => void) | undefined
    let quitCalls = 0
    flushBeforeQuit({ on: (_event, cb) => { quit = cb }, quit: () => { quitCalls++ } }, x.host)
    let prevented = false; quit!({ preventDefault: () => { prevented = true } })
    await vi.waitFor(() => expect(quitCalls).toBe(1))
    expect(prevented).toBe(true); expect(x.writer).toHaveBeenCalledTimes(2)
  })
  it('waits for an already-running atomic write before quitting', async () => {
    let release!: () => void
    const writer = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const x = make(undefined, writer)
    x.set({ sender: x.sender, senderFrame: x.frame }, [['appearance.theme', 'dark']])
    await new Promise(resolve => setTimeout(resolve, 120)); expect(writer).toHaveBeenCalledTimes(1)
    let quit: ((event: { preventDefault(): void }) => void) | undefined
    let quitCalls = 0
    flushBeforeQuit({ on: (_event, cb) => { quit = cb }, quit: () => { quitCalls++ } }, x.host)
    quit!({ preventDefault: () => {} })
    await Promise.resolve(); expect(quitCalls).toBe(0)
    release(); await vi.waitFor(() => expect(quitCalls).toBe(1))
  })
  it('quits anyway when the final write fails', async () => {
    const x = make(undefined, vi.fn(async () => { throw new Error('disk full') }))
    x.set({ sender: x.sender, senderFrame: x.frame }, [['appearance.theme', 'dark']])
    let quit: ((event: { preventDefault(): void }) => void) | undefined
    let quitCalls = 0
    flushBeforeQuit({ on: (_event, cb) => { quit = cb }, quit: () => { quitCalls++ } }, x.host)
    quit!({ preventDefault: () => {} })
    await vi.waitFor(() => expect(quitCalls).toBe(1))
  })
  it('keeps a corrupt file and warns until a valid setting is changed', async () => {
    const x = make('{broken')
    const event: any = { sender: x.sender, senderFrame: x.frame }; x.sync(event)
    expect(event.returnValue.values['appearance.theme']).toBe('auto'); expect(event.returnValue.notices).toHaveLength(1)
    x.set({ sender: x.sender, senderFrame: x.frame }, [['unknown.key', 1], ['appearance.theme', 'bogus'], ['appearance.theme', 'auto']])
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(x.writer).not.toHaveBeenCalled()
    expect(fs.readFileSync(path.join(x.dir, 'settings.json'), 'utf8')).toBe('{broken')
    x.set({ sender: x.sender, senderFrame: x.frame }, [['appearance.theme', 'dark']]); await x.host.flush()
    expect(x.writer).toHaveBeenCalledTimes(1)
  })
  it('uses a fixed settings.json path and answers 1,000-key get-all under 5 ms median of 20', () => {
    const x = make(); expect(x.host.file).toBe(path.join(x.dir, 'settings.json'))
    for (let i = 0; i < 1000; i++) x.host.registry.defineSetting({ id: `bench.group${i}.value`, type: 'boolean', default: false, category: 'bench', label: null })
    const times: number[] = []
    for (let i = 0; i < 20; i++) { const event: any = { sender: x.sender, senderFrame: x.frame, returnValue: null }; const start = performance.now(); x.sync(event); times.push(performance.now() - start) }
    times.sort((a, b) => a - b); const median = (times[9] + times[10]) / 2; console.info(`settings get-all 1,000 keys median: ${median.toFixed(3)} ms`); expect(median).toBeLessThan(5)
  })
})
