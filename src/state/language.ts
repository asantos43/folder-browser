import { useSyncExternalStore } from 'react'
import { systemLanguage, type Language } from '@/i18n/index.ts'
import { readStored, writeStored } from '@/lib/storage.ts'

/** The display language: the system's (the default), or one the user chose in Settings. */
export type LanguageSetting = 'auto' | Language

const isSetting = (v: unknown): v is LanguageSetting => v === 'auto' || v === 'en' || v === 'pt-BR'
const listeners = new Set<() => void>()
let current: LanguageSetting = readStored('language', 'auto', isSetting)

export const getLanguageSetting = (): LanguageSetting => current
export const resolveLanguage = (setting: LanguageSetting): Language => (setting === 'auto' ? systemLanguage() : setting)

export function setLanguageSetting(setting: LanguageSetting): void {
  current = setting
  writeStored('language', setting)
  listeners.forEach((l) => l())
}

/** Reads the setting again from storage (a test that cleared it). */
export function reloadLanguageSetting(): void {
  current = readStored('language', 'auto', isSetting)
  listeners.forEach((l) => l())
}

export function useLanguageSetting(): [LanguageSetting, (setting: LanguageSetting) => void] {
  const setting = useSyncExternalStore(
    (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    getLanguageSetting,
  )
  return [setting, setLanguageSetting]
}
