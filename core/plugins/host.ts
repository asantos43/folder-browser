import fs from 'node:fs/promises'
import path from 'node:path'
import type { createActivation } from './activation.ts'
import { PluginLifecycle } from './lifecycle.ts'
import { writePayload, removePayload } from './compiled-cache.ts'
import { compilePlugin, declaredTokensFromCss, type CompileIO } from './compile.ts'
import { readPackage, type PluginPackage } from './package.ts'
import { parseManifest, MANIFEST_TEXT_LIMIT } from './manifest.ts'
import { readIndex, installPlugin, rollbackPlugin, setEnabled, disableAll, uninstallPlugin, type InstalledRecord, type InstalledIndex } from './install.ts'
import { purgePluginSettings, removePluginSettings } from './settings.ts'
import type { SettingsStore } from '../settings/store.ts'
import type { SettingsRegistry } from '../settings/registry.ts'
import type { InstallOutcome, PluginSummary, RemoveOptions } from './summary.ts'
import type { SignerStore } from '../signers.ts'

export { declaredTokensFromCss }

// Budgets: no startup consumer; warm list of 100 records <10 ms CPU, with bounded
// manifest checks only on a new index. Package verification/installation stream bytes.
// installed.json is the commit point: payload precedes it; catalog is derived.
// A crash between writes restores the index's keyed generation, never a catalog guess.
export const validPluginId = (id: unknown): id is string => typeof id === 'string' && id.length <= 64
  && /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(id) && !id.split('.').some(part => ['__proto__', 'constructor', 'prototype'].includes(part))

export class PluginHostError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
function refuse(code: string, message: string): never { throw new PluginHostError(code, message) }
const short = (text: string): string => text.replace(/[\r\n\u2028\u2029]/g, ' ').slice(0, 300)

/** Detached renderer data; an unreadable installed package remains visible/removable. */
export function toSummary(record: InstalledRecord, id: string, error?: string): PluginSummary {
  return { id, name: record.name, version: record.version, ...(record.description ? { description: record.description } : {}),
    publisher: { ...record.publisher }, trust: record.trust, enabled: record.enabled, sizeBytes: record.sizeBytes,
    contributes: { ...record.contributes }, hasCode: record.hasCode, developer: false, ...(error ? { error } : {}) }
}

function packageSummary(pkg: PluginPackage): PluginSummary {
  const m = pkg.manifest, c = m.contributes
  return { id: m.id, name: m.name, version: m.version, description: m.description, publisher: { id: m.publisher.id, name: m.publisher.name },
    trust: pkg.trust, sizeBytes: pkg.totalBytes, enabled: false, hasCode: pkg.hasCode, developer: false,
    contributes: { themes: c.themes?.length ?? 0, keymaps: c.keymaps?.length ?? 0, languages: c.languages?.length ?? 0,
      locales: c.locales?.length ?? 0, openWith: c.openWith?.length ?? 0, commands: c.commands?.length ?? 0,
      settings: Object.keys(c.configuration?.properties ?? {}).length } }
}

export interface PluginHostOptions {
  root: string
  cacheRoot?: string
  activation?: Pick<ReturnType<typeof createActivation>, 'activate' | 'update' | 'deactivate' | 'remove'>
  /** Main adapters need the installed version synchronously during publication. */
  installedVersion?(id: string, version: string): void
  appVersion: string
  compileIO: Omit<CompileIO, 'readFile'>
  store: SettingsStore
  registry: SettingsRegistry
  signerStore?: Pick<SignerStore, 'isTrusted'>
  confirm(summary: PluginSummary): Promise<boolean>
  openPath(file: string): Promise<string>
  changed(): void
}

export class PluginHost {
  private options: PluginHostOptions
  private cached?: { index: InstalledIndex; items: PluginSummary[] }
  private lifecycle: PluginLifecycle
  private pending: Promise<unknown> = Promise.resolve()
  constructor(options: PluginHostOptions) {
    this.options = options
    this.lifecycle = new PluginLifecycle(options, (id, record) => this.installedPath(id, record))
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => {}).then(action)
    this.pending = next
    return next
  }

  async list(): Promise<PluginSummary[]> {
    const index = await readIndex(this.options.root)
    if (this.cached?.index === index) return this.cached.items.map(item => ({ ...item, publisher: { ...item.publisher }, contributes: { ...item.contributes } }))
    const entries = Object.entries(index.plugins), items: PluginSummary[] = []
    // At most eight bounded manifest reads live at a time (2 MiB), never read payloads.
    for (let start = 0; start < entries.length; start += 8) {
      items.push(...await Promise.all(entries.slice(start, start + 8).map(async ([id, record]) => {
        try {
          const folder = await this.installedPath(id, record)
          const file = path.join(folder, 'plugin.json'), st = await fs.lstat(file)
          if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw new Error('manifest')
          const reader = await fs.open(file, 'r')
          try {
            const bytes = Buffer.alloc(MANIFEST_TEXT_LIMIT + 1)
            let size = 0
            while (size < bytes.length) { const read = await reader.read(bytes, size, bytes.length - size, null); if (!read.bytesRead) break; size += read.bytesRead }
            if (size > MANIFEST_TEXT_LIMIT) throw new Error('manifest')
            const result = parseManifest(bytes.toString('utf8', 0, size))
            if (!result.ok || result.manifest.id !== id || result.manifest.version !== record.version) throw new Error('manifest')
          } finally { await reader.close() }
          return toSummary(record, id, this.lifecycle.errors.get(id))
        } catch { return toSummary(record, id, 'The installed plugin cannot be read. Reinstall or remove it.') }
      })))
    }
    this.cached = { index, items }
    return items.map(item => ({ ...item, publisher: { ...item.publisher }, contributes: { ...item.contributes } }))
  }

  private checkId(id: unknown): asserts id is string { if (!validPluginId(id)) refuse('plugins.id.invalid', 'Choose an installed plugin.') }
  private publish(): void { this.cached = undefined; this.options.changed() }

  async setEnabled(id: unknown, enabled: unknown): Promise<void> {
    this.checkId(id)
    if (typeof enabled !== 'boolean') refuse('plugins.arguments.invalid', 'Choose whether to enable the plugin.')
    return this.serial(async () => {
      if (!this.options.activation) { await setEnabled(this.options.root, id, enabled); this.publish(); return }
      const record = await this.record(id), wasEnabled = this.lifecycle.owners.get(id) ?? false
      let compiled
      try {
        if (enabled) {
          compiled = await this.lifecycle.load(id, record)
          this.lifecycle.activate(id, compiled, true)
        } else this.lifecycle.deactivate(id)
      } catch {
        this.lifecycle.errors.set(id, 'The plugin state could not be changed. Reinstall or remove it.')
        if (enabled) await this.lifecycle.failed(id)
        this.publish(); refuse('plugins.activation.failed', 'The plugin state could not be changed.')
      }
      try { await setEnabled(this.options.root, id, enabled) }
      catch (error) {
        this.lifecycle.errors.set(id, 'The plugin state could not be saved.')
        try {
          if (wasEnabled) this.lifecycle.activate(id, compiled ?? await this.lifecycle.load(id, record), true)
          else this.lifecycle.deactivate(id)
        } finally { this.lifecycle.errors.set(id, 'The plugin state could not be saved.'); this.publish() }
        throw error
      }
      this.lifecycle.errors.delete(id); this.publish()
    })
  }
  async disableAll(): Promise<void> {
    return this.serial(async () => {
      const disabled: string[] = [], failed = new Set<string>()
      for (const [id, enabled] of this.lifecycle.owners) if (enabled) {
        try { this.lifecycle.deactivate(id); disabled.push(id); this.lifecycle.errors.delete(id) }
        catch { failed.add(id); this.lifecycle.errors.set(id, 'The plugin could not be disabled.') }
      }
      try { await disableAll(this.options.root, failed) }
      catch (error) {
        try { for (const id of disabled) this.lifecycle.activate(id, await this.lifecycle.load(id, await this.record(id)), true) }
        finally { this.publish() }
        throw error
      }
      this.publish()
      if (failed.size) refuse('plugins.disable.failed', 'Some plugins could not be disabled.')
    })
  }
  async remove(id: unknown, options: unknown): Promise<void> {
    this.checkId(id)
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length !== 1
      || typeof (options as RemoveOptions).keepSettings !== 'boolean') refuse('plugins.arguments.invalid', 'Choose whether to keep the plugin settings.')
    const { keepSettings } = options as RemoveOptions
    return this.serial(async () => {
      const record = await this.record(id), owned = this.lifecycle.owners.has(id), enabled = this.lifecycle.owners.get(id) ?? false
      try { this.options.activation?.remove(id) }
      catch { this.lifecycle.errors.set(id, 'The plugin could not be removed. Try again.'); this.publish(); refuse('plugins.remove.failed', 'The plugin could not be removed.') }
      this.lifecycle.owners.delete(id)
      try { await uninstallPlugin(this.options.root, id, { keepSettings }) }
      catch (error) {
        try { if (owned) this.lifecycle.activate(id, await this.lifecycle.load(id, record), enabled) }
        finally { this.lifecycle.errors.set(id, 'The plugin could not be removed. Try again.'); this.publish() }
        throw error
      }
      try {
        await removePayload(this.lifecycle.cacheRoot, this.lifecycle.key(id, record)).catch(() => {})
        await this.lifecycle.catalog()
        this.lifecycle.errors.delete(id)
        removePluginSettings(this.options.registry, id)
        if (!keepSettings) { purgePluginSettings(this.options.store, id); await this.options.store.flush() }
      } finally { this.publish() }
    })
  }

  private async record(id: string): Promise<InstalledRecord> {
    const record = (await readIndex(this.options.root)).plugins[id]
    if (!record) refuse('plugins.missing', 'This plugin is not installed.')
    this.options.installedVersion?.(id, record.version)
    return record
  }
  async start(options: { signal?: AbortSignal } = {}): Promise<void> {
    return this.serial(async () => {
      if (this.options.installedVersion && !options.signal?.aborted) {
        for (const [id, record] of Object.entries((await readIndex(this.options.root)).plugins)) this.options.installedVersion(id, record.version)
      }
      await this.lifecycle.start(options.signal); this.publish()
    })
  }
  async rollback(id: unknown): Promise<void> {
    this.checkId(id)
    return this.serial(async () => {
      const old = await this.record(id)
      const oldManifest = await this.lifecycle.manifest(id, old)
      let prepared: Awaited<ReturnType<PluginLifecycle['compile']>> | undefined
      const record = await rollbackPlugin(this.options.root, id, async next => {
        prepared = await this.lifecycle.compile(id, next)
        await writePayload(this.lifecycle.cacheRoot, this.lifecycle.key(id, next), prepared.compiled)
      })
      try {
        const applySettings = this.lifecycle.reconcile(oldManifest, prepared!.manifest)
        this.options.installedVersion?.(id, record.version)
        this.lifecycle.activate(id, prepared!.compiled, record.enabled, true)
        applySettings()
      } catch {
        await this.lifecycle.failed(id)
        refuse('plugins.activation.failed', 'The plugin could not be activated.')
      } finally { await this.lifecycle.catalog(); this.publish() }
    })
  }

  private async installedPath(id: string, record: InstalledRecord): Promise<string> {
    this.checkId(id)
    const root = path.resolve(this.options.root)
    // No index/renderer string may smuggle a path or a link into shell.openPath.
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(record.version)) refuse('plugins.path.invalid', 'The plugin folder is unsafe.')
    for (const folder of [root, path.join(root, id), path.join(root, id, record.version)]) {
      const st = await fs.lstat(folder)
      if (!st.isDirectory() || st.isSymbolicLink()) refuse('plugins.path.invalid', 'The plugin folder is unsafe.')
    }
    const canonical = await fs.realpath(root), target = await fs.realpath(path.join(root, id, record.version))
    if (!target.startsWith(canonical + path.sep)) refuse('plugins.path.invalid', 'The plugin folder is unsafe.')
    return target
  }
  async openFolder(id: unknown): Promise<void> {
    this.checkId(id)
    const record = (await readIndex(this.options.root)).plugins[id]
    if (!record) refuse('plugins.missing', 'This plugin is not installed.')
    const error = await this.options.openPath(await this.installedPath(id, record))
    if (error) refuse('plugins.open.failed', 'The plugin folder could not be opened.')
  }

  private async source(input: unknown): Promise<{ origin: 'folder'; source: { kind: 'folder'; dir: string } } | { origin: 'file'; source: { kind: 'zip'; file: string } }> {
    if (typeof input !== 'string' || input.length > 4096 || !path.isAbsolute(input) || Array.from(input).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || input.split(/[\\/]/).includes('..')) refuse('plugins.path.invalid', 'Choose a .fbplugin file or a folder containing plugin.json.')
    const st = await fs.lstat(input)
    if (st.isSymbolicLink()) refuse('plugins.path.invalid', 'Choose a regular plugin file or folder, without links.')
    const canonical = await fs.realpath(input)
    if (st.isFile() && st.nlink === 1 && path.extname(canonical).toLowerCase() === '.fbplugin') return { origin: 'file', source: { kind: 'zip', file: canonical } }
    if (st.isDirectory()) {
      const manifest = await fs.lstat(path.join(canonical, 'plugin.json'))
      if (manifest.isFile() && !manifest.isSymbolicLink() && manifest.nlink === 1) return { origin: 'folder', source: { kind: 'folder', dir: canonical } }
    }
    return refuse('plugins.path.invalid', 'Choose a .fbplugin file or a folder containing plugin.json.')
  }

  async installPaths(paths: unknown): Promise<InstallOutcome> {
    return this.serial(() => this.installPathsUnlocked(paths))
  }
  private async installPathsUnlocked(paths: unknown): Promise<InstallOutcome> {
    if (!Array.isArray(paths) || !paths.length || paths.length > 100) return { ok: false, code: 'plugins.paths.invalid', message: 'Drop between one and 100 plugin files or folders.' }
    let result: InstallOutcome = { cancelled: true }
    try {
      // Validate the entire batch before installing any prefix.
      const sources = []
      for (const input of paths) sources.push(await this.source(input))
      for (const { source, origin } of sources) {
        const read = await readPackage(source, { origin: { kind: origin }, signerStore: this.options.signerStore })
        if (!read.ok) return { ok: false, code: read.errors[0].code, message: 'The plugin package is invalid. Check its manifest and files.' }
        const pkg = read.package
        try {
          const compiled = await compilePlugin(pkg.manifest, { ...this.options.compileIO, readFile: file => pkg.readFile(file) })
          if (!compiled.ok) return { ok: false, code: compiled.errors[0].code, message: short(compiled.errors[0].message) }
          if (!await this.options.confirm(packageSummary(pkg))) return { cancelled: true }
          const old = (await readIndex(this.options.root)).plugins[pkg.manifest.id]
          const oldManifest = old && this.options.activation ? await this.lifecycle.manifest(pkg.manifest.id, old).catch(() => undefined) : undefined
          const applySettings = this.lifecycle.reconcile(oldManifest, pkg.manifest)
          const installed = await installPlugin(pkg, { root: this.options.root, origin, appVersion: this.options.appVersion,
            beforeIndex: record => writePayload(this.lifecycle.cacheRoot, this.lifecycle.key(pkg.manifest.id, record), compiled.compiled) })
          if (!installed.ok) return { ok: false, code: installed.error.code, message: short(installed.error.message) }
          const notices = [...compiled.compiled.warnings, ...installed.warnings].map(({ code, message }) => ({ code, message: short(message) }))
          if (!await this.lifecycle.catalog()) notices.push({ code: 'plugins.cache.catalog', message: 'The plugin catalog could not be saved. It will be rebuilt.' })
          try {
            this.options.installedVersion?.(pkg.manifest.id, installed.record.version)
            this.lifecycle.activate(pkg.manifest.id, compiled.compiled, installed.record.enabled, true)
            applySettings()
            this.lifecycle.errors.delete(pkg.manifest.id)
          } catch {
            try { await this.lifecycle.failed(pkg.manifest.id) } finally { this.publish() }
            return { ok: false, code: 'plugins.activation.failed', message: 'The plugin could not be activated. Reinstall or remove it.' }
          }
          result = { ok: true, id: pkg.manifest.id, ...(notices.length ? { notices } : {}) }
          this.publish()
        } finally { await pkg.close() }
      }
      return result
    } catch (error) {
      return { ok: false, code: error instanceof PluginHostError ? error.code : 'plugins.install.failed',
        message: error instanceof PluginHostError ? error.message : 'The plugin could not be read or installed. Check the selected file or folder.' }
    }
  }
}
