import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsHost, flushBeforeQuit, type SettingsDialogs } from './settings-host.ts'

const dirs: string[] = []
const make = (seed?: string, writer = vi.fn(async (_contents: string) => {}), dialogs?: SettingsDialogs) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-settings-')); dirs.push(dir)
  if (seed !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), seed)
  const handlers = new Map<string, (...args: any[]) => void>()
  const ipc = { on: (channel: string, cb: (...args: any[]) => void) => handlers.set(channel, cb), handle: (channel: string, cb: (...args: any[]) => unknown) => handlers.set(channel, cb as any), removeListener: vi.fn(), removeHandler: vi.fn() }
  const sent: unknown[][] = []
  const frame = { url: 'fb-ui://app/index.html' }
  const sender: any = { mainFrame: frame, getURL: () => frame.url, send: vi.fn((channel: string, ...args: unknown[]) => sent.push([channel, ...args])) }
  const win = { webContents: sender, isDestroyed: () => false } as any
  const host = new SettingsHost(dir, ipc as any, () => [win], writer, dialogs)
  host.register()
  const sync = handlers.get('fb:settings-get-all')!
  const set = handlers.get('fb:settings-set')!
  return { dir, handlers, host, sync, set, sender, frame, win, sent, writer }
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('SettingsHost', () => {
  it('resets known ids through the store, rejects child frames and bounded malformed requests', () => {
    const x = make()
    const event = { sender: x.sender, senderFrame: x.frame }
    const reset = x.handlers.get('fb:settings-reset')!
    x.set(event, [['files.showHidden', true]])
    reset({ ...event, senderFrame: { url: 'fb-ui://app/child' } }, ['files.showHidden'])
    reset(event, Array(101).fill('files.showHidden'))
    reset(event, 'files.showHidden')
    expect(x.host.store.get('files.showHidden')).toBe(true)
    reset(event, [null, 'unknown.key', 'files.showHidden'])
    expect(x.host.store.get('files.showHidden')).toBe(false)
    expect(x.sent.at(-1)).toEqual(['fb:settings-changed', ['files.showHidden']])
  })
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
  it('writes a change that arrives after the first flush, when the windows have closed', async () => {
    const x = make()
    const handlers = new Map<string, (event: { preventDefault(): void }) => void>()
    let quitCalls = 0
    flushBeforeQuit({ on: (event, cb) => { handlers.set(event, cb) }, quit: () => { quitCalls++ } }, x.host)
    handlers.get('before-quit')!({ preventDefault: () => {} })
    await vi.waitFor(() => expect(quitCalls).toBe(1))
    expect(x.writer).not.toHaveBeenCalled()
    // A window that was closing sent its last change after that flush.
    x.set({ sender: x.sender, senderFrame: x.frame }, [['appearance.theme', 'dark']])
    let prevented = false; handlers.get('will-quit')!({ preventDefault: () => { prevented = true } })
    await vi.waitFor(() => expect(quitCalls).toBe(2))
    expect(prevented).toBe(true); expect(x.writer).toHaveBeenCalledTimes(1)
    let again = false; handlers.get('will-quit')!({ preventDefault: () => { again = true } })
    expect(again).toBe(false)
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

function portable() {
  let selected: string | undefined
  const dialogs = { save: vi.fn(async () => selected), open: vi.fn(async () => selected), show: vi.fn(async (_file: string) => {}) }
  const x = make(undefined, vi.fn(async contents => { fs.writeFileSync(x.host.file, contents) }), dialogs)
  const event = { sender: x.sender, senderFrame: x.frame }
  const call = (channel: string, ...args: unknown[]): Promise<any> => x.handlers.get(`fb:settings-${channel}`)!(event, ...args) as any
  const choose = (contents?: string) => { selected = path.join(x.dir, 'portable.json'); if (contents !== undefined) fs.writeFileSync(selected, contents); return selected }
  return { ...x, dialogs, call, choose, event }
}

it('portable channels reject non-interface senders and renderer paths before opening dialogs', async () => {
  const x = portable()
  for (const channel of ['export', 'import-preview', 'import-apply', 'reset-all', 'show-file']) {
    const handler = x.handlers.get(`fb:settings-${channel}`)!
    expect(await handler({ ...x.event, senderFrame: { url: 'fb-ui://app/child' } }, true)).toEqual({ error: 'refused' })
    expect(await handler({ ...x.event, sender: {} }, true)).toEqual({ error: 'refused' })
    const original = x.frame.url; x.frame.url = 'https://example.test/'
    expect(await handler(x.event, true)).toEqual({ error: 'refused' }); x.frame.url = original
  }
  expect(await x.call('export', '/tmp/renderer.json')).toHaveProperty('error')
  expect(await x.call('import-preview', '/tmp/renderer.json')).toHaveProperty('error')
  expect(await x.call('show-file', '/tmp/renderer.json')).toHaveProperty('error')
  expect(x.dialogs.open).not.toHaveBeenCalled(); expect(x.dialogs.save).not.toHaveBeenCalled()
  await x.call('show-file'); expect(x.dialogs.show).toHaveBeenCalledWith(path.join(x.dir, 'settings.json'))
})
it('preview summarizes valid, invalid and unknown values without applying; apply requires the matching confirmed preview', async () => {
  const x = portable()
  expect(await x.call('import-apply', 1, true, true)).toHaveProperty('error')
  x.choose(JSON.stringify({ 'files.showHidden': true, 'appearance.theme': 42, 'unknown.key': 'kept out' }))
  const result = await x.call('import-preview')
  expect(result.preview.changes).toEqual([
    { id: 'files.showHidden', before: false, after: true, needsConfirm: false },
    { id: 'appearance.theme', before: 'auto', after: 42, reason: 'Invalid value', needsConfirm: false },
    { id: 'unknown.key', before: undefined, after: 'kept out', reason: 'Unknown setting', needsConfirm: false },
  ])
  expect(x.host.store.get('files.showHidden')).toBe(false); expect(x.sent).toEqual([]); expect(x.writer).not.toHaveBeenCalled()
  expect(await x.call('import-apply', result.token, false, false)).toHaveProperty('error')
  expect(await x.call('import-apply', result.token + 1, true, false)).toHaveProperty('error')
  expect(await x.call('import-apply', result.token, true, false)).toEqual({ changed: ['files.showHidden'] })
  expect(x.host.store.get('appearance.theme')).toBe('auto')
  expect(JSON.parse(fs.readFileSync(x.host.file, 'utf8'))).toEqual({ 'files.showHidden': true })
  expect(await x.call('import-apply', result.token, true, false)).toHaveProperty('error')
})
it('bounded reads reject oversized files and malformed JSON, invalidate old previews, and never apply a valid prefix', async () => {
  const x = portable()
  x.choose('{"files.showHidden":true}'); const old = await x.call('import-preview')
  x.choose('{"files.showHidden":true}' + ' '.repeat(256 * 1024))
  expect(await x.call('import-preview')).toEqual({ error: 'Settings file exceeds 256 KB' })
  expect(await x.call('import-apply', old.token, true, true)).toHaveProperty('error')
  x.choose('{"files.showHidden":true,broken}')
  expect(await x.call('import-preview')).toEqual({ error: 'Invalid settings JSON' })
  expect(x.host.store.get('files.showHidden')).toBe(false); expect(x.sent).toEqual([])
  x.choose('{}' + ' '.repeat(256 * 1024 - 2))
  expect((await x.call('import-preview')).preview.changes).toEqual([])
})
it('safety changes always require the additional confirmation, including a change back to default', async () => {
  const x = portable()
  x.host.registry.defineSetting({ id: 'guard:enabled', type: 'boolean', default: false, safety: true, label: null, category: 'test' })
  x.host.store.set('guard:enabled', false)
  for (const value of [true, false]) {
    x.choose(JSON.stringify({ 'guard:enabled': value, 'files.showHidden': value }))
    const result = await x.call('import-preview')
    expect(result.needsConfirm).toBe(true)
    expect(await x.call('import-apply', result.token, true, false)).toEqual({ error: 'Safety confirmation required' })
    expect(x.host.store.get('guard:enabled')).toBe(!value)
    expect(await x.call('import-apply', result.token, true, true)).toHaveProperty('changed')
    expect(x.host.store.get('guard:enabled')).toBe(value)
  }
  await x.host.flush()
})
it('export round-trips with zero changes; reset requires confirmation and broadcasts only modified keys; hand edits load on restart', async () => {
  const x = portable()
  x.host.store.set('files.showHidden', true); x.host.store.set('appearance.theme', 'dark'); await x.host.flush()
  const file = x.choose(); expect(await x.call('export')).toEqual({ changed: [] })
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ 'appearance.theme': 'dark', 'files.showHidden': true })
  expect(fs.readdirSync(x.dir).some(name => name.endsWith('.tmp'))).toBe(false)
  expect((await x.call('import-preview')).preview.changes).toEqual([])
  x.sent.length = 0
  expect(await x.call('reset-all', false)).toHaveProperty('error')
  expect(x.host.store.get('files.showHidden')).toBe(true)
  expect(await x.call('reset-all', true)).toEqual({ changed: ['appearance.theme', 'files.showHidden'] })
  expect(x.sent).toEqual([['fb:settings-changed', ['appearance.theme']], ['fb:settings-changed', ['files.showHidden']]])
  expect(JSON.parse(fs.readFileSync(x.host.file, 'utf8'))).toEqual({})
  x.host.dispose(); fs.writeFileSync(x.host.file, '{"editor.wordWrap":true}')
  const reopened = new SettingsHost(x.dir, { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() } as any, () => [])
  expect(reopened.store.get('editor.wordWrap')).toBe(true); expect(reopened.store.get('files.showHidden')).toBe(false)
  reopened.dispose()
})

it('rejects stale summaries, and reset invalidates a preview', async () => {
  const x = portable()
  x.choose('{"files.showHidden":true}'); const result = await x.call('import-preview')
  x.host.store.set('files.showHidden', true)
  expect(await x.call('import-apply', result.token, true, false)).toEqual({ error: 'Settings changed; preview again' })
  await x.call('reset-all', true)
  expect(await x.call('import-apply', result.token, true, false)).toHaveProperty('error')
  expect(x.host.store.get('files.showHidden')).toBe(false)
  await x.host.flush()
})

it('a consumed preview token cannot be applied again, even when the value is back to what the preview saw', async () => {
  const x = portable()
  x.choose('{"files.showHidden":true}'); const result = await x.call('import-preview')
  expect(await x.call('import-apply', result.token, true, false)).toEqual({ changed: ['files.showHidden'] })
  x.host.store.set('files.showHidden', false)
  expect(await x.call('import-apply', result.token, true, false)).toEqual({ error: 'No matching import preview' })
  expect(x.host.store.get('files.showHidden')).toBe(false)
  await x.host.flush()
})
