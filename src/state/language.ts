import { systemLanguage, type Language } from '@/i18n/index.ts'
import { createSetting } from './setting.ts'

/** The display language: the system's (the default), or one the user chose in Settings. */
export type LanguageSetting = 'auto' | Language

const isSetting = (v: unknown): v is LanguageSetting => v === 'auto' || v === 'en' || v === 'pt-BR'
const language = createSetting<LanguageSetting>('language', 'auto', isSetting)

export const getLanguageSetting = language.get
export const resolveLanguage = (setting: LanguageSetting): Language => (setting === 'auto' ? systemLanguage() : setting)

export function setLanguageSetting(setting: LanguageSetting): void {
  language.set(setting)
}

/** Reads the setting again from storage (a test that cleared it). */
export function reloadLanguageSetting(): void {
  language.reload()
}

export function useLanguageSetting(): [LanguageSetting, (setting: LanguageSetting) => void] {
  const setting = language.use()
  return [setting, setLanguageSetting]
}
