export type SettingType = 'boolean' | 'choice' | 'number' | 'string' | 'colour' | 'list'
export type SettingDefinition = {
  id: string; type: SettingType; default: unknown; category: string; label: string | null
  choices?: readonly unknown[]; min?: number; max?: number; safety?: boolean
  description?: string; keywords?: readonly string[]; choiceLabels?: readonly string[]; categoryLabel?: string; restart?: boolean
}
export type SettingInput = Omit<SettingDefinition, 'id'> & { id: string }

export class SettingsRegistry {
  private entries = new Map<string, SettingDefinition>()
  private listeners = new Set<() => void>()
  private revision = 0
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  version = (): number => this.revision
  private changed(): void { this.revision++; for (const listener of this.listeners) listener() }
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
    const added = inputs.map(x => this.defineSetting(x))
    let removed = false
    return () => { if (!removed) { for (const item of added) this.entries.delete(item.id); removed = true; this.changed() } }
  }
  private isValid(d: SettingDefinition, v: unknown): boolean {
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
