import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { setImmediate as yieldLoop } from 'node:timers/promises'
import { compilePlugin, type CompiledPlugin } from './compile.ts'
import { readPackage } from './package.ts'
import { cacheKey, readPayload, writePayload, writeCatalog, toCatalogEntry, createPayloadGeneration } from './compiled-cache.ts'
import { readIndex, setEnabled, type InstalledRecord } from './install.ts'
import { reconcileOnUpdate } from './settings.ts'
import type { PluginManifest } from './manifest.ts'
import type { PluginHostOptions } from './host.ts'

const activationMessage = 'The plugin could not be activated. Reinstall or remove it.'
/** Host-owned state only; the persisted index remains schema 1. */
export class PluginLifecycle {
  readonly owners = new Map<string, boolean>()
  readonly errors = new Map<string, string>()
  readonly cacheRoot: string
  private generation = createPayloadGeneration(0)
  private options: PluginHostOptions
  private folder: (id: string, record: InstalledRecord) => Promise<string>
  constructor(options: PluginHostOptions, folder: (id: string, record: InstalledRecord) => Promise<string>) {
    this.options = options; this.folder = folder
    this.cacheRoot = options.cacheRoot ?? path.join(options.root, '.cache')
  }
  key(id: string, record: InstalledRecord) {
    return cacheKey({ appVersion: this.options.appVersion, pluginId: id, version: record.version, manifestSha256: record.manifestSha256 })
  }
  async package(id: string, record: InstalledRecord) {
    const read = await readPackage({ kind: 'folder', dir: await this.folder(id, record) })
    if (!read.ok) throw new Error(activationMessage)
    const pkg = read.package
    if (pkg.manifest.id !== id || pkg.manifest.version !== record.version
      || `sha256:${createHash('sha256').update(pkg.manifestBytes).digest('hex')}` !== record.manifestSha256) {
      await pkg.close(); throw new Error(activationMessage)
    }
    return pkg
  }
  async manifest(id: string, record: InstalledRecord): Promise<PluginManifest> {
    const pkg = await this.package(id, record)
    try { return pkg.manifest } finally { await pkg.close() }
  }
  async compile(id: string, record: InstalledRecord): Promise<{ compiled: CompiledPlugin; manifest: PluginManifest }> {
    const pkg = await this.package(id, record)
    try {
      const result = await compilePlugin(pkg.manifest, { ...this.options.compileIO, readFile: file => pkg.readFile(file) })
      if (!result.ok) throw new Error(activationMessage)
      return { compiled: result.compiled, manifest: pkg.manifest }
    } finally { await pkg.close() }
  }
  async load(id: string, record: InstalledRecord): Promise<CompiledPlugin> {
    const key = this.key(id, record)
    let read
    try { read = await readPayload(this.cacheRoot, key, this.generation) } catch { /* recover an unreadable cache */ }
    if (read?.hit) return read.compiled
    const { compiled } = await this.compile(id, record)
    await writePayload(this.cacheRoot, key, compiled)
    const checked = await readPayload(this.cacheRoot, key, this.generation)
    if (!checked.hit) throw new Error(activationMessage)
    return checked.compiled
  }
  activate(id: string, compiled: CompiledPlugin, enabled: boolean, update = false): void {
    const activation = this.options.activation
    if (!activation) return
    // The compiler accepts local configuration ids; the settings adapter consumes
    // owner-qualified ids. Keep the cached compiler output intact.
    compiled = Object.freeze({ ...compiled, configuration: Object.freeze(compiled.configuration.map(entry => Object.freeze({
      ...entry, id: entry.id.includes(':') ? entry.id : `${id}:${entry.id}`,
    }))) })
    if (update && this.owners.has(id)) activation.update(id, compiled)
    else activation.activate(id, compiled, { enabled })
    this.owners.set(id, enabled)
    this.errors.delete(id)
  }
  deactivate(id: string): void {
    this.options.activation?.deactivate(id)
    if (this.owners.has(id)) this.owners.set(id, false)
  }
  async failed(id: string): Promise<void> {
    this.errors.set(id, activationMessage)
    // An update transaction restores its old generation on failure. Disable it
    // before marking the newly committed package disabled.
    this.deactivate(id)
    await setEnabled(this.options.root, id, false)
  }
  reconcile(old: PluginManifest | undefined, next: PluginManifest): () => void {
    if (!old) return () => {}
    const { store, registry } = this.options
    store.preparePlugin(next.id)
    const stored = Object.fromEntries([...store.snapshot()].filter(([key]) => key.startsWith(`${next.id}:`)).map(([key, value]) => [key.slice(next.id.length + 1), value]))
    const reconciled = reconcileOnUpdate(old, next, stored)
    return () => {
      store.preparePlugin(next.id)
      for (const [key, value] of Object.entries(reconciled.values)) if (registry.get(`${next.id}:${key}`)) store.set(`${next.id}:${key}`, value)
    }
  }
  /** Derived data only: failures produce a notice, never undo an index commit. */
  async catalog(clean = false, signal?: AbortSignal): Promise<boolean> {
    try {
      const index = await readIndex(this.options.root), entries = [], live = new Set<string>()
      let count = 0
      for (const [id, record] of Object.entries(index.plugins)) {
        if (signal?.aborted) return false
        const key = this.key(id, record)
        live.add(`${createHash('sha256').update(JSON.stringify(key)).digest('hex')}.json`)
        const read = await readPayload(this.cacheRoot, key)
        if (read.hit) entries.push(toCatalogEntry(read.compiled, key, record.name))
        if (++count % 8 === 0) await yieldLoop()
      }
      await writeCatalog(this.cacheRoot, entries)
      if (clean) {
        // Validate ancestors before enumerating the cache, even if it was replaced
        // between catalog publication and cleanup. Remove only hashed leaf files.
        let current = path.parse(path.resolve(this.cacheRoot)).root
        for (const part of path.resolve(this.cacheRoot).slice(current.length).split(path.sep)) {
          current = path.join(current, part)
          const st = await fs.lstat(current)
          if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('unsafe cache')
        }
        const directory = await fs.opendir(this.cacheRoot)
        count = 0
        for await (const entry of directory) {
          if (signal?.aborted || ++count > 4096) break
          if (/^[a-f0-9]{64}\.json$/.test(entry.name) && !live.has(entry.name) && !entry.isDirectory()) await fs.rm(path.join(this.cacheRoot, entry.name), { force: true })
          if (count % 8 === 0) await yieldLoop()
        }
      }
      return true
    } catch { return false }
  }
  async start(signal?: AbortSignal): Promise<void> {
    if (!this.options.activation || signal?.aborted) return
    const entries = Object.entries((await readIndex(this.options.root)).plugins)
    for (let offset = 0; offset < entries.length; offset += 8) {
      for (const [id, record] of entries.slice(offset, offset + 8)) {
        if (signal?.aborted) return
        if (!record.enabled || this.owners.get(id)) continue
        try {
          const compiled = await this.load(id, record)
          if (signal?.aborted) return
          this.activate(id, compiled, true)
        } catch { this.errors.set(id, activationMessage) }
      }
      await yieldLoop()
    }
    await this.catalog(true, signal)
  }
}
