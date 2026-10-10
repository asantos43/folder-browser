import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { buildPlugin, buildPluginFolder, removePluginFixture } from '../../fixtures/plugins.ts'
import { PluginHost, toSummary } from './host.ts'
import { readIndex } from './install.ts'
import * as installer from './install.ts'
import { SettingsRegistry } from '../settings/registry.ts'
import { SettingsStore } from '../settings/store.ts'
import type { PluginSummary } from './summary.ts'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-plugin-host-')) })
afterEach(async () => { vi.restoreAllMocks(); await removePluginFixture(dir) })
function host() {
  const root = path.join(dir, 'plugins'), registry = new SettingsRegistry(), write = vi.fn(async (_contents: string) => {})
  const store = new SettingsStore(registry, write), confirm = vi.fn(async (_summary: PluginSummary) => true), openPath = vi.fn(async (_file: string) => ''), changed = vi.fn()
  const h = new PluginHost({ root, appVersion: '0.1.3', registry, store, confirm, openPath, changed,
    compileIO: { knownCommands: new Set(['openFile']), knownLanguages: new Set(['javascript']), builtinExtensions: new Set(['.js']), declaredTokens: new Set(['vscode-editor-background']), knownLocaleKeys: new Set(['menu.file']) } })
  return { h, root, registry, store, confirm, openPath, changed, write }
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
