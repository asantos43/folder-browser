import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { buildPlugin, buildPluginFolder, removePluginFixture } from '../../fixtures/plugins.ts'
import { PluginHost, toSummary, type PluginHostOptions } from './host.ts'
import * as cache from './compiled-cache.ts'
import { createActivation, activationKinds, type ActivationAdapters } from './activation.ts'
import { compiledPluginSettings } from './settings.ts'
import { readIndex } from './install.ts'
import * as installer from './install.ts'
import { SettingsRegistry } from '../settings/registry.ts'
import { SettingsStore } from '../settings/store.ts'
import type { PluginSummary } from './summary.ts'
import type { CompiledPlugin } from './compile.ts'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-plugin-host-')) })
afterEach(async () => { vi.restoreAllMocks(); await removePluginFixture(dir) })
function host(activation?: PluginHostOptions['activation']) {
  const root = path.join(dir, 'plugins'), registry = new SettingsRegistry(), write = vi.fn(async (_contents: string) => {})
  const store = new SettingsStore(registry, write), confirm = vi.fn(async (_summary: PluginSummary) => true), openPath = vi.fn(async (_file: string) => ''), changed = vi.fn()
  const options: PluginHostOptions = { root, appVersion: '0.1.3', registry, store, confirm, openPath, changed, activation,
    compileIO: { knownCommands: new Set(['openFile']), knownLanguages: new Set(['javascript']), builtinExtensions: new Set(['.js']), declaredTokens: new Set(['vscode-editor-background']), knownLocaleKeys: new Set(['menu.file']) } }
  const h = new PluginHost(options)
  return { h, root, registry, store, confirm, openPath, changed, write, options }
}
async function source(zip = true, options: Parameters<typeof buildPlugin>[0] = {}) {
  const file = path.join(dir, zip ? 'sample.fbplugin' : 'source')
  if (zip) await buildPlugin({ ...options, file })
  else await buildPluginFolder(file, options)
  return file
}

it.each([true, false])('installs verified data from zip=%s after a complete confirmation summary', async zip => {
  const x = host(), file = await source(zip)
  expect(await x.h.installPaths([file])).toEqual({ ok: true, id: 'acme.sample' })
  expect(x.confirm.mock.calls[0]?.[0]).toMatchObject({ id: 'acme.sample', name: 'Sample', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' }, trust: 'unsigned', sizeBytes: expect.any(Number), contributes: { themes: 0, settings: 0 } })
  expect(x.confirm.mock.calls[0]![0].sizeBytes).toBeGreaterThan(16)
  const record = (await readIndex(x.root)).plugins['acme.sample']
  expect(record.origin).toBe(zip ? 'file' : 'folder')
  expect(await x.h.list()).toEqual([toSummary(record, 'acme.sample')])
  expect(x.changed).toHaveBeenCalledTimes(1)
  expect(await fs.readFile(path.join(x.root, 'acme.sample/1.0.0/README.md'), 'utf8')).toBe('Synthetic plugin')
})
it('cancellation closes the reader, writes nothing and never publishes', async () => {
  const x = host(), file = await source()
  x.confirm.mockResolvedValue(false)
  expect(await x.h.installPaths([file])).toEqual({ cancelled: true })
  expect((await readIndex(x.root)).plugins).toEqual({}); expect(x.changed).not.toHaveBeenCalled()
  await fs.rm(file); expect(await fs.stat(file).catch(() => null)).toBe(null)
})
it('a compiler error refuses the whole install before publishing any contribution or bytes', async () => {
  const x = host(), file = await source(true, { files: { 'theme.json': '{"vscode-editor-background":"url(evil)"}' },
    manifest: { contributes: { themes: [{ id: 'dark', label: 'Dark', base: 'dark', tokens: 'theme.json' }] } } })
  const result = await x.h.installPaths([file])
  expect(result).toMatchObject({ ok: false, code: expect.stringContaining('compile.') })
  expect('message' in result && /[\r\n]/.test(result.message)).toBe(false)
  expect((await readIndex(x.root)).plugins).toEqual({}); expect(x.changed).not.toHaveBeenCalled()
})
it('compiler warnings are notices and do not apply configuration or commands', async () => {
  const x = host(), file = await source(true, { files: { 'fr.json': '{"unknown.plugin.key":"bonjour"}' },
    manifest: { contributes: { locales: [{ language: 'fr', label: 'French', file: 'fr.json' }] } } })
  expect(await x.h.installPaths([file])).toMatchObject({ ok: true, notices: [{ code: expect.stringContaining('compile.'), message: expect.any(String) }] })
  expect(x.registry.all()).toEqual([])
})
it.each([null, [], 'file.fbplugin', [false], ['/tmp/../unsafe.fbplugin'], ['relative.fbplugin'], ['a\0.fbplugin'], Array(101).fill('/tmp/p.fbplugin')])('refuses malformed/hostile drop arguments %j', async value => {
  const x = host()
  expect(await x.h.installPaths(value)).toMatchObject({ ok: false })
  expect(x.confirm).not.toHaveBeenCalled(); expect(x.changed).not.toHaveBeenCalled()
})
it('refuses a non-package, missing manifest, manifest link, linked source and special path before confirmation', async () => {
  const x = host(), file = await source(), other = path.join(dir, 'wrong.zip'), empty = path.join(dir, 'empty'), linked = path.join(dir, 'link.fbplugin')
  await fs.copyFile(file, other); await fs.mkdir(empty); await fs.symlink(file, linked)
  for (const input of [other, empty, linked]) expect(await x.h.installPaths([input])).toMatchObject({ ok: false })
  await fs.symlink(file, path.join(empty, 'plugin.json'))
  expect(await x.h.installPaths([empty])).toMatchObject({ ok: false })
  expect(x.confirm).not.toHaveBeenCalled(); expect(x.changed).not.toHaveBeenCalled()
})
it('prevalidates a batch and refuses a corrupt package without installing a prefix', async () => {
  const x = host(), file = await source()
  expect(await x.h.installPaths([file, path.join(dir, 'missing.fbplugin')])).toMatchObject({ ok: false })
  expect(x.confirm).not.toHaveBeenCalled()
  await fs.writeFile(file, 'not a zip')
  expect(await x.h.installPaths([file])).toMatchObject({ ok: false, message: expect.stringContaining('invalid') })
  expect((await readIndex(x.root)).plugins).toEqual({})
})
it('toSummary detaches objects, preserves all metadata and includes an unreadable error', async () => {
  const x = host(); await x.h.installPaths([await source()])
  const record = (await readIndex(x.root)).plugins['acme.sample'], summary = toSummary(record, 'acme.sample', 'Cannot read')
  expect(summary).toEqual({ id: 'acme.sample', name: record.name, version: record.version, publisher: record.publisher,
    trust: record.trust, enabled: record.enabled, sizeBytes: record.sizeBytes, contributes: record.contributes,
    hasCode: record.hasCode, developer: false, error: 'Cannot read' })
  summary.publisher.name = 'Changed'; summary.contributes.themes = 55
  expect(record.publisher.name).toBe('Acme'); expect(record.contributes.themes).toBe(0)
})
it('lists an unreadable installed manifest with an error, without reading any plugin payload', async () => {
  const x = host(); await x.h.installPaths([await source()])
  const file = path.join(x.root, 'acme.sample/1.0.0/plugin.json')
  await fs.chmod(file, 0o644); await fs.writeFile(file, '{broken')
  expect(await x.h.list()).toMatchObject([{ id: 'acme.sample', error: expect.stringContaining('cannot be read') }])
})
it('toggles, disables all and publishes each successful mutation', async () => {
  const x = host(); await x.h.installPaths([await source()])
  await x.h.setEnabled('acme.sample', false); expect((await x.h.list())[0].enabled).toBe(false)
  await x.h.setEnabled('acme.sample', true); await x.h.disableAll()
  expect((await x.h.list())[0].enabled).toBe(false); expect(x.changed).toHaveBeenCalledTimes(4)
  await expect(x.h.setEnabled('acme.sample', 'true')).rejects.toThrow(); expect(x.changed).toHaveBeenCalledTimes(4)
})
it.each([true, false])('uninstalls with keepSettings=%s and preserves only the chosen data', async keepSettings => {
  const x = host(); await x.h.installPaths([await source()])
  x.store.load('{"plugins":{"acme.sample":{"saved":42},"other.plugin":{"saved":7}},"unrelated":true}')
  await x.h.remove('acme.sample', { keepSettings })
  x.store.purgePlugin('absent.fixture'); await x.store.flush()
  expect(await x.h.list()).toEqual([])
  const document = JSON.parse(x.write.mock.calls.at(-1)![0])
  expect(document.plugins?.['acme.sample']).toEqual(keepSettings ? { saved: 42 } : undefined)
  expect(document.plugins['other.plugin']).toEqual({ saved: 7 }); expect(document.unrelated).toBe(true)
  expect(await fs.stat(path.join(x.root, 'acme.sample')).catch(() => null)).toBe(null)
})
it('openFolder constructs the installed version, refuses a link and propagates a short shell error', async () => {
  const x = host(); await x.h.installPaths([await source()]); await x.h.openFolder('acme.sample')
  expect(x.openPath).toHaveBeenCalledWith(await fs.realpath(path.join(x.root, 'acme.sample/1.0.0')))
  x.openPath.mockResolvedValue('error'); await expect(x.h.openFolder('acme.sample')).rejects.toThrow('could not be opened')
  const plugin = path.join(x.root, 'acme.sample'), moved = path.join(dir, 'moved')
  await fs.rename(plugin, moved); await fs.symlink(moved, plugin)
  await expect(x.h.openFolder('acme.sample')).rejects.toThrow('unsafe')
})
const hostileIds = ['..', '../x', 'a/b', '', 'acme\\sample', 'acme.sample/../../etc',
  '../evil', '/tmp/evil', 'acme.constructor', 'acme.__proto__', 'Acme.sample', 'a.'.padEnd(70, 'a')]
const hostileOperations = ['openFolder', 'remove', 'setEnabled'] as const
it.each(hostileIds.flatMap(id => hostileOperations.map(operation => ({ id, operation }))))(
  'refuses hostile id $id in $operation before installer, disk or shell calls', async ({ id, operation }) => {
    const x = host()
    const downstream = [
      vi.spyOn(installer, 'readIndex'), vi.spyOn(installer, 'setEnabled'), vi.spyOn(installer, 'uninstallPlugin'),
      vi.spyOn(fs, 'lstat'), vi.spyOn(fs, 'stat'), vi.spyOn(fs, 'realpath'), vi.spyOn(fs, 'readFile'),
      vi.spyOn(fs, 'open'), vi.spyOn(fs, 'mkdir'), vi.spyOn(fs, 'writeFile'), vi.spyOn(fs, 'rename'),
      vi.spyOn(fs, 'rm'), vi.spyOn(fs, 'readdir'), x.openPath, x.changed, x.write,
    ]
    const action = operation === 'openFolder' ? x.h.openFolder(id)
      : operation === 'remove' ? x.h.remove(id, { keepSettings: false }) : x.h.setEnabled(id, true)
    await expect(action).rejects.toMatchObject({ code: 'plugins.id.invalid', message: 'Choose an installed plugin.' })
    for (const spy of downstream) expect(spy).not.toHaveBeenCalled()
  },
)
it('refuses malformed removal options before uninstall', async () => {
  const x = host(); await x.h.installPaths([await source()])
  for (const value of [null, true, [], {}, { keepSettings: 'false' }, { keepSettings: true, extra: 1 }]) await expect(x.h.remove('acme.sample', value)).rejects.toThrow()
  expect(await x.h.list()).toHaveLength(1)
})
it('warm list of 100 records uses less than 10 ms host CPU and returns detached summaries', async () => {
  const x = host(); await x.h.installPaths([await source()])
  const record = (await readIndex(x.root)).plugins['acme.sample']
  await fs.writeFile(path.join(x.root, 'installed.json'), JSON.stringify({ schema: 1, plugins: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`acme.plugin-${i}`, record])) }))
  expect(await x.h.list()).toHaveLength(100)
  const cpu: number[] = [], wall: number[] = []
  for (let i = 0; i < 20; i++) {
    const usage = process.cpuUsage(), start = performance.now(), items = await x.h.list(), elapsed = process.cpuUsage(usage)
    cpu.push((elapsed.user + elapsed.system) / 1000); wall.push(performance.now() - start)
    expect(items).toHaveLength(100); items[0].name = 'Changed'
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[10]
  process.stdout.write(`plugin host warm list/100: CPU ${median(cpu).toFixed(3)} ms; wall ${median(wall).toFixed(3)} ms\n`)
  expect(median(cpu)).toBeLessThan(10); expect((await x.h.list())[0].name).toBe('Sample')
})
it('a 5 MB streaming install yields the event loop with bounded memory', async () => {
  const x = host(), file = await source(true, { files: { 'data.txt': randomBytes(5 * 1024 * 1024) } })
  let ticks = 0, peak = process.memoryUsage().heapUsed, gap = 0, last = performance.now()
  const timer = setInterval(() => { const now = performance.now(); gap = Math.max(gap, now - last); last = now; ticks++; peak = Math.max(peak, process.memoryUsage().heapUsed) }, 5)
  const baseline = peak, start = performance.now()
  try { expect(await x.h.installPaths([file])).toMatchObject({ ok: true }) } finally { clearInterval(timer) }
  process.stdout.write(`plugin host install/5 MB: ${(performance.now() - start).toFixed(1)} ms; max gap ${gap.toFixed(1)} ms; heap growth ${((peak - baseline) / 1024 ** 2).toFixed(1)} MiB\n`)
  expect(ticks).toBeGreaterThan(0); expect(gap).toBeLessThan(50); expect(peak - baseline).toBeLessThan(40 * 1024 ** 2)
})

function runtime() {
  const active = new Map<string, boolean>(), payloads = new Map<string, CompiledPlugin>()
  const activation = {
    activate: vi.fn((id: string, compiled: CompiledPlugin, options?: { enabled?: boolean }) => { active.set(id, options?.enabled ?? true); payloads.set(id, compiled) }),
    update: vi.fn((id: string, compiled: CompiledPlugin) => { payloads.set(id, compiled) }),
    deactivate: vi.fn((id: string) => { if (active.has(id)) active.set(id, false) }),
    remove: vi.fn((id: string) => { active.delete(id); payloads.delete(id) }),
  }
  return { active, payloads, activation }
}
const pluginId = 'acme.sample'
const indexed = async (x: ReturnType<typeof host>) => (await readIndex(x.root)).plugins[pluginId]
const keyFor = (record: Awaited<ReturnType<typeof indexed>>, id = pluginId, appVersion = '0.1.3') => cache.cacheKey({ appVersion, pluginId: id, version: record.version, manifestSha256: record.manifestSha256 })

it.each([true, false])('activation install/enable/disable/restart/remove keeps settings=%s', async keepSettings => {
  const r = runtime(), x = host(r.activation)
  expect(await x.h.installPaths([await source()])).toMatchObject({ ok: true })
  expect(r.active.get(pluginId)).toBe(true)
  await x.h.setEnabled(pluginId, false); expect(r.active.get(pluginId)).toBe(false)
  await x.h.setEnabled(pluginId, true); expect(r.active.get(pluginId)).toBe(true)
  const record = await indexed(x)
  const restarted = runtime(), h = new PluginHost({ ...x.options, activation: restarted.activation })
  await h.start(); await h.start()
  expect(restarted.activation.activate).toHaveBeenCalledTimes(1)
  x.store.load('{"plugins":{"acme.sample":{"saved":42},"other.plugin":{"saved":7}}}')
  await h.remove(pluginId, { keepSettings })
  expect(restarted.active.has(pluginId)).toBe(false)
  expect(await h.list()).toEqual([])
  expect(await cache.readPayload(path.join(x.root, '.cache'), keyFor(record))).toMatchObject({ hit: false })
  await x.store.flush()
  if (!keepSettings) expect(JSON.parse(x.write.mock.calls.at(-1)![0]).plugins?.[pluginId]).toBeUndefined()
})

it.each(['absent', 'corrupt', 'different-key', 'read-error'])('start recovers %s payload by compiling installed bytes', async mode => {
  const x = host(); await x.h.installPaths([await source()])
  const record = await indexed(x), cacheRoot = path.join(x.root, '.cache')
  const hit = await cache.readPayload(cacheRoot, keyFor(record)); expect(hit.hit).toBe(true)
  await cache.removePayload(cacheRoot, keyFor(record))
  if (mode === 'corrupt') {
    const names = await fs.readdir(cacheRoot)
    expect(names).toEqual(['catalog.json'])
    const { createHash } = await import('node:crypto')
    await fs.writeFile(path.join(cacheRoot, `${createHash('sha256').update(JSON.stringify(keyFor(record))).digest('hex')}.json`), '{broken')
  }
  if (mode === 'different-key' && hit.hit) await cache.writePayload(cacheRoot, keyFor(record, pluginId, '0.1.2'), hit.compiled)
  if (mode === 'read-error') vi.spyOn(cache, 'readPayload').mockRejectedValueOnce(new Error('/private/path'))
  const reads = vi.spyOn(fs, 'open'), r = runtime(), h = new PluginHost({ ...x.options, activation: r.activation })
  await h.start()
  expect(reads.mock.calls.some(([file]) => String(file).endsWith('plugin.json'))).toBe(true)
  expect(r.active.get(pluginId)).toBe(true)
  expect(await cache.readPayload(cacheRoot, keyFor(record))).toMatchObject({ hit: true })
})

it('payload written before a failed index commit leaves the old generation and start cleans the orphan', async () => {
  const r = runtime(), x = host(r.activation)
  await x.h.installPaths([await source()])
  const before = await indexed(x), original = installer.installPlugin
  vi.spyOn(installer, 'installPlugin').mockImplementationOnce((pkg, options) => original(pkg, { ...options, beforeIndex: async record => {
    await options.beforeIndex?.(record)
    throw new Error('crash before index')
  } }))
  expect(await x.h.installPaths([await source(true, { manifest: { version: '1.1.0' } })])).toMatchObject({ ok: false })
  expect(await indexed(x)).toEqual(before)
  expect((await fs.readdir(path.join(x.root, '.cache'))).filter(name => name !== 'catalog.json')).toHaveLength(2)
  const h = new PluginHost({ ...x.options, activation: runtime().activation })
  await h.start()
  expect((await fs.readdir(path.join(x.root, '.cache'))).filter(name => name !== 'catalog.json')).toHaveLength(1)
})

it('writePayload failure aborts publication; catalog failure is only a notice', async () => {
  const x = host(runtime().activation), file = await source()
  vi.spyOn(cache, 'writePayload').mockRejectedValueOnce(new Error('/secret/payload'))
  expect(await x.h.installPaths([file])).toMatchObject({ ok: false })
  expect((await readIndex(x.root)).plugins).toEqual({})
  expect(await fs.stat(path.join(x.root, pluginId, '1.0.0')).catch(() => null)).toBeNull()
  vi.spyOn(cache, 'writeCatalog').mockRejectedValueOnce(new Error('/secret/catalog'))
  expect(await x.h.installPaths([file])).toMatchObject({ ok: true, notices: [{ code: 'plugins.cache.catalog' }] })
  expect((await indexed(x)).enabled).toBe(true)
})

it.each(['activate', 'update'] as const)('%s failure disables the index, reports a safe error and allows removal', async operation => {
  const r = runtime(), x = host(r.activation)
  if (operation === 'update') await x.h.installPaths([await source()])
  r.activation[operation].mockImplementationOnce(() => { throw new Error('/secret/path\nstack') })
  expect(await x.h.installPaths([await source(true, { manifest: { version: operation === 'update' ? '1.1.0' : '1.0.0' } })])).toMatchObject({ ok: false, code: 'plugins.activation.failed' })
  expect((await indexed(x)).enabled).toBe(false)
  expect(r.active.get(pluginId)).not.toBe(true)
  expect((await x.h.list())[0].error).toBe('The plugin could not be activated. Reinstall or remove it.')
  await x.h.remove(pluginId, { keepSettings: true }); expect(await x.h.list()).toEqual([])
})

it('enable activates before the index and index failure compensates both enable and disable', async () => {
  const r = runtime(), x = host(r.activation)
  await x.h.installPaths([await source()]); await x.h.setEnabled(pluginId, false)
  const write = vi.spyOn(installer, 'setEnabled')
  write.mockImplementationOnce(async (_root, _id, enabled) => {
    expect(enabled).toBe(true); expect(r.active.get(pluginId)).toBe(true)
    expect((await indexed(x)).enabled).toBe(false)
    throw new Error('writeIndex')
  })
  await expect(x.h.setEnabled(pluginId, true)).rejects.toThrow('writeIndex')
  expect(r.active.get(pluginId)).toBe(false); expect((await indexed(x)).enabled).toBe(false)
  expect((await x.h.list())[0].error).toBeTruthy()
  await x.h.setEnabled(pluginId, true)
  write.mockImplementationOnce(async () => { expect(r.active.get(pluginId)).toBe(false); throw new Error('writeIndex') })
  await expect(x.h.setEnabled(pluginId, false)).rejects.toThrow('writeIndex')
  expect(r.active.get(pluginId)).toBe(true); expect((await indexed(x)).enabled).toBe(true)
})

it('enable/disable activation errors retain truthful flags and clear after success', async () => {
  const r = runtime(), x = host(r.activation)
  await x.h.installPaths([await source()])
  r.activation.deactivate.mockImplementationOnce(() => { throw new Error('deactivate') })
  await expect(x.h.setEnabled(pluginId, false)).rejects.toThrow()
  expect((await indexed(x)).enabled).toBe(true); expect((await x.h.list())[0].error).toBeTruthy()
  await x.h.setEnabled(pluginId, false)
  r.activation.activate.mockImplementationOnce(() => { throw new Error('activate') })
  await expect(x.h.setEnabled(pluginId, true)).rejects.toThrow()
  expect((await indexed(x)).enabled).toBe(false); expect((await x.h.list())[0].error).toBeTruthy()
  await x.h.setEnabled(pluginId, true); expect((await x.h.list())[0].error).toBeUndefined()
})

it('disableAll records only failed owners enabled in one write, and compensates index failure', async () => {
  const r = runtime(), x = host(r.activation)
  await x.h.installPaths([await source()])
  await x.h.installPaths([await source(true, { manifest: { id: 'acme.second' } })])
  r.activation.deactivate.mockImplementationOnce(() => { throw new Error('deactivate') })
  const write = vi.spyOn(installer, 'disableAll')
  await expect(x.h.disableAll()).rejects.toThrow('Some plugins')
  expect(write).toHaveBeenCalledTimes(1)
  const records = (await readIndex(x.root)).plugins
  expect(records[pluginId].enabled).toBe(true); expect(records['acme.second'].enabled).toBe(false)
  expect((await x.h.list()).find(item => item.id === pluginId)?.error).toBeTruthy()
  write.mockRejectedValueOnce(new Error('writeIndex'))
  await expect(x.h.disableAll()).rejects.toThrow('writeIndex')
  expect(r.active.get(pluginId)).toBe(true); expect((await indexed(x)).enabled).toBe(true)
  await x.h.disableAll(); expect([...r.active.values()]).toEqual([false, false])
})

it('remove failure preserves the index and uninstall failure reactivates the removed generation', async () => {
  const r = runtime(), x = host(r.activation)
  await x.h.installPaths([await source()])
  r.activation.remove.mockImplementationOnce(() => { throw new Error('remove') })
  await expect(x.h.remove(pluginId, { keepSettings: true })).rejects.toThrow()
  expect((await indexed(x)).enabled).toBe(true); expect((await x.h.list())[0].error).toBeTruthy()
  vi.spyOn(installer, 'uninstallPlugin').mockRejectedValueOnce(new Error('writeIndex'))
  await expect(x.h.remove(pluginId, { keepSettings: true })).rejects.toThrow('writeIndex')
  expect(r.active.get(pluginId)).toBe(true)
  expect(r.activation.activate).toHaveBeenCalledTimes(2)
  expect(r.payloads.get(pluginId)?.pluginId).toBe(pluginId)
  expect((await indexed(x)).enabled).toBe(true)
  await x.h.remove(pluginId, { keepSettings: true }); expect(await x.h.list()).toEqual([])
})

it('real activation reconciles update and rollback against the selected settings declaration', async () => {
  const x = host()
  type Handle = { owner: string; compiled: CompiledPlugin; enabled: boolean }
  const adapters = { publish: (operation: () => void) => operation() } as ActivationAdapters<Record<typeof activationKinds[number], Handle>>
  for (const kind of activationKinds) adapters[kind] = {
    prepare: (owner, compiled, context) => ({ owner, compiled, enabled: context.enabled }),
    commit: ({ owner, compiled, enabled }) => {
      if (kind !== 'settings') return
      for (const entry of x.registry.all()) if (entry.owner?.id === owner) x.registry.remove(entry.id)
      const definitions = compiledPluginSettings(compiled)
      for (const entry of definitions.settings) x.registry.defineSetting({ ...entry, validator: definitions.validators.get(entry.id), owner: { id: owner, enabled } })
    },
    remove: owner => { if (kind === 'settings') for (const entry of x.registry.all()) if (entry.owner?.id === owner) x.registry.remove(entry.id) },
  }
  x.options.activation = createActivation(adapters)
  const old = { type: 'number' as const, default: 2, label: 'Count', min: 0, max: 20 }
  expect(await x.h.installPaths([await source(true, { manifest: { contributes: { configuration: { title: 'Sample', properties: { count: old } } } } })])).toMatchObject({ ok: true })
  x.store.set(`${pluginId}:count`, 12)
  expect(await x.h.installPaths([await source(true, { manifest: { version: '1.1.0', contributes: { configuration: { title: 'Sample', properties: { count: { ...old, max: 10, default: 3 } } } } } })])).toMatchObject({ ok: true })
  expect(x.store.get(`${pluginId}:count`)).toBe(3)
  x.store.set(`${pluginId}:count`, 8)
  await x.h.rollback(pluginId)
  expect((await indexed(x)).version).toBe('1.0.0')
  expect(x.registry.get(`${pluginId}:count`)?.max).toBe(20)
  expect(x.store.get(`${pluginId}:count`)).toBe(8)
  await x.h.setEnabled(pluginId, false); await x.h.rollback(pluginId)
  expect(x.registry.get(`${pluginId}:count`)?.max).toBe(10)
  expect((await indexed(x)).enabled).toBe(false)
})

it('rollback payload failure preserves the index; activation failure disables the selected version', async () => {
  const r = runtime(), x = host(r.activation)
  await x.h.installPaths([await source()]); await x.h.installPaths([await source(true, { manifest: { version: '1.1.0' } })])
  vi.spyOn(cache, 'writePayload').mockRejectedValueOnce(new Error('writePayload'))
  await expect(x.h.rollback(pluginId)).rejects.toThrow('writePayload')
  expect((await indexed(x)).version).toBe('1.1.0')
  r.activation.update.mockImplementationOnce(() => { throw new Error('update') })
  await expect(x.h.rollback(pluginId)).rejects.toThrow('activated')
  expect(await indexed(x)).toMatchObject({ version: '1.0.0', enabled: false })
  expect((await x.h.list())[0].error).toBeTruthy()
})

it('start cancellation and a broken middle plugin leave other generations restorable and index untouched', async () => {
  const x = host()
  for (const id of ['acme.first', 'acme.broken', 'acme.last']) await x.h.installPaths([await source(true, { manifest: { id } })])
  const before = await fs.readFile(path.join(x.root, 'installed.json')), r = runtime(), abort = new AbortController()
  r.activation.activate.mockImplementationOnce((id, compiled) => { r.active.set(id, true); r.payloads.set(id, compiled); abort.abort() })
  const h = new PluginHost({ ...x.options, activation: r.activation })
  await h.start({ signal: abort.signal }); expect(r.activation.activate).toHaveBeenCalledTimes(1)
  r.activation.activate.mockImplementationOnce(() => { throw new Error('/secret/invalid') })
  await h.start()
  expect(r.active.get('acme.first')).toBe(true); expect(r.active.get('acme.last')).toBe(true)
  expect((await h.list()).find(item => item.id === 'acme.broken')?.error).toBeTruthy()
  expect(await fs.readFile(path.join(x.root, 'installed.json'))).toEqual(before)
  await h.start(); expect(r.activation.activate).toHaveBeenCalledTimes(4)
  expect((await h.list()).find(item => item.id === 'acme.broken')?.error).toBeUndefined()
})

it('50 payload hits never open manifests and yield in batches of eight within time/heap budgets', async () => {
  const x = host(); await x.h.installPaths([await source()])
  const record = await indexed(x), root = path.join(x.root, '.cache'), read = await cache.readPayload(root, keyFor(record))
  if (!read.hit) throw new Error('fixture cache missing')
  const records: Record<string, typeof record> = {}
  for (let i = 0; i < 50; i++) {
    const id = `acme.plugin-${i}`
    records[id] = record
    await cache.writePayload(root, keyFor(record, id), { ...read.compiled, pluginId: id, contribution: { ...read.compiled.contribution, pluginId: id } })
  }
  await fs.writeFile(path.join(x.root, 'installed.json'), JSON.stringify({ schema: 1, plugins: records }))
  const opens = vi.spyOn(fs, 'open'), r = runtime(), h = new PluginHost({ ...x.options, activation: r.activation })
  let running = true, peak = process.memoryUsage().heapUsed, maxGap = 0, last = performance.now(), perTurn = 0, maxPerTurn = 0
  const baseline = peak
  const probe = () => {
    const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now
    peak = Math.max(peak, process.memoryUsage().heapUsed); maxPerTurn = Math.max(maxPerTurn, perTurn); perTurn = 0
    if (running) setImmediate(probe)
  }
  r.activation.activate.mockImplementation((id, compiled) => { perTurn++; r.active.set(id, true); r.payloads.set(id, compiled) })
  setImmediate(probe)
  try { await h.start() } finally { running = false }
  expect(r.activation.activate).toHaveBeenCalledTimes(50)
  expect(opens.mock.calls.filter(([file]) => String(file).endsWith('plugin.json'))).toEqual([])
  expect(maxPerTurn).toBeLessThanOrEqual(8); expect(maxGap).toBeLessThan(50)
  expect(peak - baseline).toBeLessThan(40 * 1024 ** 2)
  process.stdout.write(`plugin start/50 hits: max task ${maxGap.toFixed(2)} ms; heap growth ${((peak - baseline) / 1024 ** 2).toFixed(2)} MiB; max batch ${maxPerTurn}\n`)
  await h.start(); expect(r.activation.activate).toHaveBeenCalledTimes(50)
  // Absolute heap is measured outside Vitest's own heap, as in install.test.ts.
  const metrics = await new Promise<{ heap: number; gap: number; calls: number; manifests: number }>((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const fs = (await import('node:fs/promises')).default;
        const { PluginHost } = await import(workerData.host);
        const { SettingsRegistry } = await import(workerData.registry);
        const { SettingsStore } = await import(workerData.store);
        const registry = new SettingsRegistry(), store = new SettingsStore(registry, async () => {});
        let manifests = 0, calls = 0, heap = process.memoryUsage().heapUsed, gap = 0, last = performance.now();
        const open = fs.open;
        fs.open = (...args) => { if (String(args[0]).endsWith('plugin.json')) manifests++; return open(...args); };
        const sample = () => { const now = performance.now(); gap = Math.max(gap, now-last); last = now; heap = Math.max(heap, process.memoryUsage().heapUsed); };
        const timer = setInterval(sample, 1);
        const h = new PluginHost({ root: workerData.root, appVersion: '0.1.3', registry, store,
          confirm: async () => true, openPath: async () => '', changed: () => {},
          compileIO: { knownCommands: new Set(), knownLanguages: new Set(), builtinExtensions: new Set(), declaredTokens: new Set(), knownLocaleKeys: new Set() },
          activation: { activate: () => { calls++; sample(); }, update: () => {}, deactivate: () => {}, remove: () => {} } });
        try { await h.start(); sample(); } finally { clearInterval(timer); }
        parentPort.postMessage({ heap: heap/1024**2, gap, calls, manifests });
      })().catch(error => { throw error; });
    `, { eval: true, execArgv: ['--experimental-strip-types'], workerData: { root: x.root,
      host: new URL('./host.ts', import.meta.url).href, registry: new URL('../settings/registry.ts', import.meta.url).href, store: new URL('../settings/store.ts', import.meta.url).href } })
    worker.once('message', resolve); worker.once('error', reject)
    worker.once('exit', code => { if (code !== 0) reject(new Error(`Start budget worker exited ${code}`)) })
  })
  console.info('START_BUDGET', JSON.stringify(metrics))
  expect(metrics.heap).toBeLessThan(40); expect(metrics.gap).toBeLessThan(50)
  expect(metrics.calls).toBe(50); expect(metrics.manifests).toBe(0)
})
