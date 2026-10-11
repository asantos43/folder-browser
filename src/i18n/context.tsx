import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { i18nRegistry, pluginTranslator, translator, type Language, type Translate } from './index.ts'
import { resolveLanguage } from '@/state/language.ts'

interface I18n {
  language: Language
  t: Translate
}

const Context = createContext<I18n>({ language: 'en', t: translator('en') })

export function I18nProvider({ language = 'auto', children }: { language?: Language; children: ReactNode }) {
  const revision = useSyncExternalStore(i18nRegistry.subscribe, i18nRegistry.version)
  const effective = resolveLanguage(language)
  const value = useMemo(() => {
    i18nRegistry.select(effective)
    return { language: effective, t: pluginTranslator() }
  }, [effective, revision])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export const useI18n = (): I18n => useContext(Context)
