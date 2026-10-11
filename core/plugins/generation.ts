import type { CompiledPlugin } from './compile.ts'
import type { ActivationContext } from './activation.ts'
import type { SettingInput } from '../settings/registry.ts'
import { compiledPluginSettings } from './settings.ts'
import { validateContribution } from '../contributions/types.ts'
import type { Contribution } from '../contributions/contract.ts'
import type { createMenuRegistry } from '../contributions/menus.ts'
import { assertPluginChord } from '../keys/reserved.ts'
import { normalizeChord } from '../keys/chord.ts'
import { platformChord } from '../keys/table.ts'
import { builtinKeyCommands } from '../commands/builtin.ts'
import { LANGUAGES } from '../filekind.ts'
import { GENERATION_BYTE_LIMIT, PLUGIN_TEXT_KEY_LIMIT, PLUGIN_TEXT_BYTE_LIMIT, PLUGIN_TEXT_DICTIONARY_LIMIT, PLUGIN_TEXT_KEY_PATTERN, PLUGIN_TEXT_CONTROLS } from './runtime-types.ts'

const encoder = new TextEncoder()
const forbidden = new Set(['__proto__', 'constructor', 'prototype', 'exec', 'program', 'args', 'keymapKeys', 'validator', 'path'])
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

/** Reject accessors and non-JSON data, and detach all projected metadata. */
function data(value: unknown, depth = 0): Json {
  if (depth > 16) throw new Error('Generation data too deep')
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  if (!value || typeof value !== 'object') throw new Error('Generation requires JSON data')
  if (Array.isArray(value)) return Object.freeze(Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor)) throw new Error('Invalid generation array')
    return data(descriptor.value, depth + 1)
  }))
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid generation object')
  const result: Record<string, Json> = {}
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== 'string' || forbidden.has(key) || !descriptor.enumerable || !('value' in descriptor)) throw new Error('Unsafe generation property')
    result[key] = data(descriptor.value, depth + 1)
  }
  return Object.freeze(result)
}
function pick<T extends object>(source: T, fields: readonly (keyof T)[]): T {
  return Object.fromEntries(fields.filter(field => source[field] !== undefined).map(field => [field, source[field]])) as T
}
export interface GenerationPlugin {
  readonly owner: string
  readonly enabled: boolean
  readonly themes: CompiledPlugin['themes']
  readonly locales: CompiledPlugin['locales']
  readonly texts: NonNullable<CompiledPlugin['texts']>
  readonly languages: CompiledPlugin['languages']
  readonly commands: readonly (Omit<CompiledPlugin['commands'][number], 'exec'> & { readonly enabled: boolean; readonly disabledReason?: string })[]
  readonly menuItems: CompiledPlugin['contribution']['menuItems']
  readonly keySchemes: CompiledPlugin['keySchemes']
  /** Normalized scheme entries; no raw parallel keymapKeys projection. */
  readonly keyEntries: readonly { command: string; key: string; scheme?: string }[]
  readonly resolvedKeys?: readonly { id: string; keys?: readonly string[] }[]
  readonly settings: readonly Omit<SettingInput, 'validator' | 'normalize'>[]
}
export interface GenerationSnapshot { readonly version: number; readonly plugins: readonly GenerationPlugin[] }
export interface GenerationHandle {
  readonly owner: string
  readonly plugin: GenerationPlugin
  /** Host-only definitions: never included in snapshot(). */
  readonly definitions: readonly SettingInput[]
  readonly contribution: Contribution
  readonly bytes: number
  readonly fingerprint: string
}
export interface GenerationLimits { readonly bytes?: number }

export function createGenerationStore(limits: GenerationLimits = {}) {
  const byteLimit = Math.min(limits.bytes ?? GENERATION_BYTE_LIMIT, GENERATION_BYTE_LIMIT)
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1) throw new Error('Invalid generation limit')
  let owners = new Map<string, GenerationHandle>()
  let version = 0, bytes = 0, batching = false, batchVersion = 0
  let cached: GenerationSnapshot | undefined
  const listeners = new Set<() => void>()
  const notify = () => { for (const listener of listeners) { try { listener() } catch { /* Subscribers cannot undo publication. */ } } }
  // The envelope reserves enough bytes for version growth and array separators.
  const fits = (size: number, count: number) => { if (size + count + 64 > byteLimit) throw new Error('Plugin generation exceeds byte limit') }
  const changed = () => { version++; cached = undefined; if (!batching) notify() }
  function stage(owner: string, compiled: CompiledPlugin, context: ActivationContext): GenerationHandle {
    if (!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/.test(owner) || compiled.pluginId !== owner || compiled.contribution.pluginId !== owner) throw new Error('Generation owner mismatch')
    const adapted = compiledPluginSettings(compiled)
    const { pluginId, commands, keys, menuItems } = compiled.contribution
    // Never pass exec or keymapKeys to the strict gate.
    const contribution = data(validateContribution({ pluginId, commands, keys, menuItems, settings: adapted.settings }, adapted.limits)) as unknown as Contribution
    const owned = (id: string) => { if (!id.startsWith(`${owner}:`)) throw new Error('Foreign generation id') }
    const unique = (ids: readonly string[]) => { ids.forEach(owned); if (new Set(ids).size !== ids.length) throw new Error('Duplicate generation id') }
    unique(compiled.commands.map(command => command.id))
    unique(compiled.themes.map(theme => theme.id))
    unique(compiled.languages.map(language => language.id))
    for (const language of compiled.languages) {
      if (!(LANGUAGES as readonly string[]).includes(language.languageId) || !language.extensions.length && !language.filenames.length || language.extensions.some(extension => !/^\.[a-z0-9][a-z0-9._+-]*$/.test(extension)) || language.filenames.some(filename => !filename || /[/\\]/.test(filename) || ['.', '..'].includes(filename))) throw new Error('Invalid generation language')
    }
    // Scheme ids are local metadata in compiler output.
    if (new Set(compiled.keySchemes.map(scheme => scheme.id)).size !== compiled.keySchemes.length) throw new Error('Duplicate key scheme')
    for (const theme of compiled.themes) {
      if (!['light', 'dark'].includes(theme.base) || Object.keys(theme.tokens).length > 400) throw new Error('Invalid generation theme')
      for (const [token, colour] of Object.entries(theme.tokens)) {
        if (!/^[a-zA-Z][\w-]*$/.test(token) || typeof colour !== 'string' || PLUGIN_TEXT_CONTROLS.test(colour) || !/^(?:#[\da-f]{3}|#[\da-f]{6}|#[\da-f]{8}|(?:rgb|rgba|hsl|hsla)\([\d.,%+\-\s]+\)|transparent)$/i.test(colour)) throw new Error('Invalid theme token')
      }
    }
    const text = (value: unknown) => { if (typeof value !== 'string' || encoder.encode(value).length > PLUGIN_TEXT_BYTE_LIMIT || PLUGIN_TEXT_CONTROLS.test(value)) throw new Error('Invalid generation text') }
    const localeTags = new Set<string>()
    for (const locale of compiled.locales) {
      let language: string
      try { language = Intl.getCanonicalLocales(locale.language)[0] } catch { throw new Error('Invalid generation locale') }
      if (!language || ['en', 'pt-BR'].includes(language) || localeTags.has(language)) throw new Error('Duplicate or core locale')
      localeTags.add(language)
      if (Object.keys(locale.translations).length > PLUGIN_TEXT_KEY_LIMIT) throw new Error('Too many locale texts')
      Object.values(locale.translations).forEach(text)
      for (const [other, handle] of owners) if (other !== owner && handle.plugin.locales.some(item => Intl.getCanonicalLocales(item.language)[0] === language)) throw new Error('Locale owned by another plugin')
    }
    const texts = compiled.texts ?? {}
    if (Object.keys(texts).length > PLUGIN_TEXT_KEY_LIMIT || encoder.encode(JSON.stringify(texts)).length > PLUGIN_TEXT_DICTIONARY_LIMIT) throw new Error('Plugin text dictionary too large')
    for (const [key, translations] of Object.entries(texts)) {
      if (!PLUGIN_TEXT_KEY_PATTERN.test(key) || Object.keys(translations).some(language => !['en', 'pt-BR'].includes(language))) throw new Error('Invalid plugin text key')
      Object.values(translations).forEach(text)
    }
    const commandIds = new Set(commands.map(command => command.id))
    const coreCommandIds = new Set(builtinKeyCommands.map(command => command.id))
    for (const key of keys) if (!commandIds.has(key.command)) throw new Error('Unknown default key command')
    for (const item of menuItems) if (!commandIds.has(item.command)) throw new Error('Unknown menu command')
    const keyEntries = [
      ...compiled.commands.flatMap(command => command.defaultKeys.map(key => ({ command: command.id, key }))),
      ...compiled.keymaps.map(entry => ({ command: entry.command, key: entry.key, scheme: entry.source.keymapId })),
    ].map(entry => {
      // Reserved validation accepts platform-qualified chords via the shared guard.
      for (const mac of [true, false]) {
        const chord = platformChord(entry.key, mac)
        if (chord !== undefined) { assertPluginChord(chord, mac); normalizeChord(chord, mac) }
      }
      if ('scheme' in entry && !compiled.keySchemes.some(scheme => scheme.id === entry.scheme)) throw new Error('Unknown key scheme')
      if (!commandIds.has(entry.command) && !coreCommandIds.has(entry.command)) throw new Error('Unknown or foreign key command')
      return entry
    })
    const definitions = adapted.settings.map(setting => Object.freeze({ ...(data(setting) as unknown as SettingInput), validator: adapted.validators.get(setting.id), owner: Object.freeze({ id: owner, enabled: context.enabled }) }))
    const plugin = data({ owner, enabled: context.enabled,
      themes: context.enabled ? compiled.themes.map(theme => pick(theme, ['id', 'label', 'base', 'tokens'])) : [],
      locales: context.enabled ? compiled.locales.map(locale => pick(locale, ['language', 'label', 'translations'])) : [],
      texts: context.enabled ? texts : {},
      languages: context.enabled ? compiled.languages.map(language => pick(language, ['id', 'label', 'extensions', 'filenames', 'languageId'])) : [],
      commands: context.enabled ? compiled.commands.map(command => ({ ...pick(command, ['id', 'title', 'category', 'when', 'palette', 'defaultKeys', 'menu']), enabled: !!command.exec && !context.disabledCommands.has(command.id), ...(!command.exec || context.disabledCommands.has(command.id) ? { disabledReason: context.disabledCommands.get(command.id) ?? 'Command has no exec' } : {}) })) : [],
      menuItems: context.enabled ? menuItems : [], keySchemes: context.enabled ? compiled.keySchemes.map(scheme => pick(scheme, ['id', 'label'])) : [],
      keyEntries: context.enabled ? keyEntries : [], settings: definitions.map(({ validator: _validator, ...setting }) => setting),
    }) as unknown as GenerationPlugin
    const fingerprint = JSON.stringify(plugin), size = encoder.encode(fingerprint).length
    fits(bytes - (owners.get(owner)?.bytes ?? 0) + size, owners.size + (owners.has(owner) ? 0 : 1))
    return Object.freeze({ owner, plugin, definitions: Object.freeze(definitions), contribution, bytes: size, fingerprint })
  }
  const handles = new WeakSet<GenerationHandle>()
  return {
    stage(owner: string, compiled: CompiledPlugin, context: ActivationContext): GenerationHandle { const handle = stage(owner, compiled, context); handles.add(handle); return handle },
    commit(handle: GenerationHandle): void {
      if (!handles.has(handle)) throw new Error('Foreign generation handle')
      const previous = owners.get(handle.owner)
      if (previous?.fingerprint === handle.fingerprint) return
      // Recheck the aggregate after staging, including when several owners share a batch.
      for (const [owner, other] of owners) if (owner !== handle.owner && other.plugin.locales.some(locale => handle.plugin.locales.some(candidate => Intl.getCanonicalLocales(locale.language)[0] === Intl.getCanonicalLocales(candidate.language)[0]))) throw new Error('Locale owned by another plugin')
      const size = bytes - (previous?.bytes ?? 0) + handle.bytes
      fits(size, owners.size + (previous ? 0 : 1))
      owners.set(handle.owner, handle); bytes = size; changed()
    },
    remove(owner: string): void { const previous = owners.get(owner); if (!previous) return; owners.delete(owner); bytes -= previous.bytes; changed() },
    /** Host composition is projected only at the end of the common publication. */
    resolveKeys(entries: readonly { id: string; keys?: readonly string[] }[]): void {
      if (!batching) throw new Error('Keys require generation publication')
      for (const [owner, handle] of owners) {
        const resolvedKeys = data(entries.filter(entry => entry.id.startsWith(`${owner}:`))) as unknown as NonNullable<GenerationPlugin['resolvedKeys']>
        if (JSON.stringify(handle.plugin.resolvedKeys ?? []) === JSON.stringify(resolvedKeys)) continue
        const plugin = Object.freeze({ ...handle.plugin, resolvedKeys }), size = encoder.encode(JSON.stringify(plugin)).length
        fits(bytes - handle.bytes + size, owners.size)
        bytes += size - handle.bytes
        owners.set(owner, Object.freeze({ ...handle, plugin, bytes: size }))
        if (version === batchVersion) changed()
        else cached = undefined
      }
    },
    snapshot(): GenerationSnapshot { return cached ??= Object.freeze({ version, plugins: Object.freeze([...owners.values()].sort((a, b) => a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0).map(handle => handle.plugin)) }) },
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
    /** Buffer callbacks into the common barrier; roll back data, cache and version on failure. */
    transaction(operation: () => void, enqueue: (listener: () => void) => void = listener => listener()): void {
      if (batching) throw new Error('Nested generation transaction')
      const before = new Map(owners), oldVersion = version, oldBytes = bytes, oldCached = cached
      batching = true; batchVersion = version
      try { operation() } catch (error) { owners = before; version = oldVersion; bytes = oldBytes; cached = oldCached; throw error } finally { batching = false }
      if (version !== oldVersion) enqueue(notify)
    },
  }
}
export type GenerationStore = ReturnType<typeof createGenerationStore>
export type MainMenuRegistry = ReturnType<typeof createMenuRegistry>
