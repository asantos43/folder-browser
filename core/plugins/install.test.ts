import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { Worker } from 'node:worker_threads'
import { buildPlugin } from '../../fixtures/plugins.ts'
import { readPackage, type PluginPackage } from './package.ts'
import { installPlugin, readIndex, listInstalled, rollbackPlugin, uninstallPlugin, setEnabled, disableAll, cleanStaging, type InstallResult } from './install.ts'

const yields = vi.hoisted(() => ({ calls: 0 }))
vi.mock('node:timers/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:timers/promises')>()
  return { ...actual, setImmediate: ((...args: Parameters<typeof actual.setImmediate>) => { yields.calls++; return actual.setImmediate(...args) }) as typeof actual.setImmediate }
})

let dir: string, root: string
const packages: PluginPackage[] = []
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-install-')); root = path.join(dir, 'plugins') })
async function writable(target: string): Promise<void> {
  const st = await fs.lstat(target); if (st.isSymbolicLink()) return
  await fs.chmod(target, st.isDirectory() ? 0o755 : 0o644)
  if (st.isDirectory()) for (const name of await fs.readdir(target)) await writable(path.join(target, name))
}
afterEach(async () => { vi.restoreAllMocks(); for (const p of packages.splice(0)) await p.close(); await writable(dir); await fs.rm(dir, { recursive: true, force: true }) })
async function pkg(version = '1.0.0', options: { zip?: boolean; code?: boolean; signed?: boolean; files?: Record<string, Buffer | string>; id?: string; engine?: string } = {}) {
  const source = path.join(dir, `source-${packages.length}`), zip = `${source}.fbplugin`
  const fixture = await buildPlugin({ ...(options.zip ? { file: zip } : {}), ...(options.signed ? { signWith: generateKeyPairSync('ed25519') } : {}),
    files: options.files ?? (options.code ? { 'main.js': '// never executed' } : { 'a.txt': 'alpha', 'nested/b.txt': 'beta', 'c.txt': 'gamma' }),
    manifest: { version, ...(options.id ? { id: options.id } : {}), ...(options.code ? { main: 'main.js' } : {}), ...(options.engine ? { engines: { folderBrowser: options.engine, api: 1 } } : {}) } })
  if (!options.zip) {
    await fs.mkdir(source)
    for (const e of fixture.entries) { const target = path.join(source, e.name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, e.data) }
  }
  const result = await readPackage(options.zip ? { kind: 'zip', file: zip } : { kind: 'folder', dir: source })
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  packages.push(result.package); return result.package
}
const install = (p: PluginPackage, extra = {}) => installPlugin(p, { root, origin: 'file', appVersion: '0.1.3', ...extra })
function accepted(r: InstallResult) { expect(r.ok, JSON.stringify(r)).toBe(true); if (!r.ok) throw new Error(r.error.code); return r.record }
function code(r: InstallResult) { if (r.ok) throw new Error('Unexpected acceptance'); return r.error.code }
async function emptyStaging() { expect(await fs.readdir(path.join(root, '.staging')).catch(() => [])).toEqual([]) }

it.each([false, true])('installs exact verified bytes and read-only tree (zip=%s)', async zip => {
  const p = await pkg('1.0.0', { zip, signed: true }), r = accepted(await install(p))
  expect(r.enabled).toBe(true); expect(r.trust).toBe('signed-unknown'); expect(r.signerFingerprint).toBe(p.signature.signed ? p.signature.fingerprint : undefined)
  const dest = path.join(root, 'acme.sample/1.0.0')
  expect(await fs.readFile(path.join(dest, 'plugin.json'))).toEqual(p.manifestBytes)
  expect(await fs.readFile(path.join(dest, 'SIGNATURE'))).toEqual(p.signatureBytes)
  for (const file of p.files) {
    const bytes = await fs.readFile(path.join(dest, file.path))
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(file.sha256)
    if (process.platform !== 'win32') expect((await fs.stat(path.join(dest, file.path))).mode & 0o777).toBe(0o444)
  }
  if (process.platform !== 'win32') expect((await fs.stat(dest)).mode & 0o777).toBe(0o555)
  expect((await listInstalled(root)).length).toBe(1); await emptyStaging()
})
it('updates, preserves enabled, retains one previous, rolls back and permits explicit downgrade', async () => {
  accepted(await install(await pkg())); await setEnabled(root, 'acme.sample', false)
  const second = accepted(await install(await pkg('1.1.0'))); expect(second.previous).toBe('1.0.0'); expect(second.enabled).toBe(false)
  expect((await rollbackPlugin(root, 'acme.sample')).version).toBe('1.0.0')
  expect((await rollbackPlugin(root, 'acme.sample')).version).toBe('1.1.0')
  accepted(await install(await pkg('1.2.0')))
  expect(await fs.readdir(path.join(root, 'acme.sample'))).toEqual(['1.1.0', '1.2.0'])
  expect(code(await install(await pkg('1.2.0')))).toBe('install.same-version')
  expect(code(await install(await pkg('1.0.0')))).toBe('install.downgrade')
  expect(accepted(await install(await pkg('1.0.0'), { allowDowngrade: true })).previous).toBe('1.2.0')
})
it('refuses unsupported engine and code without developer mode; code starts disabled', async () => {
  expect(code(await install(await pkg('1.0.0', { engine: '>=2.0.0' })))).toBe('install.engine.unsupported')
  const p = await pkg('1.0.0', { code: true })
  expect(code(await install(p))).toBe('install.code.needs-developer-mode')
  expect(accepted(await install(p, { developerMode: true })).enabled).toBe(false)
  await expect(rollbackPlugin(root, 'acme.sample')).rejects.toMatchObject({ detail: { code: 'install.rollback.none' } })
})
it.each(['third-read', 'hash', 'full', 'index'])('failure %s preserves current version and cleans staging', async failure => {
  accepted(await install(await pkg())); const before = await fs.readFile(path.join(root, 'installed.json'))
  const p = await pkg('1.1.0'), open = p.openStream; let calls = 0
  if (failure === 'third-read') p.openStream = async name => { if (++calls === 3) throw new Error('Synthetic read failure'); return open(name) }
  if (failure === 'hash') p.openStream = async () => Readable.from(['evil'])
  if (failure === 'full') {
    const statfs = await fs.statfs(root); vi.spyOn(fs, 'statfs').mockResolvedValue({ ...statfs, bavail: 0 })
  }
  if (failure === 'index') {
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { if (String(from).includes('.installed-')) throw Object.assign(new Error('Full'), { code: 'ENOSPC' }); return rename(from, to) })
  }
  const r = await install(p); expect(r.ok).toBe(false)
  if (failure === 'hash') expect(code(r)).toBe('install.hash.mismatch')
  if (failure === 'full') expect(code(r)).toBe('install.disk.space')
  expect(await fs.readFile(path.join(root, 'installed.json'))).toEqual(before)
  expect(await fs.readdir(path.join(root, 'acme.sample'))).toEqual(['1.0.0']); await emptyStaging()
})
it('handles actual ENOSPC while streaming and keeps index intact', async () => {
  accepted(await install(await pkg())); const p = await pkg('1.1.0')
  p.openStream = async () => Readable.from((async function* () { yield Buffer.from('a'); throw Object.assign(new Error('Full'), { code: 'ENOSPC' }) })())
  expect(code(await install(p))).toBe('install.disk.failed')
  expect((await readIndex(root)).plugins['acme.sample'].version).toBe('1.0.0'); await emptyStaging()
})
it('restores both retained versions if the third version index publication fails', async () => {
  accepted(await install(await pkg())); accepted(await install(await pkg('1.1.0')))
  const p = await pkg('1.2.0'), rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { if (String(from).includes('.installed-')) throw new Error('Synthetic commit failure'); return rename(from, to) })
  expect((await install(p)).ok).toBe(false)
  expect(await fs.readdir(path.join(root, 'acme.sample'))).toEqual(['1.0.0', '1.1.0'])
  expect((await readIndex(root)).plugins['acme.sample'].previous).toBe('1.0.0'); await emptyStaging()
})
it('restores the plugin folder if uninstall index publication fails', async () => {
  accepted(await install(await pkg())); const rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { if (String(from).includes('.installed-')) throw new Error('Synthetic commit failure'); return rename(from, to) })
  await expect(uninstallPlugin(root, 'acme.sample', { keepSettings: false })).rejects.toThrow('Synthetic commit failure')
  expect((await readIndex(root)).plugins['acme.sample'].version).toBe('1.0.0')
  expect(await fs.readFile(path.join(root, 'acme.sample/1.0.0/a.txt'), 'utf8')).toBe('alpha'); await emptyStaging()
})
it('uninstalls read-only files and returns both settings choices', async () => {
  for (const keepSettings of [true, false]) {
    accepted(await install(await pkg()))
    expect(await uninstallPlugin(root, 'acme.sample', { keepSettings })).toEqual({ keepSettings })
    expect((await listInstalled(root)).length).toBe(0)
    await expect(fs.stat(path.join(root, 'acme.sample'))).rejects.toMatchObject({ code: 'ENOENT' }); await emptyStaging()
  }
})
it('changes enabled flags and disables the batch with one index rename', async () => {
  accepted(await install(await pkg())); accepted(await install(await pkg('1.0.0', { id: 'acme.other' })))
  await setEnabled(root, 'acme.sample', false); expect((await readIndex(root)).plugins['acme.sample'].enabled).toBe(false)
  await setEnabled(root, 'acme.sample', true)
  const spy = vi.spyOn(fs, 'rename'); await disableAll(root)
  expect(spy).toHaveBeenCalledTimes(1); expect((await listInstalled(root)).every(r => !r.enabled)).toBe(true)
})
it.each(['broken', 'proto', 'shape', 'oversize'])('rebuilds corrupt index %s and warns with disabled records', async kind => {
  accepted(await install(await pkg())); accepted(await install(await pkg('1.1.0')))
  const file = path.join(root, 'installed.json')
  const text = await fs.readFile(file, 'utf8')
  await fs.writeFile(file, kind === 'broken' ? '{bad' : kind === 'proto' ? text.replace('{', '{"__proto__":{},') : kind === 'oversize' ? 'x'.repeat(1024 * 1024 + 1) : text.replace('"enabled":true', '"enabled":42'))
  const index = await readIndex(root)
  expect(index.warnings?.[0].code).toBe('install.index.rebuilt'); expect(index.plugins['acme.sample'].enabled).toBe(false)
  expect(index.plugins['acme.sample'].version).toBe('1.1.0'); expect(index.plugins['acme.sample'].previous).toBe('1.0.0')
  expect((await fs.readdir(root)).some(n => n.startsWith('installed.json.bad-'))).toBe(true)
  expect(Object.isFrozen(index.plugins)).toBe(true)
})
it('refuses symlink root and child paths without writing outside', async () => {
  const outside = path.join(dir, 'outside'); await fs.mkdir(outside); await fs.symlink(outside, root, 'dir')
  expect(code(await install(await pkg()))).toBe('install.root.symlink')
  await fs.unlink(root); await fs.mkdir(root); await fs.symlink(outside, path.join(root, '.staging'), 'dir')
  expect(code(await install(await pkg()))).toBe('install.path.symlink'); expect(await fs.readdir(outside)).toEqual([])
})
it('serializes concurrent installs of the same id', async () => {
  const a = await pkg(), b = await pkg('1.1.0')
  const results = await Promise.all([install(a), install(b)])
  results.forEach(accepted); expect((await readIndex(root)).plugins['acme.sample'].previous).toBe('1.0.0')
  const again = await Promise.all([install(b), install(b)]); expect(again.map(code)).toEqual(['install.same-version', 'install.same-version'])
})
it('cleans only staging older than one hour', async () => {
  await fs.mkdir(path.join(root, '.staging/old'), { recursive: true }); await fs.mkdir(path.join(root, '.staging/new'))
  await fs.writeFile(path.join(root, '.staging/old/x'), 'x'); await fs.chmod(path.join(root, '.staging/old'), 0o555)
  const old = new Date(Date.now() - 3600001); await fs.utimes(path.join(root, '.staging/old'), old, old)
  await cleanStaging(root); expect(await fs.readdir(path.join(root, '.staging'))).toEqual(['new'])
})
it.each([
  ['engine', '!satisfies(opts.appVersion, m.engines.folderBrowser)', 'false', 'install.engine.unsupported'],
  ['code', 'pkg.hasCode && !opts.developerMode', 'false', 'install.code.needs-developer-mode'],
  ['same', 'old?.version === m.version', 'false', 'install.same-version'],
  ['downgrade', 'old && satisfies(m.version, `<${old.version}`) && !opts.allowDowngrade', 'false', 'install.downgrade'],
  ['space', 'st.bavail * st.bsize < pkg.totalBytes * 2', 'false', 'install.disk.space'],
  ['hash', 'size !== file.size || `sha256:${hash.digest(\'hex\')}` !== file.sha256 || file.sha256 !== m.files[file.path]?.toLowerCase()', 'false', 'install.hash.mismatch'],
  ['enabled', 'old?.enabled ?? !pkg.hasCode', 'true', 'disabled'],
  ['readonly', 'await fs.chmod(dest, 0o555)', 'await fs.chmod(dest, 0o755)', 'readonly'],
  ['rollback', 'record.previous = old.version; record.updatedAt', 'record.previous = undefined; record.updatedAt', 'previous'],
  ['proto', "index = parseIndex((await boundedRead(file, indexLimit)).toString('utf8'))", "index = JSON.parse((await boundedRead(file, indexLimit)).toString('utf8'))", 'rebuilt'],
] as const)('kills mutation of %s using the corresponding acceptance assertion', async (rule, from, to, expected) => {
  if (rule === 'readonly' && process.platform === 'win32') return
  await pkg(rule === 'downgrade' ? '0.9.0' : rule === 'enabled' || rule === 'rollback' ? '1.1.0' : '1.0.0', { code: rule === 'code', engine: rule === 'engine' ? '>=2.0.0' : undefined })
  const verdict = await new Promise<{ original: boolean; mutant: boolean }>((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData: d } = require('node:worker_threads');
      (async () => {
        const fs = (await import('node:fs/promises')).default;
        const { stripTypeScriptTypes } = await import('node:module');
        const source = await fs.readFile(new URL(d.installUrl), 'utf8');
        if (!source.includes(d.from)) throw new Error('Mutation target missing');
        const changed = source.replace(d.from, d.to).replace(/from '([^']+)'/g, (match, spec) => spec.startsWith('.') ? 'from '+JSON.stringify(new URL(spec, d.installUrl).href) : match);
        const mutant = await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(changed)).toString('base64'));
        const original = await import(d.installUrl), { readPackage } = await import(d.packageUrl);
        const answer = [];
        for (const [i, api] of [original, mutant].entries()) {
          const root = d.root+'-'+i;
          const result = await readPackage({ kind: 'folder', dir: d.source });
          if (!result.ok) throw new Error(JSON.stringify(result.errors));
          const p = result.package;
          if (['same','downgrade','enabled','rollback','proto'].includes(d.rule)) {
            const base = { ...p, manifest: { ...p.manifest, version: '1.0.0' } };
            // Use a valid exact manifest byte layout for the initial version.
            const raw = JSON.parse(p.manifestBytes.toString()); raw.version = '1.0.0'; base.manifestBytes = Buffer.from(JSON.stringify(raw));
            const { parseManifest } = await import(d.manifestUrl); base.manifest = parseManifest(base.manifestBytes.toString()).manifest;
            const initial = await original.installPlugin(base, { root, origin: 'file', appVersion: '0.1.3' });
            if (!initial.ok) throw new Error(JSON.stringify(initial));
            if (d.rule === 'enabled') await original.setEnabled(root, 'acme.sample', false);
          }
          if (d.rule === 'space') { await fs.mkdir(root, { recursive: true }); fs.statfs = async () => ({ bavail: 0, bsize: 4096 }); }
          if (d.rule === 'hash') { const { Readable } = await import('node:stream'); p.openStream = async name => Readable.from([Buffer.alloc(p.files.find(f => f.path === name).size, 120)]); }
          if (d.rule === 'proto') {
            const file = root+'/installed.json'; const text = await fs.readFile(file, 'utf8'); await fs.writeFile(file, text.replace('{', '{"__proto__":{},'));
            const index = await api.readIndex(root); answer.push(index.warnings?.[0]?.code === 'install.index.rebuilt');
          } else {
            const installed = await api.installPlugin(p, { root, origin: 'file', appVersion: '0.1.3' });
            answer.push(d.expected === 'disabled' ? installed.ok && !installed.record.enabled :
              d.expected === 'previous' ? installed.ok && installed.record.previous === '1.0.0' :
              d.expected === 'readonly' ? installed.ok && ((await fs.stat(root+'/acme.sample/1.0.0')).mode & 511) === 365 :
              !installed.ok && installed.error.code === d.expected);
          }
          await p.close();
        }
        parentPort.postMessage({ original: answer[0], mutant: answer[1] });
      })().catch(error => { throw error; });
    `, { eval: true, execArgv: ['--experimental-strip-types'], workerData: { rule, from, to, expected, root: path.join(dir, 'mutation'), source: path.join(dir, 'source-0'), installUrl: new URL('./install.ts', import.meta.url).href, packageUrl: new URL('./package.ts', import.meta.url).href, manifestUrl: new URL('./manifest.ts', import.meta.url).href } })
    worker.once('message', resolve); worker.once('error', reject)
    worker.once('exit', status => { if (status !== 0) reject(new Error(`Mutation worker exited ${status}`)) })
  })
  expect(verdict.original).toBe(true); expect(verdict.mutant).toBe(false)
})

const exists = (file: string) => fs.lstat(file).then(() => true, () => false)
async function outsideFolder() { const outside = path.join(dir, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), 'keep'); return outside }
const keep = async (outside: string) => expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep')

it.each(['../x', '__proto__', '', 'a/b.c', 'acme.sam\0ple', 'constructor.x', 'Acme.Sample', '.hidden.x'])('refuses the hostile id %j before anything else', async id => {
  const p = await pkg(), forged = { ...p, manifest: { ...p.manifest, id } } as PluginPackage
  expect(code(await install(forged))).toBe('install.id.invalid'); expect(await exists(root)).toBe(true); expect(await fs.readdir(root)).toEqual([])
  await expect(rollbackPlugin(root, id)).rejects.toMatchObject({ detail: { code: 'install.id.invalid' } })
  await expect(uninstallPlugin(root, id, { keepSettings: true })).rejects.toMatchObject({ detail: { code: 'install.id.invalid' } })
  await expect(setEnabled(root, id, false)).rejects.toMatchObject({ detail: { code: 'install.id.invalid' } })
})
it('refuses a package whose manifest object differs from its verified bytes', async () => {
  const p = await pkg(); expect(code(await install({ ...p, manifest: { ...p.manifest, name: 'Another name' } } as PluginPackage))).toBe('install.hash.mismatch')
  expect(await exists(path.join(root, 'acme.sample'))).toBe(false); await emptyStaging()
})
it('replaces an orphan version directory that the index does not record', async () => {
  accepted(await install(await pkg()))
  // A crash between the directory rename and the index leaves a read-only orphan with foreign content.
  const orphan = path.join(root, 'acme.sample/1.1.0'); await fs.mkdir(path.join(orphan, 'sub'), { recursive: true }); await fs.writeFile(path.join(orphan, 'sub/junk.txt'), 'junk')
  await fs.chmod(path.join(orphan, 'sub/junk.txt'), 0o444); await fs.chmod(path.join(orphan, 'sub'), 0o555); await fs.chmod(orphan, 0o555)
  const p = await pkg('1.1.0'), record = accepted(await install(p))
  expect(record.version).toBe('1.1.0'); expect(record.previous).toBe('1.0.0'); expect(await fs.readdir(path.join(root, 'acme.sample'))).toEqual(['1.0.0', '1.1.0'])
  expect(await exists(path.join(orphan, 'sub'))).toBe(false); expect(await fs.readFile(path.join(orphan, 'plugin.json'))).toEqual(p.manifestBytes); await emptyStaging()
})
it('reinstalls over its own directory when the index file was deleted', async () => {
  accepted(await install(await pkg())); await fs.rm(path.join(root, 'installed.json'))
  expect((await readIndex(root)).plugins['acme.sample']).toBeUndefined()
  const p = await pkg(), record = accepted(await install(p))
  expect(record.version).toBe('1.0.0'); expect(await fs.readFile(path.join(root, 'acme.sample/1.0.0/plugin.json'))).toEqual(p.manifestBytes)
  expect((await listInstalled(root)).length).toBe(1); await emptyStaging()
})
it('replaces an orphan that is a link without touching its target', async () => {
  accepted(await install(await pkg())); const outside = await outsideFolder()
  await fs.symlink(outside, path.join(root, 'acme.sample/1.1.0'), 'dir')
  accepted(await install(await pkg('1.1.0'))); await keep(outside)
  expect((await fs.lstat(path.join(root, 'acme.sample/1.1.0'))).isDirectory()).toBe(true); expect(await fs.readdir(outside)).toEqual(['keep.txt'])
})
it('keeps version.exists when the index records the version but the bytes differ', async () => {
  accepted(await install(await pkg())); accepted(await install(await pkg('1.1.0'))); const before = await fs.readFile(path.join(root, 'installed.json'))
  const other = await pkg('1.0.0', { files: { 'z.txt': 'different' } })
  expect(code(await install(other, { allowDowngrade: true }))).toBe('install.version.exists')
  expect(await fs.readFile(path.join(root, 'installed.json'))).toEqual(before); expect(await fs.readFile(path.join(root, 'acme.sample/1.0.0/a.txt'), 'utf8')).toBe('alpha'); await emptyStaging()
})
it('keeps the retained version when an identical package is installed again as a downgrade', async () => {
  accepted(await install(await pkg())); accepted(await install(await pkg('1.1.0')))
  const record = accepted(await install(await pkg(), { allowDowngrade: true })); expect(record.version).toBe('1.0.0'); expect(record.previous).toBe('1.1.0')
  expect(await fs.readdir(path.join(root, 'acme.sample'))).toEqual(['1.0.0', '1.1.0'])
})
it('removes a link found inside the staging folder without following it', async () => {
  const outside = await outsideFolder(); await fs.mkdir(path.join(root, '.staging'), { recursive: true })
  await fs.symlink(outside, path.join(root, '.staging/folder-link'), 'dir'); await fs.symlink(path.join(outside, 'keep.txt'), path.join(root, '.staging/file-link'))
  await fs.symlink(path.join(dir, 'nowhere'), path.join(root, '.staging/dangling')); await fs.mkdir(path.join(root, '.staging/fresh'))
  accepted(await install(await pkg())); await keep(outside); expect(await fs.readdir(outside)).toEqual(['keep.txt'])
  expect(await fs.readdir(path.join(root, '.staging'))).toEqual(['fresh'])
})
it('uninstalls a plugin that contains links without following them', async () => {
  accepted(await install(await pkg())); const outside = await outsideFolder(), version = path.join(root, 'acme.sample/1.0.0')
  await fs.chmod(version, 0o755); await fs.chmod(path.join(version, 'nested'), 0o755); await fs.symlink(outside, path.join(version, 'folder-link'), 'dir'); await fs.symlink(path.join(outside, 'keep.txt'), path.join(version, 'nested/file-link'))
  await fs.symlink(outside, path.join(root, 'acme.sample/link-beside'), 'dir'); await fs.symlink(path.join(dir, 'nowhere'), path.join(version, 'dangling'))
  expect(await uninstallPlugin(root, 'acme.sample', { keepSettings: false })).toEqual({ keepSettings: false })
  expect(await exists(path.join(root, 'acme.sample'))).toBe(false); expect((await listInstalled(root)).length).toBe(0)
  await keep(outside); expect(await fs.readdir(outside)).toEqual(['keep.txt']); await emptyStaging()
})
it('serializes two spellings of the same root', async () => {
  const alias = path.join(dir, 'alias'); await fs.symlink(dir, alias, 'dir')
  const a = await pkg(), b = await pkg('1.1.0'), other = path.join(alias, 'plugins')
  const statfs = fs.statfs.bind(fs); let calls = 0, entered!: () => void, release!: () => void
  const reached = new Promise<void>(r => { entered = r }), gate = new Promise<void>(r => { release = r })
  vi.spyOn(fs, 'statfs').mockImplementation((async (...args: Parameters<typeof fs.statfs>) => { if (++calls === 1) { entered(); await gate } return statfs(...args) }) as typeof fs.statfs)
  const first = installPlugin(a, { root, origin: 'file', appVersion: '0.1.3' }); await reached
  const second = installPlugin(b, { root: other, origin: 'file', appVersion: '0.1.3' })
  await new Promise(r => setTimeout(r, 200)); release()
  ;[await first, await second].forEach(accepted)
  const index = await readIndex(root); expect(index.plugins['acme.sample'].version).toBe('1.1.0'); expect(index.plugins['acme.sample'].previous).toBe('1.0.0')
})
it('reloads the index when the file changes in place, and only then', async () => {
  accepted(await install(await pkg())); const file = path.join(root, 'installed.json'), fixed = new Date(Date.now() - 100000)
  fixed.setMilliseconds(0); await fs.utimes(file, fixed, fixed)
  const first = await readIndex(root); expect(await readIndex(root)).toBe(first)
  const text = await fs.readFile(file, 'utf8')
  await fs.writeFile(file, text + ' '); await fs.utimes(file, fixed, fixed)
  const bigger = await readIndex(root); expect(bigger).not.toBe(first)
  await fs.writeFile(file, text + ' '); await fs.utimes(file, new Date(fixed.getTime() + 5000), new Date(fixed.getTime() + 5000))
  expect(await readIndex(root)).not.toBe(bigger)
  await fs.writeFile(file, text.replace('"enabled":true', '"enabled":false')); await fs.utimes(file, new Date(fixed.getTime() + 9000), new Date(fixed.getTime() + 9000))
  expect((await readIndex(root)).plugins['acme.sample'].enabled).toBe(false)
})
it.each([['top', (o: Record<string, any>) => { o.extra = 1 }], ['record', (o: Record<string, any>) => { o.plugins['acme.sample'].extra = 1 }],
  ['publisher', (o: Record<string, any>) => { o.plugins['acme.sample'].publisher.extra = 1 }], ['contributes', (o: Record<string, any>) => { o.plugins['acme.sample'].contributes.extra = 1 }],
] as const)('treats an unknown key in the %s object as corruption', async (_where, change) => {
  accepted(await install(await pkg())); const file = path.join(root, 'installed.json'), o = JSON.parse(await fs.readFile(file, 'utf8')); change(o)
  await fs.writeFile(file, JSON.stringify(o)); const index = await readIndex(root)
  expect(index.warnings?.[0].code).toBe('install.index.rebuilt'); expect(index.plugins['acme.sample'].enabled).toBe(false)
})
it('refuses to write an index over one mebibyte and leaves the file as it was', async () => {
  accepted(await install(await pkg())); const file = path.join(root, 'installed.json'), o = JSON.parse(await fs.readFile(file, 'utf8')), record = o.plugins['acme.sample']
  for (let i = 0; i < 1500; i++) o.plugins[`acme.p${i}`] = { ...record }
  const size = () => Buffer.byteLength(JSON.stringify(o)); record.name = 'x'.repeat(1024 * 1024 - size() + record.name.length)
  expect(size()).toBe(1024 * 1024); await fs.writeFile(file, JSON.stringify(o))
  expect(Object.keys((await readIndex(root)).plugins).length).toBe(1501)
  await expect(setEnabled(root, 'acme.sample', false)).rejects.toMatchObject({ detail: { code: 'install.index.limit' } })
  expect((await fs.readFile(file)).length).toBe(1024 * 1024); expect((await readIndex(root)).plugins['acme.sample'].enabled).toBe(true)
  expect((await fs.readdir(root)).filter(n => n.includes('.tmp'))).toEqual([])
})
it('keeps installedAt on update and enabled across rollback in both states', async () => {
  const first = accepted(await install(await pkg(), { now: new Date('2026-01-01T00:00:00.000Z') }))
  const second = accepted(await install(await pkg('1.1.0'), { now: new Date('2026-02-01T00:00:00.000Z') }))
  expect(first.updatedAt).toBeUndefined(); expect(second.installedAt).toBe('2026-01-01T00:00:00.000Z'); expect(second.updatedAt).toBe('2026-02-01T00:00:00.000Z')
  await setEnabled(root, 'acme.sample', false); const back = await rollbackPlugin(root, 'acme.sample')
  expect(back.enabled).toBe(false); expect(back.installedAt).toBe('2026-01-01T00:00:00.000Z')
  await setEnabled(root, 'acme.sample', true); expect((await rollbackPlugin(root, 'acme.sample')).enabled).toBe(true)
})
it('stops reading a stream at the first byte over the declared size', async () => {
  const p = await pkg(); let pulled = 0
  p.openStream = async () => Readable.from((async function* () { for (let i = 0; i < 1000; i++) { pulled++; yield Buffer.alloc(1000, 1) } })())
  expect(code(await install(p))).toBe('install.hash.mismatch'); expect(pulled).toBeLessThan(100); await emptyStaging()
})
it('yields to the event loop after every file', async () => {
  const p = await pkg(); yields.calls = 0; accepted(await install(p)); expect(yields.calls).toBeGreaterThanOrEqual(p.files.length)
})
it('meets installation, event-loop, heap, index and uninstall budgets', async () => {
  await pkg('1.0.0', { files: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`data/${i}.txt`, randomBytes(25000)])) })
  // A fresh Node isolate makes the absolute heap budget independent of Vitest's own heap.
  const metrics = await new Promise<Record<string, number>>((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const fs = (await import('node:fs/promises')).default;
        const { readPackage } = await import(workerData.packageUrl);
        const { installPlugin, readIndex, uninstallPlugin } = await import(workerData.installUrl);
        const result = await readPackage({ kind: 'folder', dir: workerData.source });
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        const pkg = result.package, root = workerData.root;
        let delay = 0, tick = performance.now(), peak = process.memoryUsage().heapUsed;
        const timer = setInterval(() => { const now = performance.now(); delay = Math.max(delay, now-tick); tick = now; peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
        const start = performance.now();
        const installed = await installPlugin(pkg, { root, origin: 'folder', appVersion: '0.1.3' });
        const installation = performance.now()-start;
        await new Promise(r => setTimeout(r, 6)); clearInterval(timer);
        if (!installed.ok) throw new Error(JSON.stringify(installed.error));
        await pkg.close();
        const index = await readIndex(root), record = index.plugins['acme.sample'];
        await fs.writeFile(root+'/installed.json', JSON.stringify({ schema: 1, plugins: Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['acme.plugin-'+i, record])) }));
        const coldStart = performance.now(); await readIndex(root); const cold = performance.now()-coldStart;
        const rounds = []; for (let r=0;r<7;r++) { const cacheStart = performance.now(); for (let i=0;i<100;i++) await readIndex(root); rounds.push((performance.now()-cacheStart)/100) } rounds.sort((a,b)=>a-b); const cached = rounds[3];
        await fs.writeFile(root+'/installed.json', JSON.stringify(index));
        const removalStart = performance.now(); await uninstallPlugin(root, 'acme.sample', { keepSettings: true }); const removal = performance.now()-removalStart;
        parentPort.postMessage({ installation, delay, cold, cached, removal, heapPeakMB: peak/1024**2 });
      })().catch(error => { throw error; });
    `, { eval: true, execArgv: ['--experimental-strip-types'], workerData: { root, source: path.join(dir, 'source-0'), packageUrl: new URL('./package.ts', import.meta.url).href, installUrl: new URL('./install.ts', import.meta.url).href } })
    worker.once('message', resolve); worker.once('error', reject)
    worker.once('exit', status => { if (status !== 0) reject(new Error(`Budget worker exited ${status}`)) })
  })
  console.info('INSTALL_BUDGET', JSON.stringify(metrics))
  expect(metrics.installation).toBeLessThan(800); expect(metrics.delay).toBeLessThan(50)
  expect(metrics.heapPeakMB).toBeLessThan(40); expect(metrics.cold).toBeLessThan(5)
  expect(metrics.cached).toBeLessThan(0.5); expect(metrics.removal).toBeLessThan(300)
})
