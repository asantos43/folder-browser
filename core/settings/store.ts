import type { SettingsRegistry } from './registry.ts'

export const SETTINGS_FILE_LIMIT = 256 * 1024
export type SettingNotice = { id: string; message: string }
export type AtomicWriter = (contents: string) => Promise<void>
type Document = Record<string, unknown>
const isObject = (v: unknown): v is Document => !!v && typeof v === 'object' && !Array.isArray(v)
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export class SettingsStore {
  private values = new Map<string, unknown>()
  private unknown: Document = {}
  private listeners = new Set<(changed: readonly string[]) => void>()
  private notices: SettingNotice[] = []
  private pending = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirty = false
  private writing: Promise<void> | undefined
  private registry: SettingsRegistry
  private writer: AtomicWriter
  private intervalMs: number
  constructor(registry: SettingsRegistry, writer: AtomicWriter, intervalMs = 0) {
    this.registry = registry; this.writer = writer; this.intervalMs = intervalMs
    for (const d of registry.all()) this.values.set(d.id, d.default)
  }
  load(json: string): readonly SettingNotice[] {
    this.notices = []
    if (new TextEncoder().encode(json).length > SETTINGS_FILE_LIMIT) throw new Error('Settings file exceeds 256 KB')
    let parsed: unknown
    try { parsed = JSON.parse(json) } catch { throw new Error('Invalid settings JSON') }
    if (!isObject(parsed)) throw new Error('Settings file must be an object')
    const flat: Document = { ...parsed }
    const plugins = parsed.plugins
    if (isObject(plugins)) for (const [pluginId, values] of Object.entries(plugins)) if (isObject(values)) for (const [name, value] of Object.entries(values)) flat[`${pluginId}:${name}`] = value
    this.unknown = Object.fromEntries(Object.entries(parsed).filter(([id]) => !this.registry.get(id) && id !== 'plugins'))
    if (isObject(plugins)) {
      const kept: Document = {}
      for (const [plugin, values] of Object.entries(plugins)) {
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
      else { this.values.set(id, this.registry.getDefault(id)); this.notices.push({ id, message: `Invalid value for ${id}; default restored` }) }
    }
    return [...this.notices]
  }
  get(id: string): unknown { if (!this.registry.get(id)) throw new Error(`Unknown setting: ${id}`); return this.values.get(id) }
  set(id: string, value: unknown): void {
    if (!this.registry.validate(id, value)) throw new Error(`Invalid value for setting ${id}`)
    if (equal(this.values.get(id), value)) return
    this.values.set(id, value); this.dirty = true
    for (const fn of this.listeners) fn([id])
    this.schedule()
  }
  reset(id: string): void { this.set(id, this.registry.getDefault(id)) }
  resetAll(): void { for (const d of this.registry.all()) this.set(d.id, d.default) }
  subscribe(fn: (changed: readonly string[]) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getNotices(): readonly SettingNotice[] { return [...this.notices] }
  snapshot(): ReadonlyMap<string, unknown> { return new Map(this.values) }
  exportObject(): Record<string, unknown> { return Object.fromEntries([...this.values].filter(([id,v]) => !equal(v, this.registry.getDefault(id)))) }
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
    if (!this.dirty) return
    this.dirty = false
    const out: Document = { ...this.unknown }
    const plugins = (isObject(this.unknown.plugins) ? structuredClone(this.unknown.plugins) : {}) as Record<string, Document>
    for (const [id, value] of this.values) {
      if (equal(value, this.registry.getDefault(id))) continue
      const sep = id.indexOf(':')
      if (sep >= 0) (plugins[id.slice(0, sep)] ??= {})[id.slice(sep + 1)] = value
      else out[id] = value
    }
    if (Object.keys(plugins).length) out.plugins = plugins
    const writing = this.writer(JSON.stringify(out, null, 2)).catch(error => { this.dirty = true; throw error })
    this.writing = writing
    try { await writing } finally { if (this.writing === writing) this.writing = undefined }
    if (this.dirty) this.schedule()
  }
}
