// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18nRegistry } from '@/i18n/index.ts'
import { getLanguageSetting, reloadLanguageSetting, resolveLanguage, setLanguageSetting } from './language.ts'

beforeEach(() => {
  localStorage.clear()
  reloadLanguageSetting()
})
afterEach(() => { delete window.fb; i18nRegistry.removePlugin('locale-test'); i18nRegistry.select('en'); vi.restoreAllMocks() })

describe('the display language', () => {
  it.each([
    ['en', ['pt-BR'], 'en'],
    ['pt-BR', ['en'], 'pt-BR'],
    ['PT-br', [], 'pt-BR'],
    ['auto', ['pt-BR', 'en'], 'pt-BR'],
    ['auto', ['pt-PT', 'en'], 'pt-BR'],
    ['auto', ['en-US', 'pt-BR'], 'en'],
    ['fr', ['pt-BR'], 'pt-BR'],
    ['auto', [], 'en'],
  ])('resolves built-in languages without plugins: %s / %j', (setting, systemTags, expected) => {
    expect(i18nRegistry.listLanguages()).toEqual([])
    expect(resolveLanguage(setting, systemTags)).toBe(expected)
  })
  it('follows the system until the user chooses, and remembers the choice', () => {
    expect(getLanguageSetting()).toBe('auto')
    setLanguageSetting('pt-BR')
    expect(getLanguageSetting()).toBe('pt-BR')
    expect(localStorage.getItem('fb:language')).toBe('"pt-BR"')
    reloadLanguageSetting()
    expect(getLanguageSetting()).toBe('pt-BR')
  })
  it('resolves auto to the system language and a choice to itself', () => {
    expect(resolveLanguage('en')).toBe('en')
    expect(resolveLanguage('pt-BR')).toBe('pt-BR')
    expect(['en', 'pt-BR']).toContain(resolveLanguage('auto'))
  })
  it('ignores a stored value that is not a language', () => {
    localStorage.setItem('fb:language', '"not_a_tag"')
    reloadLanguageSetting()
    expect(getLanguageSetting()).toBe('auto')
  })
  it('resolves the first available system tag and explicit plugin preference', () => {
    i18nRegistry.setPlugin('locale-test', [{ language: 'fr', label: 'Français', load: () => ({}) }])
    expect(resolveLanguage('auto', ['ja-JP', 'fr-FR', 'pt-BR'])).toBe('fr')
    expect(resolveLanguage('auto', ['pt-PT', 'fr'])).toBe('pt-BR')
    expect(resolveLanguage('auto', ['ja-JP'])).toBe('en')
    expect(resolveLanguage('fr', ['pt-BR'])).toBe('fr')
  })
  it('keeps an unavailable stored tag through restart and restores it when reinstalled', () => {
    localStorage.setItem('fb:language', '"fr"')
    reloadLanguageSetting()
    expect(getLanguageSetting()).toBe('fr')
    expect(resolveLanguage(getLanguageSetting(), ['pt-BR'])).toBe('pt-BR')
    expect(localStorage.getItem('fb:language')).toBe('"fr"')
    i18nRegistry.setPlugin('locale-test', [{ language: 'fr', label: 'Français', load: () => ({}) }])
    expect(resolveLanguage(getLanguageSetting(), ['pt-BR'])).toBe('fr')
    i18nRegistry.removePlugin('locale-test')
    expect(resolveLanguage(getLanguageSetting(), ['pt-BR'])).toBe('pt-BR')
    reloadLanguageSetting()
    expect(getLanguageSetting()).toBe('fr')
    i18nRegistry.setPlugin('locale-test', [{ language: 'fr', label: 'Français', load: () => ({}) }])
    expect(resolveLanguage(getLanguageSetting())).toBe('fr')
  })
  it('changes effective language without parsing, storage or IPC', () => {
    i18nRegistry.setPlugin('locale-test', [{ language: 'fr', label: 'Français', load: () => ({}) }])
    const parse = vi.spyOn(JSON, 'parse'), read = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem')
    const ipc = vi.fn()
    window.fb = { settings: { all: ipc, set: ipc } } as unknown as typeof window.fb
    expect(resolveLanguage('fr', ['pt-BR'])).toBe('fr')
    i18nRegistry.select('fr')
    i18nRegistry.removePlugin('locale-test')
    expect(resolveLanguage('fr', ['pt-BR'])).toBe('pt-BR')
    i18nRegistry.select('pt-BR')
    expect(parse).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(ipc).not.toHaveBeenCalled()
  })
})
