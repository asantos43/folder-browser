import type { ConfigurationProperty, PluginManifest } from './manifest.ts'
import type { SettingInput, SettingsRegistry } from '../settings/registry.ts'
import { reconcileSettings } from '../settings/reconcile.ts'
import type { SettingsStore } from '../settings/store.ts'

type Property = ConfigurationProperty & { reaches?: boolean }
export type PluginSettingsNotice = { key: string; code: 'settings.value.reset' }
export type PluginSettingsRead = { values: Readonly<Record<string, unknown>>; notices: readonly PluginSettingsNotice[] }
const forbidden = new Set(['__proto__', 'constructor', 'prototype'])
const encoder = new TextEncoder()
const textFits = (v: unknown, limit = 4096): v is string => typeof v === 'string' && v.length <= limit && encoder.encode(v).length <= limit

function localKey(pluginId: string, key: string): string {
  const local = key.includes(':') ? key.slice(pluginId.length + 1) : key
  if ((key.includes(':') && !key.startsWith(`${pluginId}:`)) || !local || forbidden.has(local)) throw new Error('Setting must belong to this plugin')
  return local
}
function valid(p: Property, value: unknown): boolean {
  switch (p.type) {
    case 'boolean': return typeof value === 'boolean'
    case 'enum': return !!p.values?.some(v => Object.is(v, value))
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value) || (p.min !== undefined && value < p.min) || (p.max !== undefined && value > p.max)) return false
      if (p.step === undefined) return true
      const steps = (value - (p.min ?? 0)) / p.step
      return Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) <= Number.EPSILON * Math.max(1, Math.abs(steps)) * 8
    }
    case 'string': return textFits(value, p.maxLength ?? 4096)
    case 'colour': return typeof value === 'string' && (value === '' || (value.length === 7 && value[0] === '#' && [...value.slice(1)].every(c => '0123456789abcdefABCDEF'.includes(c))))
    case 'list': return Array.isArray(value) && value.length <= (p.maxItems ?? 1000) && Array.from(value).every(v => textFits(v))
    default: return false
  }
}

/** Install-time compilation only: locale keys and conditions remain plain data. */
export function compileConfiguration(manifest: PluginManifest): SettingInput[] {
  const configuration = manifest.contributes.configuration
  if (!configuration) return []
  const entries = Object.entries(configuration.properties)
  if (entries.length > 100) throw new Error('At most 100 plugin settings')
  return entries.map(([key, source]) => {
    const local = localKey(manifest.id, key)
    const p: Property = structuredClone(source)
    if (p.values && (p.values.length > 1000 || p.values.some(v => typeof v === 'string' && !textFits(v)))) throw new Error('Invalid enum size limit')
    for (const [bound, limit] of [[p.maxLength, 4096], [p.maxItems, 1000]]) if (bound !== undefined && (!Number.isInteger(bound) || bound < 0 || bound > limit!)) throw new Error('Invalid setting size limit')
    if (p.step !== undefined && (!Number.isFinite(p.step) || p.step <= 0)) throw new Error('Invalid number step')
    if ((p.min !== undefined && !Number.isFinite(p.min)) || (p.max !== undefined && !Number.isFinite(p.max)) || (p.min !== undefined && p.max !== undefined && p.min > p.max)) throw new Error('Invalid number bounds')
    if (p.renamedFrom) localKey(manifest.id, p.renamedFrom)
    if (!valid(p, p.default)) throw new Error('Invalid setting default')
    return {
      id: `${manifest.id}:${local}`, type: p.type === 'enum' ? 'choice' : p.type,
      default: p.default, category: `plugins.${manifest.id}`, categoryLabel: configuration.title,
      label: p.label, description: p.description, keywords: p.keywords, restart: p.reload, safety: false,
      choices: p.values, choiceLabels: p.valueLabels, min: p.min, max: p.max,
      step: p.step, maxLength: p.maxLength, maxItems: p.maxItems,
      group: p.group, order: p.order, enabledWhen: p.enabledWhen, renamedFrom: p.renamedFrom, reaches: p.reaches,
      validator: value => valid(p, value),
    }
  })
}
export function installPluginSettings(registry: SettingsRegistry, manifest: PluginManifest): () => void {
  return registry.contribute(compileConfiguration(manifest))
}
export function removePluginSettings(registry: SettingsRegistry, pluginId: string): void {
  registry.transaction(() => { for (const d of registry.all()) if (d.id.startsWith(`${pluginId}:`)) registry.remove(d.id) })
}
const caches = new WeakMap<SettingsStore, Map<string, { registry: SettingsRegistry; registryVersion: number; storeVersion: number; result: PluginSettingsRead }>>()
export function readPluginSettings(registry: SettingsRegistry, store: SettingsStore, pluginId: string): PluginSettingsRead {
  let cache = caches.get(store)
  if (!cache) { cache = new Map(); caches.set(store, cache) }
  const cached = cache.get(pluginId)
  if (cached?.registry === registry && cached.registryVersion === registry.version() && cached.storeVersion === store.version()) return cached.result
  store.preparePlugin(pluginId)
  const values: Record<string, unknown> = Object.create(null), notices: PluginSettingsNotice[] = []
  const reset = new Set(store.getNotices().map(n => n.id))
  for (const d of registry.all()) if (d.id.startsWith(`${pluginId}:`)) {
    const key = d.id.slice(pluginId.length + 1), value = store.get(d.id)
    const valid = store.isCurrentType(d.id) && registry.validate(d.id, value)
    const copy = structuredClone(valid ? value : d.default)
    values[key] = Array.isArray(copy) ? Object.freeze(copy) : copy
    if (!valid || reset.has(d.id)) notices.push({ key, code: 'settings.value.reset' })
    if (!valid) store.reset(d.id)
  }
  const result = Object.freeze({ values: Object.freeze(values), notices: Object.freeze(notices) })
  cache.set(pluginId, { registry, registryVersion: registry.version(), storeVersion: store.version(), result })
  return result
}
export function writePluginSetting(registry: SettingsRegistry, store: SettingsStore, pluginId: string, key: string, value: unknown): { ok: true } | { ok: false; code: string } {
  if (key.includes(':') || forbidden.has(key)) return { ok: false, code: 'settings.key.unknown' }
  const id = `${pluginId}:${key}`
  if (!registry.get(id)) return { ok: false, code: 'settings.key.unknown' }
  if (!registry.validate(id, value)) return { ok: false, code: 'settings.value.invalid' }
  store.preparePlugin(pluginId); store.set(id, value)
  return { ok: true }
}
export function resetPluginSettings(registry: SettingsRegistry, store: SettingsStore, pluginId: string, key?: string): void {
  store.preparePlugin(pluginId)
  if (key !== undefined) { if (key.includes(':') || forbidden.has(key) || !registry.get(`${pluginId}:${key}`)) throw new Error('Unknown plugin setting'); store.reset(`${pluginId}:${key}`); return }
  for (const d of registry.all()) if (d.id.startsWith(`${pluginId}:`)) store.reset(d.id)
}
export function purgePluginSettings(store: SettingsStore, pluginId: string): void { store.purgePlugin(pluginId) }

export function reconcileOnUpdate(oldManifest: PluginManifest, newManifest: PluginManifest, stored: Readonly<Record<string, unknown>>): { values: Record<string, unknown>; needsConfirmation: Record<string, unknown> } {
  if (oldManifest.id !== newManifest.id) throw new Error('Plugin update must retain its id')
  const old = new Map(compileConfiguration(oldManifest).map(d => [d.id, d]))
  const { values, needsConfirmation } = reconcileSettings(old, compileConfiguration(newManifest), stored, newManifest.id, (d, value) => d.validator!(value))
  return { values, needsConfirmation }
}
