import { compileWhen } from '../commands/when.ts'
import { SettingsRegistry } from '../settings/registry.ts'
import { normalizeChord } from '../keys/chord.ts'
import type { Contribution, MenuPoint } from './contract.ts'
export type { Contribution, MenuPoint } from './contract.ts'

export const menubarPoints: readonly MenuPoint[] = Object.freeze(['menubar/file', 'menubar/edit', 'menubar/view', 'menubar/go', 'menubar/tools', 'menubar/help'])
const forbidden = new Set(['__proto__', 'constructor', 'prototype'])
function fail(message: string): never { throw new TypeError(`Invalid contribution: ${message}`) }

/** Copy bounded plain data without invoking getters or retaining caller-owned objects. */
function copy(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 20000 || depth > 5) fail('data exceeds node/depth limit')
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
  if (typeof value === 'string') { if (value.length > 256 || [...value].some(char => char.charCodeAt(0) < 32)) fail('strings must be short (256 characters)'); return value }
  if (Array.isArray(value)) {
    if (value.length > 500) fail('at most 500 items')
    if (Reflect.ownKeys(value).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)))) fail('unexpected array property')
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor)) fail('sparse arrays/accessors forbidden')
      return copy(descriptor.value, depth + 1, budget)
    })
  }
  if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('expected plain data')
  const result: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || forbidden.has(key)) fail('forbidden property')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!descriptor.enumerable || !('value' in descriptor)) fail('accessors/non-enumerable properties forbidden')
    result[key] = copy(descriptor.value, depth + 1, budget)
  }
  return result
}
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected object')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !allowed.includes(key))) fail('unknown field')
  return item
}
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) fail('expected nonempty string'); return value }
function optional(item: Record<string, unknown>, name: string, type: 'boolean' | 'number' | 'string'): void {
  if (Object.hasOwn(item, name) && typeof item[name] !== type) fail(`invalid ${name}`)
}
function condition(item: Record<string, unknown>): void { if (Object.hasOwn(item, 'when')) compileWhen(text(item.when)) }

/** Strictly validate the entire declaration before any live registry is touched. */
export function validateContribution(input: unknown): Contribution {
  const data = object(copy(input), ['pluginId', 'commands', 'keys', 'settings', 'menuItems'])
  const pluginId = text(data.pluginId)
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(pluginId) || forbidden.has(pluginId)) fail('invalid pluginId')
  const owned = (value: unknown): string => {
    const id = text(value)
    if (!id.startsWith(`${pluginId}:`) || !/^[a-z][\w.-]*$/.test(id.slice(pluginId.length + 1)) || id.split(/[:.]/).some(part => forbidden.has(part))) fail(`id must be prefixed with ${pluginId}:`)
    return id
  }
  let total = 0
  for (const name of ['commands', 'keys', 'settings', 'menuItems']) {
    if (!Object.hasOwn(data, name)) continue
    const entries = data[name]
    if (!Array.isArray(entries)) fail(`${name} must be a list`)
    total += entries.length
    if (total > 500) fail('at most 500 items in total')
    const ids = new Set<string>()
    const settings = new SettingsRegistry()
    for (const raw of entries) {
      const fields = name === 'commands' ? ['id', 'title', 'category', 'when', 'palette'] : name === 'keys' ? ['command', 'key'] : name === 'menuItems' ? ['id', 'command', 'point', 'group', 'order', 'when'] : ['id', 'type', 'default', 'category', 'label', 'choices', 'min', 'max', 'safety', 'description', 'keywords', 'choiceLabels', 'categoryLabel', 'restart']
      const item = object(raw, fields)
      if (name !== 'keys') { const id = owned(item.id); if (ids.has(id)) fail(`duplicate id: ${id}`); ids.add(id) }
      if (name === 'commands') { text(item.title); text(item.category); optional(item, 'palette', 'boolean'); condition(item) }
      if (name === 'keys') { owned(item.command); const key = text(item.key); normalizeChord(key, true); normalizeChord(key, false) }
      if (name === 'menuItems') {
        owned(item.command); text(item.group); condition(item)
        if (typeof item.point === 'string' && item.point.startsWith('context/')) fail('context menu points are reserved, not implemented')
        if (!menubarPoints.includes(item.point as MenuPoint)) fail('unknown menu point')
        if (!Number.isSafeInteger(item.order) || Math.abs(item.order as number) > 10000) fail('invalid menu order')
      }
      if (name === 'settings') {
        text(item.category)
        if (item.label !== null) text(item.label)
        if (!['boolean', 'choice', 'number', 'string', 'colour', 'list'].includes(text(item.type))) fail('unknown setting type')
        for (const field of ['min', 'max']) optional(item, field, 'number')
        for (const field of ['safety', 'restart']) optional(item, field, 'boolean')
        for (const field of ['description', 'categoryLabel']) optional(item, field, 'string')
        for (const field of ['keywords', 'choiceLabels']) if (Object.hasOwn(item, field) && (!Array.isArray(item[field]) || !(item[field] as unknown[]).every(value => typeof value === 'string'))) fail(`invalid ${field}`)
        if (Object.hasOwn(item, 'choices') && (!Array.isArray(item.choices) || !item.choices.every(value => ['boolean', 'number', 'string'].includes(typeof value)))) fail('invalid choices')
        if (item.min !== undefined && item.max !== undefined && (item.min as number) > (item.max as number)) fail('min exceeds max')
        if (!['boolean', 'number', 'string'].includes(typeof item.default) && (!Array.isArray(item.default) || !item.default.every(value => typeof value === 'string'))) fail('invalid default data')
        settings.defineSetting(item as unknown as Parameters<SettingsRegistry['defineSetting']>[0])
      }
    }
  }
  return data as unknown as Contribution
}
