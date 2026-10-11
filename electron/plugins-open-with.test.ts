import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMain } from 'electron'
import { RootRegistry } from '../core/roots.ts'
import { writeZip } from '../core/archive/writer.ts'
import { compilePlugin, type CompiledPlugin } from '../core/plugins/compile.ts'
import { parseManifest } from '../core/plugins/manifest.ts'
import { ExecutableCatalog } from '../core/plugins/executables.ts'
import { commandHash, RunHost } from './run-host.ts'
import { SnapshotHost } from './snapshot-host.ts'

vi.mock('electron', () => ({ app: { getVersion: () => 'test', getAppPath: () => process.cwd(), getLocale: () => 'en' }, BrowserWindow: class {}, clipboard: {}, dialog: {}, ipcMain: {}, session: {}, shell: {}, webFrameMain: {}, protocol: {}, net: {} }))
vi.mock('./ui-protocol.ts', () => ({ UI_ORIGIN: 'fb-ui://host' }))

let dir: string, root: string, roots: RootRegistry, output: string, catalog: ExecutableCatalog, host: RunHost
let configured: unknown, copies: string[]
let plugin: Pick<CompiledPlugin, 'pluginId' | 'configuration' | 'commands' | 'openWith'>
const confirm = vi.fn(async () => ({ execute: true, always: false }))
const win = {} as BrowserWindow
const request = () => ({ root, path: '-a.txt', commandId: 'owner:open:colon' })
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-plugin-run-')); await fs.mkdir(path.join(dir, 'root'))
  roots = new RootRegistry(); const opened = await roots.openPath(path.join(dir, 'root')); if ('error' in opened) throw new Error(opened.error); root = opened.root.id
  await fs.writeFile(path.join(dir, 'root', '-a.txt'), 'disk')
  const script = path.join(dir, 'record.cjs'); output = path.join(dir, 'argv.json')
  await fs.writeFile(script, 'require("node:fs").writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)))')
  plugin = { pluginId: 'owner', configuration: [{ id: 'owner:arg', property: { label: 'Argument', type: 'string', default: '{file}' } }], commands: [], openWith: [{ id: request().commandId, label: 'Plugin', extensions: ['.txt'], program: process.execPath, args: [{ kind: 'text', value: script }, { kind: 'text', value: output }, { kind: 'file' }, { kind: 'setting', key: 'arg' }, ...['$', '&', '"quotes"', '-x', '{file}'].map(value => ({ kind: 'text' as const, value }))] }] }
  configured = undefined; copies = []; catalog = new ExecutableCatalog(() => configured); catalog.replace('1', plugin)
  confirm.mockReset(); confirm.mockResolvedValue({ execute: true, always: false })
  host = new RunHost(dir, roots, () => [], copy => copies.push(copy), confirm, catalog)
})
afterEach(async () => { vi.restoreAllMocks(); for (const copy of copies) await fs.rm(copy, { recursive: true, force: true }); await roots.close(root); await fs.rm(dir, { recursive: true, force: true }) })
async function received(): Promise<string[]> { let result!: string[]; await vi.waitFor(async () => { result = JSON.parse(await fs.readFile(output, 'utf8')) }); return result }

describe('plugin execution through the main host', () => {
  it('executes a parsed and compiled manifest with a local setting through a real subprocess', async () => {
    const parsed = parseManifest({
      schema: 1, id: 'owner.sample', name: 'Owner', version: '1.0.0',
      publisher: { id: 'owner', name: 'Owner', key: `ed25519:${'ab'.repeat(32)}` },
      engines: { folderBrowser: '>=0.1.0 <1.0.0', api: 1 }, uses: [], activation: ['onStartupFinished'], files: {},
      contributes: {
        configuration: { title: 'Arguments', properties: { arg: { label: 'Argument', type: 'string', default: '{file} $ & " -x' } } },
        commands: [{ id: 'owner.sample:run', title: 'Run', category: 'tools', exec: { program: process.execPath, args: [path.join(dir, 'record.cjs'), output, '{setting:arg}', '{file}'] } }],
      },
    })
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
    const result = await compilePlugin(parsed.manifest, {
      readFile: async () => { throw new Error('No package files expected') },
      knownCommands: new Set(), knownLanguages: new Set(), builtinExtensions: new Set(), declaredTokens: new Set(), knownLocaleKeys: new Set(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    expect(result.compiled.configuration[0].id).toBe('arg')
    catalog.replace(parsed.manifest.version, result.compiled)
    expect(await host.run(win, { ...request(), commandId: 'owner.sample:run' })).toMatchObject({ opened: true })
    expect(await received()).toEqual(['{file} $ & " -x', path.join(dir, 'root', '-a.txt')])
    expect(result.compiled.configuration[0].id).toBe('arg')
    configured = 'updated {file}'
    await fs.rm(output)
    expect(await host.run(win, { ...request(), commandId: 'owner.sample:run' })).toMatchObject({ opened: true })
    expect(await received()).toEqual(['updated {file}', path.join(dir, 'root', '-a.txt')])
  })
  it('delivers typed and literal hostile arguments through the registered handler to a real subprocess', async () => {
    const frame = { url: 'fb-ui://host/index.html' }, sender = { mainFrame: frame }, window = { webContents: sender } as unknown as BrowserWindow
    let handler!: (...args: any[]) => any
    host.register({ handle: (_channel, cb) => { handler = cb } } as Pick<IpcMain, 'handle'>, () => window)
    expect(await handler({ sender, senderFrame: { ...frame } }, request())).toMatchObject({ message: 'refused' })
    expect(await handler({ sender, senderFrame: frame }, { ...request(), args: ['injected'] })).toMatchObject({ opened: false })
    expect(await handler({ sender, senderFrame: frame }, request())).toMatchObject({ opened: true })
    expect(await received()).toEqual([path.join(dir, 'root', '-a.txt'), '{file}', '$', '&', '"quotes"', '-x', '{file}'])
  })
  it.each(['setting', 'disable', 'update', 'disable-enable'] as const)('refuses a %s race while confirming', async mode => {
    confirm.mockImplementationOnce(async () => {
      if (mode === 'setting') configured = 'changed'
      else if (mode === 'update') catalog.replace('2', plugin)
      else { catalog.remove('owner'); if (mode === 'disable-enable') catalog.replace('1', plugin) }
      return { execute: true, always: true }
    })
    expect(await host.run(win, request())).toMatchObject({ opened: false, message: 'Command changed; try again' })
    expect(await fs.stat(output).catch(() => null)).toBeNull()
  })
  it('revalidates after asynchronous PATH resolution immediately before spawn', async () => {
    if (process.platform === 'win32') return
    await fs.symlink(process.execPath, path.join(dir, 'plugin-node'))
    plugin.openWith = [{ ...plugin.openWith[0], program: 'plugin-node' }]; catalog.replace('1', plugin)
    vi.stubEnv('PATH', dir)
    const access = fs.access.bind(fs)
    vi.spyOn(fs, 'access').mockImplementation(async (...args) => { await access(...args); catalog.remove('owner') })
    try { expect(await host.run(win, request())).toMatchObject({ opened: false, message: 'Command changed; try again' }); expect(await fs.stat(output).catch(() => null)).toBeNull() }
    finally { vi.unstubAllEnvs() }
  })
  it('stages a ZIP entry in streaming mode and refuses an escaping symlink', async () => {
    await writeZip(path.join(dir, 'root', 'pack.zip'), [{ name: 'a.txt', data: 'zip' }])
    expect(await host.run(win, { ...request(), path: 'pack.zip!/a.txt' })).toMatchObject({ opened: true })
    const args = await received(); expect(await fs.readFile(args[0], 'utf8')).toBe('zip'); expect((await fs.stat(args[0])).mode & 0o777).toBe(0o400)
    await fs.rm(output); await fs.writeFile(path.join(dir, 'outside.txt'), 'outside'); await fs.symlink(path.join(dir, 'outside.txt'), path.join(dir, 'root', 'link.txt'))
    expect(await host.run(win, { ...request(), path: 'link.txt' })).toMatchObject({ opened: false })
    expect(await fs.stat(output).catch(() => null)).toBeNull()
  })
  it('loads persisted confirmations for colon ids and hashes version and relevant settings', async () => {
    confirm.mockResolvedValue({ execute: true, always: true })
    await host.run(win, request()); await received(); const hash = commandHash(catalog.get(request().commandId)!)
    host = new RunHost(dir, roots, () => [], () => {}, confirm, catalog)
    await host.run(win, request()); await received(); expect(confirm).toHaveBeenCalledTimes(1)
    configured = 'different'; expect(commandHash(catalog.get(request().commandId)!)).not.toBe(hash)
    catalog.replace('2', plugin); expect(commandHash(catalog.get(request().commandId)!)).not.toBe(hash)
  })
  it('refuses a stale chooser token after update, using the actual chooser selection method', async () => {
    // Only Electron UI/native APIs are replaced: chooser selection, roots, staging cleanup and runner are production code.
    const chooser = Object.create(SnapshotHost.prototype) as SnapshotHost
    const scratch = path.join(dir, 'choice'); await fs.mkdir(scratch)
    Object.assign(chooser, { runHost: host, staged: new Set([scratch]), choosing: new Map([['token', { dir: scratch, file: path.join(scratch, 'a.txt'), apps: new Map(), mime: '', custom: { root, path: '-a.txt', ids: new Map([[request().commandId, commandHash(catalog.get(request().commandId)!)]]) } }]]) })
    catalog.replace('2', plugin)
    const result = await (chooser as unknown as { openWithApp(win: BrowserWindow, token: string, id: string, always: boolean): Promise<unknown> }).openWithApp(win, 'token', `fb:command:${request().commandId}`, false)
    expect(result).toMatchObject({ opened: false, message: 'Command changed; try again' }); expect(confirm).not.toHaveBeenCalled(); expect(await fs.stat(scratch).catch(() => null)).toBeNull()
  })
  it('invalidates a persisted confirmation when only the plugin version changes', async () => {
    const original = catalog.get(request().commandId)!
    let version = original.version
    const list = catalog.list.bind(catalog)
    vi.spyOn(catalog, 'list').mockImplementation(file => list(file).map(command => ({ ...command, version })))
    confirm.mockResolvedValue({ execute: true, always: true })
    expect(await host.run(win, request())).toMatchObject({ opened: true }); await received()
    const hash = commandHash(host.commands()[0])
    version = '2'
    const updated = host.commands()[0]
    expect(updated).toEqual({ ...original, version: '2' })
    expect(updated.generation).toBe(original.generation)
    expect(commandHash(updated)).not.toBe(hash)
    host = new RunHost(dir, roots, () => [], () => {}, confirm, catalog)
    await fs.rm(output)
    expect(await host.run(win, request())).toMatchObject({ opened: true }); await received()
    expect(confirm).toHaveBeenCalledTimes(2)
  })
  it('diagnoses aggregate user/plugin overflow before confirmation', async () => {
    const user = Array.from({ length: 100 }, (_, i) => ({ id: `user-${i}`, name: 'User', program: process.execPath, args: [] }))
    host = new RunHost(dir, roots, () => user, () => {}, confirm, catalog)
    expect(await host.run(win, request())).toMatchObject({ opened: false, message: expect.stringMatching(/100 entries/) }); expect(confirm).not.toHaveBeenCalled()
  })
  it.each(['disable', 'remove', 'update'] as const)('refuses %s while an already-open chooser is being cleaned up', async mode => {
    const chooser = Object.create(SnapshotHost.prototype) as SnapshotHost
    const scratch = path.join(dir, 'choice'); await fs.mkdir(scratch)
    const chosenHash = commandHash(catalog.get(request().commandId)!)
    Object.assign(chooser, { runHost: host, staged: new Set([scratch]), choosing: new Map([['token', { dir: scratch, file: path.join(scratch, 'a.txt'), apps: new Map(), mime: '', custom: { root, path: '-a.txt', ids: new Map([[request().commandId, chosenHash]]) } }]]) })
    let entered!: () => void, resume!: () => void
    const cleaning = new Promise<void>(resolve => { entered = resolve })
    const release = new Promise<void>(resolve => { resume = resolve })
    const rm = fs.rm.bind(fs)
    vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
      if (file === scratch) { entered(); await release }
      return rm(file, options)
    })
    const selection = (chooser as unknown as { openWithApp(win: BrowserWindow, token: string, id: string, always: boolean): Promise<unknown> }).openWithApp(win, 'token', `fb:command:${request().commandId}`, false)
    await cleaning
    try {
      if (mode === 'update') catalog.replace('2', plugin)
      else {
        catalog.remove('owner')
        // Re-register before cleanup finishes: only the original token's hash detects this cycle.
        catalog.replace('1', plugin)
      }
      expect(commandHash(catalog.get(request().commandId)!)).not.toBe(chosenHash)
    } finally { resume() }
    expect(await selection).toMatchObject({ opened: false, message: 'Command changed; try again' })
    expect(confirm).not.toHaveBeenCalled()
    expect(await fs.stat(output).catch(() => null)).toBeNull()
    expect(await fs.stat(scratch).catch(() => null)).toBeNull()
  })
  it.each(['disable', 'remove', 'update'] as const)('refuses %s after the chooser opens and before selection', async mode => {
    const chooser = Object.create(SnapshotHost.prototype) as SnapshotHost
    const scratch = path.join(dir, 'choice'); await fs.mkdir(scratch)
    Object.assign(chooser, { runHost: host, staged: new Set([scratch]), choosing: new Map([['token', { dir: scratch, file: path.join(scratch, 'a.txt'), apps: new Map(), mime: '', custom: { root, path: '-a.txt', ids: new Map([[request().commandId, commandHash(catalog.get(request().commandId)!)]]) } }]]) })
    if (mode === 'update') catalog.replace('2', plugin)
    else catalog.remove('owner')
    expect(await (chooser as unknown as { openWithApp(win: BrowserWindow, token: string, id: string, always: boolean): Promise<unknown> }).openWithApp(win, 'token', `fb:command:${request().commandId}`, false)).toMatchObject({ opened: false, message: 'Command changed; try again' })
    expect(confirm).not.toHaveBeenCalled()
    expect(await fs.stat(output).catch(() => null)).toBeNull()
    expect(await fs.stat(scratch).catch(() => null)).toBeNull()
  })
})
