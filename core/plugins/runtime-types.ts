import type { CompiledPlugin, CompiledKeyScheme } from './compile.ts'
import type { PluginTexts } from './manifest.ts'

export type { PluginTexts } from './manifest.ts'
export const PLUGIN_TEXT_KEY_LIMIT = 3000
export const PLUGIN_TEXT_BYTE_LIMIT = 2 * 1024
export const PLUGIN_TEXT_DICTIONARY_LIMIT = 512 * 1024
export const PLUGIN_TEXT_KEY_PATTERN = /^[a-z][a-zA-Z0-9._-]{0,255}$/
// eslint-disable-next-line no-control-regex
export const PLUGIN_TEXT_CONTROLS = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u2028\u2029]/u

/** Resolve within one owner's dictionary, without reading or changing core i18n. */
export function resolvePluginText(texts: PluginTexts | undefined, key: string, language: string, label?: string): string {
  const entry = texts && Object.hasOwn(texts, key) ? texts[key] : undefined
  const selected = language === 'en' || language === 'pt-BR' ? entry?.[language] : undefined
  return selected || entry?.en || entry?.['pt-BR'] || label || key
}

export const CACHE_SCHEMA = 2
export const CATALOG_BYTE_LIMIT = 1024 * 1024
export const PAYLOAD_BYTE_LIMIT = 2 * 1024 * 1024
export const GENERATION_BYTE_LIMIT = 32 * 1024 * 1024

export interface CacheKey {
  readonly schema: number
  readonly appVersion: string
  readonly pluginId: string
  readonly version: string
  readonly manifestSha256: string
}
export type ContributionKind = 'themes' | 'keymaps' | 'languages' | 'locales' | 'openWith' | 'commands' | 'configuration'
export interface CatalogEntry {
  readonly key: CacheKey
  readonly name: string
  /** keymaps counts bindings; keySchemes counts declared schemes. */
  readonly counts: Readonly<Record<ContributionKind | 'keySchemes', number>>
  readonly ids: Readonly<Record<ContributionKind, readonly string[]>>
  readonly keySchemes: readonly CompiledKeyScheme[]
}
export type PayloadReadResult = { hit: true; compiled: CompiledPlugin } | { hit: false; reason: string }
/** Pass the same token to all lazy reads belonging to one activation generation. */
export interface PayloadGeneration { readonly generation: number }
