import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginsHost, pluginChannels, defaultCompileIO, pluginTranslator, type PluginsDialogs } from './plugins-host.ts'
import { buildPlugin, buildPluginFolder, removePluginFixture } from '../fixtures/plugins.ts'
import { SettingsRegistry } from '../core/settings/registry.ts'
import { SettingsStore } from '../core/settings/store.ts'
import type { PluginSummary } from '../core/plugins/summary.ts'
import { activationPlugin } from '../fixtures/plugin-activation.ts'
import { createGenerationStore, type GenerationSnapshot } from '../core/plugins/generation.ts'
import { ExecutableCatalog } from '../core/plugins/executables.ts'
import { setPluginLanguageIndex } from '../core/filekind.ts'
import { KeysHost } from './keys-host.ts'
import { setUserKeys } from '../core/keys/effective.ts'

// Vitest disables CSS modules by default, including ?raw CSS. Supply the actual
// bundled metadata here; neither IPC nor the core host is mocked.
vi.mock('../src/theme/tokens.css?raw', async () => {
  const { readFile } = await import('node:fs/promises')
  return { default: await readFile('src/theme/tokens.css', 'utf8') }
})

const dirs: string[] = []
afterEach(async () => { vi.restoreAllMocks(); setPluginLanguageIndex(null); for (const dir of dirs.splice(0)) await removePluginFixture(dir) })
async function setup(locale = 'en', onGeneration?: (snapshot: GenerationSnapshot) => void, keys?: KeysHost) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-plugin-ipc-')); dirs.push(dir)
  const handlers = new Map<string, (event: any, ...args: unknown[]) => Promise<any>>()
  const ipc = { handle: (channel: string, listener: any) => handlers.set(channel, listener), removeHandler: vi.fn((channel: string) => handlers.delete(channel)) }
  const frame = { url: 'fb-ui://app/index.html' }, sender = { mainFrame: frame, getURL: () => frame.url, send: vi.fn() }
  const win = { webContents: sender, isDestroyed: () => false } as any
  const registry = new SettingsRegistry(), store = new SettingsStore(registry, async () => {})
  const dialogs: PluginsDialogs = { open: vi.fn(async () => undefined), confirm: vi.fn(async (_win, _summary: PluginSummary) => true), openPath: vi.fn(async () => '') }
  const host = new PluginsHost({ userData: dir, appVersion: '0.1.3', registry, store, onGeneration }, ipc as any, () => [win], dialogs, pluginTranslator(locale), undefined, keys)
  host.register()
  const event = { sender, senderFrame: frame }
  const call = (channel: string, ...args: unknown[]) => handlers.get(`fb:plugins-${channel}`)!(event, ...args)
  return { dir, host, handlers, ipc, event, frame, sender, win, dialogs, call, registry, store }
}
it('projects scheme changes into one generation/menu callback, including a selection during publication', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-scheme-generation-')); dirs.push(dir)
  let renderedVersion = 0
  let host: PluginsHost | undefined
  const menu = vi.fn()
  const keys = new KeysHost(dir, { on() {}, removeListener() {}, handle() {}, removeHandler() {} } as any, () => [], false, () => {
    const snapshot = host?.generation.snapshot()
    if (snapshot && snapshot.version !== renderedVersion) return
    menu()
  })
  const x = await setup('en', snapshot => { renderedVersion = snapshot.version; menu() }, keys)
  host = x.host
  const plugin = activationPlugin()
  const handle = host.generation.stage('sample', plugin, { enabled: true, disabledCommands: new Map() })
  const notifications: Array<() => void> = []
  try {
    host.generation.transaction(() => keys.transaction(() => {
      host!.generation.commit(handle)
      keys.setPlugin('sample', plugin)
      keys.selectScheme({ owner: 'sample', id: 'scheme' })
      host!.generation.resolveKeys(keys.resolvedEntries())
    }, listener => notifications.push(listener)), listener => notifications.push(listener))
    for (const notify of notifications) notify()
    await Promise.resolve()
    expect(menu).toHaveBeenCalledTimes(1)
    expect(host.generation.snapshot().plugins[0].resolvedKeys?.[0].keys).toContain('Mod+Alt+K')
    menu.mockClear()
    keys.selectScheme(undefined)
    await Promise.resolve(); await Promise.resolve()
    expect(menu).toHaveBeenCalledTimes(1)
    expect(host.generation.snapshot().plugins[0].resolvedKeys?.[0].keys).not.toContain('Mod+Alt+K')
  } finally { host.dispose(); keys.dispose(); setUserKeys([], false) }
})
it('registers all eight asynchronous channels without creating/reading a plugin root', async () => {
  const x = await setup()
  expect([...x.handlers.keys()]).toEqual(pluginChannels.map(channel => `fb:plugins-${channel}`))
  expect(await fs.readdir(x.dir)).toEqual([])
  expect(await x.call('list')).toEqual([])
  x.host.dispose(); expect(x.handlers.size).toBe(0); expect(x.ipc.removeHandler).toHaveBeenCalledTimes(8)
})
it('refuses child frames, foreign origins and senders for every channel before dialogs or disk', async () => {
  const x = await setup()
  for (const channel of pluginChannels) {
    const handler = x.handlers.get(`fb:plugins-${channel}`)!
    await expect(handler({ ...x.event, senderFrame: { url: x.frame.url } })).rejects.toThrow('cannot manage')
    await expect(handler({ ...x.event, sender: {} })).rejects.toThrow('cannot manage')
    for (const url of ['https://example.test/', 'file:///tmp/index.html', 'wsnp://snapshot/index.html']) {
      x.frame.url = url
      await expect(handler(x.event)).rejects.toThrow('cannot manage')
    }
    x.frame.url = 'fb-ui://app/index.html'
  }
  expect(x.dialogs.open).not.toHaveBeenCalled(); expect(x.dialogs.openPath).not.toHaveBeenCalled()
  expect(await fs.readdir(x.dir)).toEqual([])
})
it('validates unknown arguments, including arity, ids, options and paths', async () => {
  const x = await setup()
  for (const channel of pluginChannels) await expect(x.call(channel, 1, 2, 3)).rejects.toThrow('invalid')
  await expect(x.call('set-enabled', '../bad', true)).rejects.toThrow('installed plugin')
  await expect(x.call('set-enabled', 'acme.sample', 'true')).rejects.toThrow('invalid')
  await expect(x.call('remove', 'acme.sample', { keepSettings: 'false' })).rejects.toThrow('invalid')
  await expect(x.call('open-folder', '/tmp')).rejects.toThrow('installed plugin')
  expect(await x.call('install-paths', [null])).toMatchObject({ ok: false })
  expect(await x.call('install-paths', '../renderer')).toMatchObject({ ok: false })
  expect(x.dialogs.open).not.toHaveBeenCalled(); expect(x.dialogs.confirm).not.toHaveBeenCalled()
})
it('installs from the host dialog, publishes every mutation and opens only the indexed folder', async () => {
  const x = await setup(), file = path.join(x.dir, 'sample.fbplugin')
  await buildPlugin({ file }); vi.mocked(x.dialogs.open).mockResolvedValue([file])
  expect(await x.call('install')).toEqual({ ok: true, id: 'acme.sample' })
  expect(x.dialogs.open).toHaveBeenCalledWith(x.win)
  expect(x.dialogs.confirm).toHaveBeenCalledWith(x.win, expect.objectContaining({ name: 'Sample', trust: 'unsigned', contributes: expect.any(Object) }))
  expect(await x.call('list')).toMatchObject([{ id: 'acme.sample', enabled: true }])
  await x.call('set-enabled', 'acme.sample', false)
  expect(await x.call('list')).toMatchObject([{ enabled: false }])
  await x.call('set-enabled', 'acme.sample', true); await x.call('disable-all')
  await x.call('open-folder', 'acme.sample')
  expect(x.dialogs.openPath).toHaveBeenCalledWith(await fs.realpath(path.join(x.dir, 'plugins/acme.sample/1.0.0')))
  await x.call('remove', 'acme.sample', { keepSettings: true }); expect(await x.call('list')).toEqual([])
  expect(x.sender.send.mock.calls.filter(([channel]) => channel === 'fb:plugins-changed')).toEqual(Array(5).fill(['fb:plugins-changed']))
})
it('drop installs an unpacked folder, cancellation makes no change, and refusal is localized', async () => {
  const x = await setup('pt-BR'), folder = await buildPluginFolder(path.join(x.dir, 'source'))
  expect(await x.call('install')).toEqual({ cancelled: true })
  vi.mocked(x.dialogs.confirm).mockResolvedValue(false)
  expect(await x.call('install-paths', [folder])).toEqual({ cancelled: true })
  expect(x.sender.send).not.toHaveBeenCalled()
  vi.mocked(x.dialogs.confirm).mockResolvedValue(true)
  expect(await x.call('install-paths', [folder])).toEqual({ ok: true, id: 'acme.sample' })
  expect(await x.call('install-paths', ['/tmp/../bad.fbplugin'])).toMatchObject({ ok: false, message: expect.stringContaining('Escolha') })
  await x.call('remove', 'acme.sample', { keepSettings: false })
})
it('supplies actual compiler metadata without importing CodeMirror or reading source files at runtime', () => {
  for (const extension of ['.py', '.tsx', '.json', '.yaml', '.cpp', '.pas', '.csv', '.md']) expect(defaultCompileIO.builtinExtensions.has(extension)).toBe(true)
  expect(defaultCompileIO.builtinExtensions.has('.fbunknown')).toBe(false)
  expect(defaultCompileIO.knownCommands.has('openFile')).toBe(true)
  expect(defaultCompileIO.knownLanguages.has('javascript')).toBe(true)
  expect(defaultCompileIO.declaredTokens.has('vscode-editor-background')).toBe(true)
  expect(defaultCompileIO.knownLocaleKeys.has('plugins.install')).toBe(true)
})
it('returns 100 cached summaries in one asynchronous reply within a 16.7 ms frame', async () => {
  const x = await setup(), file = path.join(x.dir, 'sample.fbplugin'); await buildPlugin({ file })
  await x.call('install-paths', [file])
  const indexFile = path.join(x.dir, 'plugins/installed.json'), index = JSON.parse(await fs.readFile(indexFile, 'utf8'))
  await fs.writeFile(indexFile, JSON.stringify({ schema: 1, plugins: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`acme.plugin-${i}`, index.plugins['acme.sample']])) }))
  await x.call('list')
  const times: number[] = []
  for (let i = 0; i < 20; i++) { const start = performance.now(); expect(await x.call('list')).toHaveLength(100); times.push(performance.now() - start) }
  const median = times.sort((a, b) => a - b)[10]
  console.info(`plugin IPC handler/100 (transport covered by e2e): ${median.toFixed(3)} ms`)
  expect(median).toBeLessThan(16.7)
})

const context = { enabled: true, disabledCommands: new Map<string, string>() }
it('returns the cached generation without waiting for an install confirmation', async () => {
  const x = await setup(), file = path.join(x.dir, 'sample.fbplugin'); await buildPlugin({ file })
  let release!: (confirmed: boolean) => void
  let entered!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(x.dialogs.confirm).mockImplementation(() => { entered(); return new Promise(resolve => { release = resolve }) })
  const install = x.call('install-paths', [file]); await waiting
  try {
    const snapshot = await x.call('generation')
    expect(snapshot).toEqual({ version: 0, plugins: [] })
    expect(await x.call('generation')).toBe(snapshot)
    expect((await x.call('generation')).plugins).toBe(snapshot.plugins)
    await expect(x.call('generation', 0)).rejects.toThrow('invalid')
  } finally { release(true); await install }
  expect((await x.call('generation')).plugins).toMatchObject([{ owner: 'acme.sample' }])
})

it('coalesces 100 commits, serves reload/new-window pulls and cancels queued notifications on dispose', async () => {
  const rebuild = vi.fn(), x = await setup('en', rebuild)
  for (let i = 0; i < 100; i++) x.host.generation.commit(x.host.generation.stage('sample', activationPlugin('sample', `label${i}`), context))
  expect(x.sender.send).not.toHaveBeenCalled()
  expect(rebuild).not.toHaveBeenCalled()
  await Promise.resolve()
  expect(x.sender.send.mock.calls).toEqual([['fb:plugins-generation-changed', 100]])
  const snapshot = await x.call('generation')
  expect(rebuild).toHaveBeenCalledExactlyOnceWith(snapshot)
  x.frame.url = 'fb-ui://app/index.html?reload'
  expect(await x.call('generation')).toBe(snapshot)
  const frame = { url: 'fb-ui://app/index.html' }, sender = { ...x.sender, mainFrame: frame }
  const second = { webContents: sender, isDestroyed: () => false } as any
  // Same running host, newly authorized window: no replay/deltas are required.
  ;(x.host as any).windows = () => [x.win, second]
  expect(await x.host.handle({ sender, senderFrame: frame } as any, 'generation', [])).toBe(snapshot)
  x.host.generation.remove('sample'); x.host.dispose(); await Promise.resolve()
  expect(x.sender.send).toHaveBeenCalledTimes(1)
  expect(rebuild).toHaveBeenCalledTimes(1)
})

it('rebuilds once for each published generation including removal; callback failure preserves notifications', async () => {
  const rebuild = vi.fn(), x = await setup('en', rebuild)
  const compiled = activationPlugin('sample')
  x.host.generation.commit(x.host.generation.stage('sample', compiled, context)); await Promise.resolve()
  expect(rebuild).toHaveBeenCalledExactlyOnceWith(x.host.generation.snapshot())
  x.host.generation.remove('sample'); await Promise.resolve()
  expect(rebuild).toHaveBeenCalledTimes(2)
  expect(rebuild.mock.calls[1][0]).toEqual({ version: 2, plugins: [] })
  await x.call('generation'); await x.call('generation'); await Promise.resolve()
  expect(rebuild).toHaveBeenCalledTimes(2)
  rebuild.mockImplementation(() => { throw new Error('menu failed') })
  x.host.generation.commit(x.host.generation.stage('sample', compiled, context)); await Promise.resolve()
  expect(x.sender.send).toHaveBeenLastCalledWith('fb:plugins-generation-changed', 3)
  x.host.dispose()
})

it('sends generation versions only to live fb-ui windows and keeps source versions monotonic', async () => {
  const x = await setup(), foreign = { webContents: { getURL: () => 'wsnp://snapshot/', send: vi.fn() }, isDestroyed: () => false }
  const dead = { isDestroyed: () => true, get webContents(): never { throw new Error('destroyed') } }
  ;(x.host as any).windows = () => [x.win, foreign, dead]
  for (const label of ['first', 'second']) { x.host.generation.commit(x.host.generation.stage('sample', activationPlugin('sample', label), context)); await Promise.resolve() }
  expect(x.sender.send.mock.calls).toEqual([['fb:plugins-generation-changed', 1], ['fb:plugins-generation-changed', 2]])
  expect(foreign.webContents.send).not.toHaveBeenCalled()
})

it('starts the installed generation once, with real activation, and contains activation failures', async () => {
  const x = await setup(), file = path.join(x.dir, 'sample.fbplugin'); await buildPlugin({ file })
  await x.call('install-paths', [file]); x.host.dispose()
  const restored = new PluginsHost({ userData: x.dir, appVersion: '0.1.3', registry: new SettingsRegistry(), store: x.store }, x.ipc as any, () => [x.win], x.dialogs)
  const first = restored.start(); expect(restored.start()).toBe(first); await first
  expect(restored.generation.snapshot().plugins).toMatchObject([{ owner: 'acme.sample', enabled: true }])
  expect(restored.start()).toBe(first); restored.dispose()
  const failing = new PluginsHost({ userData: x.dir, appVersion: '0.1.3', registry: new SettingsRegistry(), store: x.store }, x.ipc as any, () => [x.win], x.dialogs)
  vi.spyOn(failing.generation, 'stage').mockImplementation(() => { throw new Error('fixture failure') })
  await expect(failing.start()).resolves.toBeUndefined()
  expect(failing.generation.snapshot()).toEqual({ version: 0, plugins: [] })
  expect(await failing.handle(x.event as any, 'list', [])).toMatchObject([{ error: expect.any(String) }])
  failing.dispose()
})

it('rejects oversized projections in the store before publication', () => {
  const store = createGenerationStore({ bytes: 128 })
  expect(() => store.stage('sample', activationPlugin(), context)).toThrow()
  expect(store.snapshot()).toEqual({ version: 0, plugins: [] })
})

it('uses the committed installed version on install and update, and contains unexpected startup errors', async () => {
  const x = await setup(), replace = vi.spyOn(ExecutableCatalog.prototype, 'replace')
  const file = path.join(x.dir, 'sample.fbplugin'); await buildPlugin({ file })
  expect(await x.call('install-paths', [file])).toMatchObject({ ok: true })
  expect(replace.mock.calls.at(-1)?.[0]).toBe('1.0.0')
  await buildPlugin({ file, manifest: { version: '1.1.0' } })
  expect(await x.call('install-paths', [file])).toMatchObject({ ok: true })
  expect(replace.mock.calls.at(-1)?.[0]).toBe('1.1.0')
  const cached = x.host.generation.snapshot(), error = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(x.host as any, 'host').mockImplementation(() => { throw new Error('/private/user/path') })
  await expect(x.host.start()).resolves.toBeUndefined()
  expect(error).toHaveBeenCalledWith('Plugin host startup failed.')
  expect(x.host.generation.snapshot()).toBe(cached); x.host.dispose()
})

it('replies from cache within 16.7 ms with 50 active projections', async () => {
  const x = await setup()
  for (let i = 0; i < 50; i++) { const owner = `plugin${i}`; x.host.generation.commit(x.host.generation.stage(owner, activationPlugin(owner), context)) }
  const snapshot = await x.call('generation'), times: number[] = []
  for (let i = 0; i < 20; i++) { const start = performance.now(); const result = await x.call('generation'); times.push(performance.now() - start); expect(result).toBe(snapshot); expect(result.plugins).toHaveLength(50) }
  const median = times.sort((a, b) => a - b)[10]
  console.info(`generation IPC handler/50 median: ${median.toFixed(3)} ms`)
  expect(median).toBeLessThan(16.7); x.host.dispose()
})

it.each([false, true])('defers the lazy bundle past window load and a turn; installed index=%s', async installed => {
  const x = await setup(), events = new Map<string, () => void>(), handlers = new Map<string, (event: any, ...args: unknown[]) => Promise<any>>()
  const ready = vi.fn(), start = vi.fn(async () => {}), load = vi.fn(), createWindow = vi.fn(() => x.win)
  const installMenu = vi.fn()
  let keysChanged: () => void = () => {}
  let onGeneration: (snapshot: GenerationSnapshot) => void = () => {}
  let currentGeneration: GenerationSnapshot = { version: 0, plugins: [] }
  const paths = ['./argv.ts', './menu.ts', './snapshot-host.ts', './settings-host.ts', './keys-host.ts', './snapshot-view.ts', './window.ts', './plugins-host.ts', '../core/drafts.ts', 'electron', 'node:fs/promises']
  const originalOnce = (x.sender as any).once
  ;(x.sender as any).once = (name: string, callback: () => void) => { events.set(name, callback) }
  const access = vi.spyOn(fs, 'access').mockImplementation(async () => { if (!installed) throw Object.assign(new Error('missing'), { code: 'ENOENT' }) })
  vi.doMock('node:fs/promises', () => ({ ...fs, default: fs, access }))
  vi.doMock('electron', () => ({ app: {
    requestSingleInstanceLock: () => true, on: vi.fn(), whenReady: () => Promise.resolve().then(() => { ready() }),
    getPath: () => x.dir, getAppPath: () => x.dir, getVersion: () => '0.1.3', getLocale: () => 'en', isPackaged: false,
  }, BrowserWindow: { getAllWindows: () => [x.win] }, ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) } }))
  vi.doMock('./argv.ts', () => ({ pathsToOpen: () => [], userArgs: () => [] }))
  vi.doMock('./menu.ts', () => ({ installMenu }))
  vi.doMock('../core/drafts.ts', () => ({ DraftStore: class { prune() {} } }))
  vi.doMock('./snapshot-view.ts', () => ({ registerScheme: vi.fn() }))
  vi.doMock('./snapshot-host.ts', () => ({ SnapshotHost: class {
    configureRunner() {} registerIpc() {} sweepOldCopies() {} openFromSystem() { return Promise.resolve() }
  } }))
  vi.doMock('./settings-host.ts', () => ({ SettingsHost: class { registry = x.registry; store = x.store; register() {} bindKeyScheme() {} }, flushBeforeQuit: vi.fn() }))
  vi.doMock('./keys-host.ts', () => ({ KeysHost: class {
    constructor(_data: string, _ipc: unknown, _windows: unknown, _mac: boolean, changed: () => void) { keysChanged = changed }
    register() {}
  } }))
  vi.doMock('./window.ts', () => ({ createMainWindow: createWindow }))
  vi.doMock('./plugins-host.ts', () => {
    load()
    return { PluginsHost: class {
      constructor(options: { onGeneration: typeof onGeneration }) { onGeneration = options.onGeneration }
      generation = { snapshot: () => currentGeneration }
      start = start; handle = vi.fn(async () => ({ version: 7, plugins: [] }))
    }, systemPluginDialogs: vi.fn(), pluginTranslator: () => pluginTranslator('en') }
  })
  try {
    vi.resetModules(); await import('./main.ts')
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledTimes(1))
    expect(ready).toHaveBeenCalledTimes(1); expect(load).not.toHaveBeenCalled(); expect(access).not.toHaveBeenCalled()
    if (!installed) {
      const generation = handlers.get('fb:plugins-generation')!
      await expect(generation(x.event, 'extra')).rejects.toThrow('Invalid')
      await expect(generation(x.event)).resolves.toEqual({ version: 0, plugins: [] })
      expect(load).not.toHaveBeenCalled()
    }
    events.get('did-finish-load')!()
    expect(load).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled()
    await new Promise<void>(resolve => setImmediate(resolve))
    await vi.waitFor(() => expect(access).toHaveBeenCalled())
    if (installed) {
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))
      expect(load).toHaveBeenCalledTimes(1)
      installMenu.mockClear()
      currentGeneration = { version: 1, plugins: [] }
      keysChanged() // Lifecycle keys notify before the coalesced generation callback.
      expect(installMenu).not.toHaveBeenCalled()
      onGeneration(currentGeneration)
      expect(installMenu).toHaveBeenCalledTimes(1)
      expect(installMenu.mock.calls[0][1]).toBe(currentGeneration)
      installMenu.mock.calls[0][0]('sample:run')
      expect(x.sender.send).toHaveBeenLastCalledWith('fb:command', 'sample:run')
      keysChanged() // User key changes keep the published plugin snapshot.
      expect(installMenu).toHaveBeenCalledTimes(2)
      expect(installMenu.mock.calls[1][1]).toBe(currentGeneration)
    } else { expect(load).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled() }
  } finally {
    access.mockRestore(); (x.sender as any).once = originalOnce
    for (const module of paths) vi.doUnmock(module)
    vi.resetModules()
  }
})
