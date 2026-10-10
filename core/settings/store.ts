import type { SettingDefinition, SettingsRegistry } from './registry.ts'
import { reconcileSettings } from './reconcile.ts'

export const SETTINGS_FILE_LIMIT = 256 * 1024
export type SettingNotice = { id: string; message: string }
export type AtomicWriter = (contents: string) => Promise<void>
type Document = Record<string, unknown>
const isObject = (v: unknown): v is Document => !!v && typeof v === 'object' && !Array.isArray(v)
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export class SettingsStore {
  private values = new Map<string, unknown>()
  private valueTypes = new Map<string, string>()
  private definitions = new Map<string, SettingDefinition>()
  registryVersion = (): number => this.registry.version()
  definition(id: string): SettingDefinition | undefined { return this.registry.get(id) }
  private unknown: Document = {}
  private listeners = new Set<(changed: readonly string[]) => void>()
  private notices: SettingNotice[] = []
  private pending = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirty = false
  private revision = 0
  version = (): number => this.revision
  private writing: Promise<void> | undefined
  private registry: SettingsRegistry
  private writer: AtomicWriter
  private intervalMs: number
  constructor(registry: SettingsRegistry, writer: AtomicWriter, intervalMs = 0) {
    this.registry = registry; this.writer = writer; this.intervalMs = intervalMs
    for (const d of registry.all()) { this.values.set(d.id, d.default); this.valueTypes.set(d.id, d.type); this.definitions.set(d.id, d) }
  }
  load(json: string): readonly SettingNotice[] {
    this.notices = []
    if (new TextEncoder().encode(json).length > SETTINGS_FILE_LIMIT) throw new Error('Settings file exceeds 256 KB')
    let parsed: unknown
    try { parsed = JSON.parse(json) } catch { throw new Error('Invalid settings JSON') }
    if (!isObject(parsed)) throw new Error('Settings file must be an object')
    this.values.clear()
    this.valueTypes.clear()
    this.definitions.clear()
    for (const d of this.registry.all()) { this.values.set(d.id, d.default); this.valueTypes.set(d.id, d.type); this.definitions.set(d.id, d) }
    this.revision++
    const flat: Document = { ...parsed }
    let repaired = false
    const plugins = parsed.plugins
    if (isObject(plugins)) for (const [pluginId, values] of Object.entries(plugins)) if (isObject(values)) for (const [name, value] of Object.entries(values)) flat[`${pluginId}:${name}`] = value
    for (const d of this.registry.all()) if (d.renamedFrom && d.id.includes(':')) {
      const old = `${d.id.slice(0, d.id.indexOf(':'))}:${d.renamedFrom}`
      if (!Object.hasOwn(flat, d.id) && Object.hasOwn(flat, old)) flat[d.id] = flat[old]
      if (Object.hasOwn(flat, old)) repaired = true
      delete flat[old]
    }
    this.unknown = Object.fromEntries(Object.entries(parsed).filter(([id]) => !this.registry.get(id) && id !== 'plugins'))
    if (isObject(plugins)) {
      const kept: Document = Object.create(null)
      const installed = new Set(this.registry.all().filter(d => d.id.includes(':')).map(d => d.id.split(':')[0]))
      for (const [plugin, values] of Object.entries(plugins)) {
        if (installed.has(plugin)) {
          if (isObject(values) && Object.keys(values).some(key => !this.registry.get(`${plugin}:${key}`))) repaired = true
          continue
        }
        if (!isObject(values)) { kept[plugin] = values; continue }
        const remainder = Object.fromEntries(Object.entries(values).filter(([name]) => !this.registry.get(`${plugin}:${name}`)))
        if (Object.keys(remainder).length) kept[plugin] = remainder
      }
      if (Object.keys(kept).length) this.unknown.plugins = kept
    }
    for (const [id, raw] of Object.entries(flat)) {
      if (id === 'plugins' || !this.registry.get(id)) continue
      const normalized = this.registry.get(id)?.normalize?.(raw)
      const value = normalized ? normalized.value : raw
      if (normalized?.warning) this.notices.push({ id, message: normalized.warning })
      if (this.registry.validate(id, value)) this.values.set(id, value)
      else { this.values.set(id, this.registry.getDefault(id)); this.notices.push({ id, message: `Invalid value for ${id}; default restored` }); if (id.includes(':')) repaired = true }
    }
    if (repaired) { this.dirty = true; this.schedule() }
    return [...this.notices]
  }
  get(id: string): unknown { if (!this.registry.get(id)) throw new Error(`Unknown setting: ${id}`); return this.values.has(id) ? this.values.get(id) : this.registry.getDefault(id) }
  isCurrentType(id: string): boolean { return !this.valueTypes.has(id) || this.valueTypes.get(id) === this.registry.get(id)?.type }
  /** Hydrate retained settings when a plugin is registered after the file was loaded. */
  preparePlugin(pluginId: string): void {
    const definitions = this.registry.all().filter(d => d.id.startsWith(`${pluginId}:`))
    const plugins = this.unknown.plugins
    const raw = isObject(plugins) && Object.hasOwn(plugins, pluginId) ? plugins[pluginId] : undefined
    const liveRename = definitions.some(d => d.renamedFrom && !this.values.has(d.id) && this.values.has(`${pluginId}:${d.renamedFrom}`))
    if (definitions.length && (isObject(raw) || liveRename)) {
      const stored: Document = isObject(raw) ? { ...raw } : Object.create(null)
      const previous = new Map(this.definitions)
      for (const d of definitions) if (!previous.has(d.id) && !liveRename) {
        previous.set(d.id, d)
        if (d.renamedFrom && isObject(raw) && Object.hasOwn(raw, d.renamedFrom)) {
          const oldId = `${pluginId}:${d.renamedFrom}`
          if (!previous.has(oldId)) previous.set(oldId, { ...d, id: oldId })
        }
      }
      for (const [id, value] of this.values) if (id.startsWith(`${pluginId}:`)) stored[id.slice(pluginId.length + 1)] = value
      const reconciled = reconcileSettings(previous, definitions, stored, pluginId, (d, value) => this.registry.validate(d.id, value))
      for (const d of definitions) {
        const key = d.id.slice(pluginId.length + 1)
        this.values.set(d.id, reconciled.values[key] ?? d.default)
        this.valueTypes.set(d.id, d.type); this.definitions.set(d.id, d)
        if (reconciled.resetKeys.includes(key) || Object.hasOwn(reconciled.needsConfirmation, key)) this.notices.push({ id: d.id, message: 'Invalid value; default restored' })
      }
      this.revision++; this.dirty = true; this.schedule()
    }
    if (definitions.length) for (const id of this.values.keys()) if (id.startsWith(`${pluginId}:`) && !this.registry.get(id)) {
      this.values.delete(id); this.valueTypes.delete(id); this.definitions.delete(id); this.revision++; this.dirty = true; this.schedule()
    }
    if (definitions.length && isObject(raw)) delete (plugins as Document)[pluginId]
  }
  /** Resolve retained plugin values before portable comparisons and validate current declarations. */
  prepareSettings(): void {
    const owners = new Set(this.registry.all().filter(d => d.id.includes(':')).map(d => d.id.split(':')[0]))
    for (const owner of owners) this.preparePlugin(owner)
    this.revalidateValues()
  }
  private revalidateValues(): void {
    for (const [id, value] of this.values) if (this.registry.get(id) && (!this.isCurrentType(id) || !this.registry.validate(id, value))) {
      const d = this.registry.get(id)!
      this.values.set(id, structuredClone(d.default)); this.valueTypes.set(id, d.type); this.definitions.set(id, d)
      this.notices = this.notices.filter(n => n.id !== id)
      this.notices.push({ id, message: `Invalid value for ${id}; default restored` })
      this.revision++; this.dirty = true
    }
  }
  purgePlugin(pluginId: string): void {
    for (const id of this.values.keys()) if (id.startsWith(`${pluginId}:`)) { this.values.delete(id); this.valueTypes.delete(id); this.definitions.delete(id) }
    if (isObject(this.unknown.plugins)) delete this.unknown.plugins[pluginId]
    this.notices = this.notices.filter(n => !n.id.startsWith(`${pluginId}:`))
    this.revision++; this.dirty = true
    for (const fn of this.listeners) fn([`${pluginId}:*`])
    this.schedule()
  }
  set(id: string, value: unknown): void {
    if (!this.registry.validate(id, value)) throw new Error(`Invalid value for setting ${id}`)
    const hadNotice = this.notices.some(n => n.id === id)
    this.notices = this.notices.filter(n => n.id !== id)
    if (this.isCurrentType(id) && equal(this.values.get(id), value)) { if (hadNotice) this.revision++; return }
    this.valueTypes.set(id, this.registry.get(id)!.type)
    this.definitions.set(id, this.registry.get(id)!)
    this.values.set(id, structuredClone(value)); this.dirty = true; this.revision++
    for (const fn of this.listeners) fn([id])
    this.schedule()
  }
  reset(id: string): void { this.set(id, this.registry.getDefault(id)) }
  resetAll(): void { for (const d of this.registry.all()) this.set(d.id, d.default) }
  subscribe(fn: (changed: readonly string[]) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getNotices(): readonly SettingNotice[] { return [...this.notices] }
  snapshot(): ReadonlyMap<string, unknown> { return new Map(this.values) }
  exportObject(): Record<string, unknown> { this.prepareSettings(); return Object.fromEntries([...this.values].filter(([id,v]) => this.isCurrentType(id) && this.registry.validate(id, v) && !equal(v, this.registry.getDefault(id)))) }
  private schedule(): void {
    if (this.pending) return
    this.pending = true
    if (this.intervalMs > 0) this.timer = setTimeout(() => { void this.flush().catch(() => {}) }, this.intervalMs)
    else queueMicrotask(() => { void this.flush().catch(() => {}) })
  }
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined; this.pending = false
    if (this.writing) {
      await this.writing
      if (this.dirty) await this.flush()
      return
    }
    this.revalidateValues()
    if (!this.dirty) return
    this.dirty = false
    const out: Document = { ...this.unknown }
    const plugins = (isObject(this.unknown.plugins) ? structuredClone(this.unknown.plugins) : {}) as Record<string, Document>
    for (const [id, value] of this.values) {
      if (!this.registry.get(id)) {
        const sep = id.indexOf(':')
        if (sep >= 0) (plugins[id.slice(0, sep)] ??= Object.create(null))[id.slice(sep + 1)] = value
        continue
      }
      if (equal(value, this.registry.getDefault(id))) continue
      const sep = id.indexOf(':')
      if (sep >= 0) (plugins[id.slice(0, sep)] ??= Object.create(null))[id.slice(sep + 1)] = value
      else out[id] = value
    }
    if (Object.keys(plugins).length) out.plugins = plugins
    const writing = this.writer(JSON.stringify(out, null, 2)).catch(error => { this.dirty = true; throw error })
    this.writing = writing
    try { await writing } finally { if (this.writing === writing) this.writing = undefined }
    if (this.dirty) this.schedule()
  }
}
