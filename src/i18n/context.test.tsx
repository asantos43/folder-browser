// @vitest-environment happy-dom
import { useMemo } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider, useI18n } from './context.tsx'
import { i18nRegistry, translator } from './index.ts'
import { getLanguageSetting, reloadLanguageSetting, resolveLanguage, setLanguageSetting, useLanguageSetting } from '@/state/language.ts'

const catalog = (text: string) => [{ language: 'fr', label: 'Français', load: () => ({ 'menu.file': text }) }]
function Reader() {
  const { language, t } = useI18n()
  // Mirrors Settings' search index: invalidation requires a new translator identity.
  const indexed = useMemo(() => t('menu.file'), [t])
  return <output>{language}:{indexed}</output>
}
function App() {
  const [saved] = useLanguageSetting()
  const effective = resolveLanguage(saved)
  document.documentElement.lang = effective
  return <I18nProvider language={effective}><Reader /></I18nProvider>
}
beforeEach(() => { localStorage.clear(); reloadLanguageSetting() })
afterEach(async () => {
  cleanup()
  i18nRegistry.removePlugin('context-test')
  i18nRegistry.select('en')
  document.documentElement.lang = 'en'
  vi.restoreAllMocks()
  await Promise.resolve()
})

it('updates memoized translations in the same commit when the language changes', () => {
  const { rerender } = render(<I18nProvider language="en"><Reader /></I18nProvider>)
  expect(screen.getByRole('status').textContent).toBe('en:File')
  rerender(<I18nProvider language="pt-BR"><Reader /></I18nProvider>)
  expect(screen.getByRole('status').textContent).toBe('pt-BR:Arquivo')
  rerender(<I18nProvider language="en"><Reader /></I18nProvider>)
  expect(screen.getByRole('status').textContent).toBe('en:File')
})

it('invalidates translator and memoized text when the catalog changes with the same tag', async () => {
  i18nRegistry.setPlugin('context-test', catalog('Fichier'))
  render(<I18nProvider language="fr"><Reader /></I18nProvider>)
  await act(async () => {})
  expect(screen.getByRole('status').textContent).toBe('fr:Fichier')
  await act(async () => { i18nRegistry.setPlugin('context-test', catalog('Dossier')) })
  expect(screen.getByRole('status').textContent).toBe('fr:Dossier')
  // The trusted resolver used by main confirmations never reads plugin text.
  expect(translator('fr')('menu.file')).toBe('File')
})

it('propagates absent preferences, fallback, reinstall and html lang without parse or storage IO', async () => {
  setLanguageSetting('fr')
  render(<App />)
  await act(async () => {})
  const parse = vi.spyOn(JSON, 'parse'), read = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem')
  await act(async () => { i18nRegistry.setPlugin('context-test', catalog('Fichier')) })
  expect(screen.getByRole('status').textContent).toBe('fr:Fichier')
  expect(document.documentElement.lang).toBe('fr')
  await act(async () => { i18nRegistry.removePlugin('context-test') })
  expect(screen.getByRole('status').textContent).toBe('en:File')
  expect(document.documentElement.lang).toBe('en')
  expect(getLanguageSetting()).toBe('fr')
  await act(async () => { i18nRegistry.setPlugin('context-test', catalog('Réinstallé')) })
  expect(screen.getByRole('status').textContent).toBe('fr:Réinstallé')
  expect(parse).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
})

it('recalculates auto when a system catalog appears and disappears', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'pt-BR'])
  render(<App />)
  await act(async () => {})
  expect(screen.getByRole('status').textContent).toBe('pt-BR:Arquivo')
  await act(async () => { i18nRegistry.setPlugin('context-test', catalog('Fichier')) })
  expect(screen.getByRole('status').textContent).toBe('fr:Fichier')
  expect(document.documentElement.lang).toBe('fr')
  await act(async () => { i18nRegistry.removePlugin('context-test') })
  expect(screen.getByRole('status').textContent).toBe('pt-BR:Arquivo')
  expect(getLanguageSetting()).toBe('auto')
})
