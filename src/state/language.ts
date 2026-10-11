import { useSyncExternalStore } from 'react'
import { i18nRegistry } from '@/i18n/index.ts'
import { isLanguageSetting } from '@core/settings/builtin.ts'
import { createSetting } from './setting.ts'

/** The display language: the system's (the default), or one the user chose in Settings. */
export type LanguageSetting = string

const language = createSetting<LanguageSetting>('language', 'auto', isLanguageSetting)

export const getLanguageSetting = language.get
/** In-memory lookup only: catalog changes never read or rewrite the saved setting. */
export function resolveLanguage(setting: LanguageSetting, systemTags: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages): string {
  const available = i18nRegistry.listAvailableLanguages().map(locale => locale.language)
  const exact = (tag: string) => available.find(language => language.toLowerCase() === tag.toLowerCase())
  if (setting !== 'auto') {
    const chosen = exact(setting)
    if (chosen) return chosen
  }
  for (const tag of systemTags) {
    const chosen = exact(tag) ?? available.find(language => language.split('-')[0].toLowerCase() === tag.split('-')[0].toLowerCase())
    if (chosen) return chosen
  }
  return 'en'
}

export function setLanguageSetting(setting: LanguageSetting): void {
  language.set(setting)
}

/** Reads the setting again from storage (a test that cleared it). */
export function reloadLanguageSetting(): void {
  language.reload()
}

export function useLanguageSetting(): [LanguageSetting, (setting: LanguageSetting) => void] {
  useSyncExternalStore(i18nRegistry.subscribe, i18nRegistry.version)
  const setting = language.use()
  return [setting, setLanguageSetting]
}
