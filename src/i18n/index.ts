import { en, type MessageKey } from './en.ts'
import { ptBR } from './pt-BR.ts'
import { I18nRegistry } from './registry.ts'

export type Language = string
type BuiltinLanguage = 'en' | 'pt-BR'
export type { MessageKey }

const catalogs: Record<BuiltinLanguage, Record<MessageKey, string>> = { en, 'pt-BR': ptBR }
export const i18nRegistry = new I18nRegistry(catalogs)

/** English and Brazilian Portuguese, following the system language: any Portuguese is read as Brazilian. */
export function languageFor(locale: string | undefined): BuiltinLanguage {
  return /^pt\b/i.test(locale ?? '') ? 'pt-BR' : 'en'
}

export const systemLanguage = (): BuiltinLanguage => languageFor(typeof navigator === 'undefined' ? undefined : navigator.language)

export const LANGUAGE_NAMES: Readonly<Record<string, string | undefined>> = { en: 'English', 'pt-BR': 'Português (Brasil)' }

export type Translate = (key: string, params?: Record<string, string | number>) => string

/** Text by key, with `{name}` placeholders filled from `params`. */
export function translator(language: string): Translate {
  return (key, params) => i18nRegistry.coreText(key, language).replace(/\{(\w+)\}/g, (whole, name: string) => (params && Object.hasOwn(params, name) ? String(params[name]) : whole))
}

/** Explicit ordinary UI path; plugin placeholders stay literal. Security uses translator. */
export function pluginTranslator(registry = i18nRegistry): Translate {
  return (key, params) => Object.hasOwn(en, key)
    ? registry.resolve(key).replace(/\{(\w+)\}/g, (whole, name: string) => (params && Object.hasOwn(params, name) ? String(params[name]) : whole))
    : registry.resolve(key)
}
