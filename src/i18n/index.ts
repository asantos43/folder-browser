import { en, type MessageKey } from './en.ts'
import { ptBR } from './pt-BR.ts'

export type Language = 'en' | 'pt-BR'
export type { MessageKey }

const catalogs: Record<Language, Record<MessageKey, string>> = { en, 'pt-BR': ptBR }

/** English and Brazilian Portuguese, following the system language: any Portuguese is read as Brazilian. */
export function languageFor(locale: string | undefined): Language {
  return /^pt\b/i.test(locale ?? '') ? 'pt-BR' : 'en'
}

export const systemLanguage = (): Language => languageFor(typeof navigator === 'undefined' ? undefined : navigator.language)

export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', 'pt-BR': 'Português (Brasil)' }

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/** Text by key, with `{name}` placeholders filled from `params`. */
export function translator(language: Language): Translate {
  return (key, params) => (catalogs[language][key] ?? en[key]).replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
