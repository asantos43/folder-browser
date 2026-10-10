import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginsHost, pluginChannels, defaultCompileIO, pluginTranslator, type PluginsDialogs } from './plugins-host.ts'
import { buildPlugin, buildPluginFolder, removePluginFixture } from '../fixtures/plugins.ts'
import { SettingsRegistry } from '../core/settings/registry.ts'
import { SettingsStore } from '../core/settings/store.ts'
import type { PluginSummary } from '../core/plugins/summary.ts'

// Vitest disables CSS modules by default, including ?raw CSS. Supply the actual
// bundled metadata here; neither IPC nor the core host is mocked.
vi.mock('../src/theme/tokens.css?raw', async () => {
  const { readFile } = await import('node:fs/promises')
  return { default: await readFile('src/theme/tokens.css', 'utf8') }
})

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await removePluginFixture(dir) })
async function setup(locale = 'en') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-plugin-ipc-')); dirs.push(dir)
  const handlers = new Map<string, (event: any, ...args: unknown[]) => Promise<any>>()
  const ipc = { handle: (channel: string, listener: any) => handlers.set(channel, listener), removeHandler: vi.fn((channel: string) => handlers.delete(channel)) }
  const frame = { url: 'fb-ui://app/index.html' }, sender = { mainFrame: frame, getURL: () => frame.url, send: vi.fn() }
  const win = { webContents: sender, isDestroyed: () => false } as any
  const registry = new SettingsRegistry(), store = new SettingsStore(registry, async () => {})
  const dialogs: PluginsDialogs = { open: vi.fn(async () => undefined), confirm: vi.fn(async (_win, _summary: PluginSummary) => true), openPath: vi.fn(async () => '') }
  const host = new PluginsHost({ userData: dir, appVersion: '0.1.3', registry, store }, ipc as any, () => [win], dialogs, pluginTranslator(locale))
  host.register()
  const event = { sender, senderFrame: frame }
  const call = (channel: string, ...args: unknown[]) => handlers.get(`fb:plugins-${channel}`)!(event, ...args)
  return { dir, host, handlers, ipc, event, frame, sender, win, dialogs, call }
}
it('registers all seven asynchronous channels without creating/reading a plugin root', async () => {
  const x = await setup()
  expect([...x.handlers.keys()]).toEqual(pluginChannels.map(channel => `fb:plugins-${channel}`))
  expect(await fs.readdir(x.dir)).toEqual([])
  expect(await x.call('list')).toEqual([])
  x.host.dispose(); expect(x.handlers.size).toBe(0); expect(x.ipc.removeHandler).toHaveBeenCalledTimes(7)
})
it('refuses child frames, foreign origins and senders for every channel before dialogs or disk', async () => {
  const x = await setup()
  for (const channel of pluginChannels) {
    const handler = x.handlers.get(`fb:plugins-${channel}`)!
    await expect(handler({ ...x.event, senderFrame: { url: x.frame.url } })).rejects.toThrow('cannot manage')
    await expect(handler({ ...x.event, sender: {} })).rejects.toThrow('cannot manage')
    x.frame.url = 'https://example.test/'
    await expect(handler(x.event)).rejects.toThrow('cannot manage'); x.frame.url = 'fb-ui://app/index.html'
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
  expect(x.sender.send.mock.calls).toEqual(Array(5).fill(['fb:plugins-changed']))
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
