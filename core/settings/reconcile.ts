import type { SettingDefinition } from './registry.ts'

/** Shared by manifest updates and live store hydration, before obsolete keys are dropped. */
export function reconcileSettings(old: ReadonlyMap<string, SettingDefinition>, definitions: readonly SettingDefinition[], stored: Readonly<Record<string, unknown>>, pluginId: string, validate: (definition: SettingDefinition, value: unknown) => boolean): { values: Record<string, unknown>; needsConfirmation: Record<string, unknown>; resetKeys: string[] } {
  const values: Record<string, unknown> = Object.create(null), needsConfirmation: Record<string, unknown> = Object.create(null), resetKeys: string[] = []
  const permissions = (d: SettingDefinition) => JSON.stringify([d.type, d.default, d.choices, d.min, d.max, d.step, d.maxLength, d.maxItems])
  for (const d of definitions) {
    const key = d.id.slice(pluginId.length + 1), source = Object.hasOwn(stored, key) ? key : d.renamedFrom
    const previous = old.get(`${pluginId}:${source ?? key}`)
    const supplied = source !== undefined && Object.hasOwn(stored, source)
    const value = supplied ? stored[source] : d.default
    if (d.reaches && (!previous || permissions(previous) !== permissions(d))) { needsConfirmation[key] = structuredClone(value); continue }
    const valid = !supplied || (previous?.type === d.type && validate(d, value))
    values[key] = structuredClone(valid ? value : d.default)
    if (!valid) resetKeys.push(key)
  }
  return { values, needsConfirmation, resetKeys }
}

