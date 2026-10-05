// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getLanguageSetting, reloadLanguageSetting, resolveLanguage, setLanguageSetting } from './language.ts'

beforeEach(() => {
  localStorage.clear()
  reloadLanguageSetting()
})
afterEach(() => void delete window.fb)

describe('the display language', () => {
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
    localStorage.setItem('fb:language', '"klingon"')
    reloadLanguageSetting()
    expect(getLanguageSetting()).toBe('auto')
  })
})
