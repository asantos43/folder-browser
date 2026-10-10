import fs from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { setImmediate as yieldLoop } from 'node:timers/promises'
import { safeRelative } from '../zip.ts'
import { parseManifest, type PluginManifest } from './manifest.ts'
import { parseSemver, satisfies } from './semver.ts'
import type { PluginPackage, TrustLabel } from './package.ts'
import { readPackage } from './package.ts'

export type InstallOrigin = 'file' | 'folder' | 'repository' | 'catalog'
const countKeys = ['themes', 'keymaps', 'languages', 'locales', 'openWith', 'commands', 'settings'] as const
export interface InstalledRecord {
  version: string; previous?: string; enabled: boolean; installedAt: string; updatedAt?: string
  origin: InstallOrigin; trust: TrustLabel; signerFingerprint?: string; publisher: { id: string; name: string }
  name: string; description?: string; sizeBytes: number; hasCode: boolean
  contributes: Record<typeof countKeys[number], number>; manifestSha256: string
}
export interface InstallNotice { code: string; message: string; detail?: unknown }
export interface InstalledIndex { schema: 1; plugins: Record<string, InstalledRecord>; warnings?: InstallNotice[] }
export type InstallResult = { ok: true; record: InstalledRecord; warnings: InstallNotice[] } | { ok: false; error: InstallNotice }
export interface InstallOptions {
  root: string; origin: InstallOrigin; appVersion: string; now?: Date; allowDowngrade?: boolean; developerMode?: boolean
}
const indexLimit = 1024 * 1024
const queues = new Map<string, Promise<unknown>>()
const cache = new Map<string, { mtime: number; size: number; index: InstalledIndex }>()
const roots = new Map<string, { ino: number; dev: number; canonical: string }>()
class InstallError extends Error {
  readonly detail: InstallNotice
  constructor(code: string, message: string, detail?: unknown) { super(message); this.detail = { code: `install.${code}`, message, detail } }
}
function refuse(code: string, message: string, detail?: unknown): never { throw new InstallError(code, message, detail) }
function notice(error: unknown): InstallNotice {
  if (error instanceof InstallError) return error.detail
  return { code: 'install.disk.failed', message: 'The plugin could not be saved.', detail: error }
}
function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT' }
function enqueue<T>(key: string, action: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve(), next = before.catch(() => {}).then(action); queues.set(key, next)
  const done = () => { if (queues.get(key) === next) queues.delete(key) }
  next.then(done, done); return next
}
/** The canonical root (creating it when missing), so two spellings of one folder share a queue; any failure falls back to the resolved spelling. */
async function lockKey(root: string): Promise<string> {
  const base = path.resolve(root)
  try { return await fs.realpath(base) } catch { /* missing: create below */ }
  try { await fs.mkdir(base, { recursive: true }); return await fs.realpath(base) } catch { return base }
}
// The outer queue keeps callers of one spelling in call order; the inner one serializes every spelling of one canonical root.
async function locked<T>(root: string, action: () => Promise<T>): Promise<T> {
  return enqueue(`spelling:${path.resolve(root)}`, async () => enqueue(`root:${await lockKey(root)}`, action))
}
async function rootAt(root: string): Promise<string> {
  const base = path.resolve(root)
  let st
  try { st = await fs.lstat(base) }
  catch (error) { if (!missing(error)) throw error; await fs.mkdir(base, { recursive: true }); st = await fs.lstat(base) }
  if (st.isSymbolicLink() || !st.isDirectory()) refuse('root.symlink', 'Choose a regular plugin folder.', base)
  const cached = roots.get(base)
  if (cached?.ino === st.ino && cached.dev === st.dev) return cached.canonical
  const canonical = await fs.realpath(base); roots.set(base, { ino: st.ino, dev: st.dev, canonical }); return canonical
}
function safePath(root: string, relative: string): string {
  if (safeRelative(relative) !== relative || !relative) refuse('path.unsafe', 'The plugin path is unsafe.', relative)
  const target = path.resolve(root, relative)
  if (!target.startsWith(root + path.sep)) refuse('path.unsafe', 'The plugin path is unsafe.', target)
  return target
}
/** Unlike resolveInside, accepts not-yet-created targets; refuses all link components. */
async function inside(root: string, relative: string): Promise<string> {
  const target = safePath(root, relative)
  let current = root
  for (const part of relative.split('/')) {
    current = path.join(current, part)
    try { if ((await fs.lstat(current)).isSymbolicLink()) refuse('path.symlink', 'Plugin folders cannot contain links.', current) }
    catch (error) { if (missing(error)) break; throw error }
  }
  return target
}
function validId(id: string): boolean { return id.length <= 64 && /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(id) && !id.split('.').some(p => ['__proto__', 'constructor', 'prototype'].includes(p)) }
function checkId(id: string) { if (!validId(id)) refuse('id.invalid', 'The plugin identifier is invalid.') }
const hashOf = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
function recordOf(manifest: PluginManifest, bytes: Buffer, meta: Pick<InstalledRecord, 'origin' | 'trust' | 'sizeBytes' | 'installedAt' | 'enabled'>): InstalledRecord {
  const contributes = Object.fromEntries(countKeys.map(key => [key, key === 'settings' ? Object.keys(manifest.contributes.configuration?.properties ?? {}).length : manifest.contributes[key]?.length ?? 0])) as InstalledRecord['contributes']
  return { ...meta, version: manifest.version, publisher: { id: manifest.publisher.id, name: manifest.publisher.name }, name: manifest.name,
    ...(manifest.description === undefined ? {} : { description: manifest.description }), hasCode: manifest.hasCode, contributes, manifestSha256: hashOf(bytes) }
}
function strictObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw new Error('Invalid index object')
  return value as Record<string, unknown>
}
function parseIndex(text: string): InstalledIndex {
  const raw = JSON.parse(text, (key, value) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Forbidden key'); return value })
  const top = strictObject(raw, ['schema', 'plugins'])
  if (top.schema !== 1 || !top.plugins || typeof top.plugins !== 'object' || Array.isArray(top.plugins)) throw new Error('Invalid index')
  const plugins: Record<string, InstalledRecord> = Object.create(null)
  for (const [id, value] of Object.entries(top.plugins)) {
    if (!validId(id)) throw new Error('Invalid id')
    const r = strictObject(value, ['version', 'previous', 'enabled', 'installedAt', 'updatedAt', 'origin', 'trust', 'signerFingerprint', 'publisher', 'name', 'description', 'sizeBytes', 'hasCode', 'contributes', 'manifestSha256'])
    if (typeof r.version !== 'string' || !parseSemver(r.version) || (r.previous !== undefined && (typeof r.previous !== 'string' || !parseSemver(r.previous))) || typeof r.enabled !== 'boolean' || typeof r.hasCode !== 'boolean') throw new Error('Invalid version or flags')
    for (const key of ['installedAt', 'updatedAt']) if ((key === 'installedAt' || r[key] !== undefined) && (typeof r[key] !== 'string' || new Date(r[key] as string).toISOString() !== r[key])) throw new Error('Invalid time')
    if (!['file', 'folder', 'repository', 'catalog'].includes(r.origin as string) || !['catalog', 'signed-trusted', 'signed-unknown', 'repository', 'unsigned'].includes(r.trust as string)) throw new Error('Invalid origin')
    if (typeof r.sizeBytes !== 'number' || !Number.isSafeInteger(r.sizeBytes) || r.sizeBytes < 0 || typeof r.name !== 'string' || !r.name || (r.description !== undefined && typeof r.description !== 'string')) throw new Error('Invalid metadata')
    if (typeof r.manifestSha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(r.manifestSha256) || (r.signerFingerprint !== undefined && (typeof r.signerFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(r.signerFingerprint)))) throw new Error('Invalid digest')
    const publisher = strictObject(r.publisher, ['id', 'name']), counts = strictObject(r.contributes, countKeys)
    if (typeof publisher.id !== 'string' || !publisher.id || typeof publisher.name !== 'string' || !publisher.name) throw new Error('Invalid publisher')
    if (countKeys.some(k => !Number.isSafeInteger(counts[k]) || (counts[k] as number) < 0)) throw new Error('Invalid counts')
    plugins[id] = { ...r, publisher: { ...publisher }, contributes: { ...counts } } as InstalledRecord
  }
  return { schema: 1, plugins }
}
function freezeIndex(index: InstalledIndex): InstalledIndex {
  for (const r of Object.values(index.plugins)) { Object.freeze(r.publisher); Object.freeze(r.contributes); Object.freeze(r) }
  Object.freeze(index.plugins); if (index.warnings) { index.warnings.forEach(Object.freeze); Object.freeze(index.warnings) }; return Object.freeze(index)
}
async function boundedRead(file: string, limit: number): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Not a file')
    const bytes = Buffer.alloc(limit + 1); let offset = 0
    while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) break; offset += bytesRead }
    if (offset > limit) throw new Error('File too large')
    return bytes.subarray(0, offset)
  } finally { await handle.close() }
}
// saveEditedBytes is tied to existing editor files/conflict versions; reuse its temp/sync/rename protocol here.
async function writeIndex(root: string, index: InstalledIndex): Promise<void> {
  const bytes = Buffer.from(JSON.stringify({ schema: 1, plugins: index.plugins }))
  if (bytes.length > indexLimit) refuse('index.limit', 'Too many installed plugins.')
  const dest = await inside(root, 'installed.json'), temp = await inside(root, `.installed-${randomUUID()}.tmp`)
  try {
    const handle = await fs.open(temp, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    await fs.rename(temp, dest); cache.delete(root)
  } finally { await fs.rm(temp, { force: true }) }
}
async function readUnlocked(root: string): Promise<InstalledIndex> {
  const file = safePath(root, 'installed.json')
  let stat
  try { stat = await fs.lstat(file) } catch (error) { if (!missing(error)) throw error; return freezeIndex({ schema: 1, plugins: Object.create(null) }) }
  if (stat.isSymbolicLink()) refuse('path.symlink', 'Plugin folders cannot contain links.', file)
  const cached = cache.get(root)
  if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) return cached.index
  let index: InstalledIndex
  try { if (stat.size > indexLimit) throw new Error('Index too large'); index = parseIndex((await boundedRead(file, indexLimit)).toString('utf8')) }
  catch {
    const backup = await inside(root, `installed.json.bad-${Date.now()}-${randomUUID()}`)
    await fs.rename(file, backup)
    index = { schema: 1, plugins: Object.create(null), warnings: [{ code: 'install.index.rebuilt', message: 'The plugin index was rebuilt. Plugins are disabled.' }] }
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validId(entry.name)) continue
      const idDir = await inside(root, entry.name)
      const versions = (await fs.readdir(idDir, { withFileTypes: true })).filter(e => e.isDirectory() && parseSemver(e.name)).sort((a, b) => satisfies(a.name, `>${b.name}`) ? -1 : 1)
      for (const version of versions) {
        try {
          const bytes = await boundedRead(await inside(root, `${entry.name}/${version.name}/plugin.json`), 256 * 1024), parsed = parseManifest(bytes.toString('utf8'))
          if (!parsed.ok || parsed.manifest.id !== entry.name || parsed.manifest.version !== version.name) continue
          const sizeBytes = await treeSize(root, `${entry.name}/${version.name}`)
          const r = recordOf(parsed.manifest, bytes, { origin: 'folder', trust: 'unsigned', enabled: false, installedAt: new Date().toISOString(), sizeBytes })
          if (!index.plugins[entry.name]) index.plugins[entry.name] = r
          else { index.plugins[entry.name].previous = version.name; break }
        } catch { /* Ignore invalid/unreadable installations; do not trust them. */ }
      }
    }
    await writeIndex(root, index)
    stat = await fs.stat(file)
  }
  freezeIndex(index); cache.set(root, { mtime: stat.mtimeMs, size: stat.size, index }); return index
}
async function treeSize(root: string, relative: string): Promise<number> {
  const target = await inside(root, relative), st = await fs.lstat(target)
  if (!st.isDirectory()) return st.size
  let total = 0
  for (const e of await fs.readdir(target)) total += await treeSize(root, `${relative}/${e}`)
  return total
}
export async function readIndex(root: string): Promise<InstalledIndex> { return locked(root, async () => readUnlocked(await rootAt(root))) }
export async function listInstalled(root: string): Promise<InstalledRecord[]> { return Object.values((await readIndex(root)).plugins) }
/** Never follows a link: a link is neither chmod-ed nor entered. */
async function setMode(target: string, writable: boolean): Promise<void> {
  const st = await fs.lstat(target); if (st.isSymbolicLink()) return
  if (writable) await fs.chmod(target, st.isDirectory() ? 0o755 : 0o644)
  if (st.isDirectory()) await Promise.all((await fs.readdir(target)).map(name => setMode(path.join(target, name), writable)))
  if (!writable) await fs.chmod(target, st.isDirectory() ? 0o555 : 0o444)
}
async function permissions(root: string, relative: string, writable: boolean): Promise<void> { await setMode(await inside(root, relative), writable) }
/** Removes a tree, a file or a link (the link only, never what it points to); the parents must not be links. */
async function remove(root: string, relative: string): Promise<void> {
  const target = safePath(root, relative), parent = path.posix.dirname(relative)
  if (parent !== '.') await inside(root, parent)
  try {
    if ((await fs.lstat(target)).isDirectory()) await setMode(target, true)
    await fs.rm(target, { recursive: true, force: true })
  } catch (error) { if (!missing(error)) throw error }
}
async function cleanUnlocked(root: string): Promise<void> {
  const staging = await inside(root, '.staging')
  try {
    for (const e of await fs.readdir(staging)) {
      const target = path.join(staging, e), st = await fs.lstat(target)
      if (st.isSymbolicLink()) await fs.rm(target, { force: true })
      else if (Date.now() - st.mtimeMs > 3600000) await remove(root, `.staging/${e}`)
    }
  } catch (error) { if (!missing(error)) throw error }
}
export async function cleanStaging(root: string): Promise<void> { return locked(root, async () => cleanUnlocked(await rootAt(root))) }
async function writeBytes(root: string, relative: string, bytes: Buffer): Promise<void> {
  const target = await inside(root, relative); await fs.mkdir(path.dirname(target), { recursive: true })
  const h = await fs.open(target, 'wx', 0o600)
  try { await h.writeFile(bytes); await h.sync() } finally { await h.close() }
}
export async function installPlugin(pkg: PluginPackage, opts: InstallOptions): Promise<InstallResult> {
  return locked(opts.root, async () => {
    let root: string | undefined, staging: string | undefined, published: string | undefined
    let obsolete: { from: string; tomb: string } | undefined
    try {
      root = await rootAt(opts.root); await cleanUnlocked(root)
      const m = pkg.manifest; checkId(m.id)
      if (!satisfies(opts.appVersion, m.engines.folderBrowser)) refuse('engine.unsupported', 'This plugin needs another version of Folder Browser.')
      if (pkg.hasCode && !opts.developerMode) refuse('code.needs-developer-mode', 'Enable developer mode to install a plugin with code.')
      const index = await readUnlocked(root), old = index.plugins[m.id]
      if (old?.version === m.version) refuse('same-version', 'This plugin version is already installed.')
      if (old && satisfies(m.version, `<${old.version}`) && !opts.allowDowngrade) refuse('downgrade', 'Choose explicitly to install an older plugin version.')
      if (typeof fs.statfs === 'function') { const st = await fs.statfs(root); if (st.bavail * st.bsize < pkg.totalBytes * 2) refuse('disk.space', 'There is not enough free space to install this plugin.') }
      const parsed = parseManifest(pkg.manifestBytes.toString('utf8'))
      if (!parsed.ok || JSON.stringify(parsed.manifest) !== JSON.stringify(m)) refuse('hash.mismatch', 'The plugin metadata changed.')
      staging = `.staging/${randomUUID()}`
      await fs.mkdir(await inside(root, staging), { recursive: true })
      for (const file of pkg.files) {
        const target = await inside(root, `${staging}/${file.path}`); await fs.mkdir(path.dirname(target), { recursive: true })
        const handle = await fs.open(target, 'wx', 0o600), hash = createHash('sha256'); let size = 0
        try {
          const stream = await pkg.openStream(file.path)
          try {
            for await (const chunk of stream) {
              const bytes = chunk as Buffer; size += bytes.length
              if (size > file.size) refuse('hash.mismatch', 'A plugin file changed.', file.path)
              hash.update(bytes); await handle.writeFile(bytes)
            }
          } finally { stream.destroy() }
          if (size !== file.size || `sha256:${hash.digest('hex')}` !== file.sha256 || file.sha256 !== m.files[file.path]?.toLowerCase()) refuse('hash.mismatch', 'A plugin file changed.', file.path)
          await handle.sync()
        } catch (error) {
          if ((error as { detail?: { code?: string } }).detail?.code === 'package.hash.mismatch') refuse('hash.mismatch', 'A plugin file changed.', file.path)
          throw error
        } finally { await handle.close() }
        await yieldLoop()
      }
      await writeBytes(root, `${staging}/plugin.json`, pkg.manifestBytes)
      if (pkg.signatureBytes) await writeBytes(root, `${staging}/SIGNATURE`, pkg.signatureBytes)
      await permissions(root, staging, false)
      const destRel = `${m.id}/${m.version}`, dest = safePath(root, destRel)
      await fs.mkdir(await inside(root, m.id), { recursive: true })
      let exists = false
      try { await fs.lstat(dest); exists = true } catch (error) { if (!missing(error)) throw error }
      // A directory the index does not record (a crash between the rename and the index, or a lost index) is an orphan: replace it.
      if (exists && old?.previous !== m.version) { await remove(root, destRel); exists = false }
      if (exists) {
        // A retained rollback version can be selected by an explicit downgrade; reuse only identical metadata.
        if (!(await boundedRead(await inside(root, `${destRel}/plugin.json`), 256 * 1024)).equals(pkg.manifestBytes)) refuse('version.exists', 'This plugin version already exists on disk.')
        const retained = await readPackage({ kind: 'folder', dir: dest })
        if (!retained.ok) refuse('version.invalid', 'The retained plugin version is invalid.', retained.errors)
        await retained.package.close()
        await remove(root, staging); staging = undefined
      } else {
        // Moving a directory between parents needs write access to its '..' entry on POSIX.
        await fs.chmod(await inside(root, staging), 0o755)
        await fs.rename(await inside(root, staging), dest); published = destRel; staging = undefined
        await fs.chmod(dest, 0o555)
      }
      const now = (opts.now ?? new Date()).toISOString()
      const record = recordOf(m, pkg.manifestBytes, { origin: opts.origin, trust: pkg.trust, sizeBytes: pkg.totalBytes, installedAt: old?.installedAt ?? now, enabled: old?.enabled ?? !pkg.hasCode })
      if (old) { record.previous = old.version; record.updatedAt = now }
      if (pkg.signature.signed) record.signerFingerprint = pkg.signature.fingerprint
      if (old?.previous && old.previous !== m.version) {
        const from = `${m.id}/${old.previous}`, tomb = `.staging/${randomUUID()}`
        const oldPath = await inside(root, from)
        await fs.chmod(oldPath, 0o755)
        try { await fs.rename(oldPath, await inside(root, tomb)); obsolete = { from, tomb }; await fs.chmod(await inside(root, tomb), 0o555) }
        catch (error) { if (!obsolete) await fs.chmod(oldPath, 0o555); throw error }
      }
      await writeIndex(root, { schema: 1, plugins: { ...index.plugins, [m.id]: record } }); published = undefined
      const warnings = [...index.warnings ?? []]
      if (obsolete) {
        try { await remove(root, obsolete.tomb) } catch (error) { warnings.push({ code: 'install.cleanup.failed', message: 'An unused plugin version could not be removed.', detail: error }) }
        obsolete = undefined
      }
      return { ok: true, record, warnings }
    } catch (error) {
      if (root) {
        if (obsolete) {
          await fs.chmod(await inside(root, obsolete.tomb), 0o755)
          await fs.rename(await inside(root, obsolete.tomb), await inside(root, obsolete.from))
          await fs.chmod(await inside(root, obsolete.from), 0o555)
        }
        if (staging) await remove(root, staging); if (published) await remove(root, published)
      }
      return { ok: false, error: notice(error) }
    }
  })
}
export async function rollbackPlugin(root: string, id: string): Promise<InstalledRecord> {
  return locked(root, async () => {
    root = await rootAt(root); checkId(id); const index = await readUnlocked(root), old = index.plugins[id]
    if (!old?.previous) refuse('rollback.none', 'There is no previous plugin version.')
    const previous = await readPackage({ kind: 'folder', dir: await inside(root, `${id}/${old.previous}`) })
    if (!previous.ok) refuse('rollback.invalid', 'The previous plugin version is invalid.', previous.errors)
    let record: InstalledRecord
    try {
      const pkg = previous.package
      if (pkg.manifest.id !== id || pkg.manifest.version !== old.previous) refuse('rollback.invalid', 'The previous plugin version is invalid.')
      record = recordOf(pkg.manifest, pkg.manifestBytes, { origin: old.origin, trust: pkg.trust, enabled: old.enabled, installedAt: old.installedAt, sizeBytes: pkg.totalBytes })
      if (pkg.signature.signed) record.signerFingerprint = pkg.signature.fingerprint
      record.previous = old.version; record.updatedAt = new Date().toISOString()
    } finally { await previous.package.close() }
    await writeIndex(root, { schema: 1, plugins: { ...index.plugins, [id]: record } }); return record
  })
}
export async function uninstallPlugin(root: string, id: string, opts: { keepSettings: boolean }): Promise<{ keepSettings: boolean }> {
  return locked(root, async () => {
    root = await rootAt(root); checkId(id); const index = await readUnlocked(root)
    if (!index.plugins[id]) refuse('plugin.missing', 'This plugin is not installed.')
    const from = await inside(root, id), tomb = `.staging/${randomUUID()}`
    await fs.mkdir(await inside(root, '.staging'), { recursive: true })
    await fs.rename(from, await inside(root, tomb))
    const plugins = { ...index.plugins }; delete plugins[id]
    try { await writeIndex(root, { schema: 1, plugins }) } catch (error) { await fs.rename(await inside(root, tomb), from); throw error }
    await remove(root, tomb); return { keepSettings: opts.keepSettings }
  })
}
export async function setEnabled(root: string, id: string, enabled: boolean): Promise<void> {
  return locked(root, async () => {
    root = await rootAt(root); checkId(id); const index = await readUnlocked(root)
    if (!index.plugins[id]) refuse('plugin.missing', 'This plugin is not installed.')
    await writeIndex(root, { schema: 1, plugins: { ...index.plugins, [id]: { ...index.plugins[id], enabled } } })
  })
}
export async function disableAll(root: string): Promise<void> {
  return locked(root, async () => {
    root = await rootAt(root); const index = await readUnlocked(root)
    await writeIndex(root, { schema: 1, plugins: Object.fromEntries(Object.entries(index.plugins).map(([id, r]) => [id, { ...r, enabled: false }])) })
  })
}
