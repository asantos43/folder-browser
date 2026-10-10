export type SettingType = 'boolean' | 'choice' | 'number' | 'string' | 'colour' | 'list'
export type SettingDefinition = {
  id: string; type: SettingType; default: unknown; category: string; label: string | null
  choices?: readonly unknown[]; min?: number; max?: number; safety?: boolean
  description?: string; keywords?: readonly string[]; choiceLabels?: readonly string[]; categoryLabel?: string; restart?: boolean
  validator?: (value: unknown) => boolean
  normalize?: (value: unknown) => { value: unknown; warning?: string }
}
export type SettingInput = Omit<SettingDefinition, 'id'> & { id: string }

export class SettingsRegistry {
  private entries = new Map<string, SettingDefinition>()
  private listeners = new Set<() => void>()
  private revision = 0
  private batching = false
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  version = (): number => this.revision
  private changed(): void { this.revision++; if (!this.batching) for (const listener of this.listeners) listener() }
  /** Roll back definitions and revision on failure; notify only after the whole batch. */
  transaction<T>(operation: () => T): T {
    if (this.batching) throw new Error('Nested settings transaction')
    const before = new Map(this.entries), revision = this.revision
    this.batching = true
    try {
      const result = operation()
      this.batching = false
      if (this.revision !== revision) for (const listener of this.listeners) listener()
      return result
    } catch (error) {
      this.entries = before; this.revision = revision; this.batching = false
      throw error
    }
  }
  remove(id: string): boolean {
    const removed = this.entries.delete(id)
    if (removed) this.changed()
    return removed
  }
  defineSetting(input: SettingInput): SettingDefinition {
    if (!/^[a-z][\w-]*(?:\.[a-z][\w-]*)+$/.test(input.id) && !/^[a-z][\w-]*:[a-z][\w.-]*$/.test(input.id)) throw new Error(`Invalid setting id: ${input.id}`)
    if (this.entries.has(input.id)) throw new Error(`Setting id already defined: ${input.id}`)
    const def = Object.freeze({ ...input, choices: input.choices && Object.freeze([...input.choices]) })
    if (!this.isValid(def, def.default)) throw new Error(`Invalid default for setting ${def.id}`)
    this.entries.set(def.id, def)
    this.changed()
    return def
  }
  get(id: string): SettingDefinition | undefined { return this.entries.get(id) }
  getDefault(id: string): unknown { const def = this.entries.get(id); if (!def) throw new Error(`Unknown setting: ${id}`); return def.default }
  validate(id: string, value: unknown): boolean { const def = this.entries.get(id); return !!def && this.isValid(def, value) }
  all(): readonly SettingDefinition[] { return [...this.entries.values()] }
  contribute(inputs: readonly SettingInput[]): () => void {
    const ids = inputs.map(x => x.id)
    if (new Set(ids).size !== ids.length || ids.some(id => !id.includes(':'))) throw new Error('Plugin settings must have unique <plugin>:<name> ids')
    for (const id of ids) if (this.entries.has(id)) throw new Error(`Setting id already defined: ${id}`)
    const added = this.transaction(() => inputs.map(x => this.defineSetting(x)))
    let removed = false
    return () => { if (!removed) { this.transaction(() => { for (const item of added) this.remove(item.id) }); removed = true } }
  }
  private isValid(d: SettingDefinition, v: unknown): boolean {
    if (d.validator) return d.validator(v)
    switch (d.type) {
      case 'boolean': return typeof v === 'boolean'
      case 'choice': return d.choices?.some(x => Object.is(x, v)) ?? false
      case 'number': return typeof v === 'number' && Number.isFinite(v) && (d.min === undefined || v >= d.min) && (d.max === undefined || v <= d.max)
      case 'string': return typeof v === 'string'
      case 'colour': return typeof v === 'string' && (v === '' || /^#[\da-f]{6}$/i.test(v))
      case 'list': return Array.isArray(v) && v.every(x => typeof x === 'string')
    }
  }
}

export const settingsRegistry = new SettingsRegistry()
export const defineSetting = (input: SettingInput) => settingsRegistry.defineSetting(input)
