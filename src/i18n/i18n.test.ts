import { ISSUE_CODES } from '@core/validate/issues.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { en } from './en.ts'
import { i18nRegistry, languageFor, pluginTranslator, translator } from './index.ts'
import { I18nRegistry } from './registry.ts'
import { ptBR } from './pt-BR.ts'

describe('languages', () => {
  afterEach(() => {
    i18nRegistry.removePlugin('security-test')
    i18nRegistry.select('en')
  })
  it('never throws for unknown keys or unavailable languages', () => {
    expect(translator('fr')('menu.file')).toBe('File')
    for (const key of ['unknown', 'constructor', '__proto__', 'toString']) expect(translator('unknown')(key)).toBe(key)
  })
  it('keeps security text core-only and plugin placeholders literal', () => {
    i18nRegistry.setPlugin('security-test', [{ language: 'fr', label: 'French', load: () => ({ 'menu.file': 'ATTACKER' }) }])
    i18nRegistry.select('fr')
    expect(translator('fr')('menu.file')).toBe('File')
    expect(translator('en')('menu.file')).toBe('File')
    expect(pluginTranslator()('menu.file')).toBe('ATTACKER')
    const r = new I18nRegistry({ en, 'pt-BR': ptBR })
    r.setPlugin('pack', [{ language: 'fr', label: 'French', load: () => ({ 'menu.file': 'Fichier' }) }],
      { title: { en: '<b>\u202e{name}</b>' } })
    r.select('fr')
    expect(pluginTranslator(r)('menu.file')).toBe('Fichier')
    expect(pluginTranslator(r)('pack.title', { name: 'REPLACED' })).toBe('<b>\u202e{name}</b>')
    expect(pluginTranslator(r)('issue.file-missing', { path: '{name}', name: 'REPLACED' })).toContain('{name}')
  })
  it('reads any Portuguese as Brazilian and everything else as English', () => {
    expect(languageFor('pt-BR')).toBe('pt-BR')
    expect(languageFor('pt-PT')).toBe('pt-BR')
    expect(languageFor('pt')).toBe('pt-BR')
    expect(languageFor('en-US')).toBe('en')
    expect(languageFor('de')).toBe('en')
    expect(languageFor(undefined)).toBe('en')
  })
  it('has the same keys in both languages, and no empty text', () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort())
    for (const catalog of [en, ptBR]) for (const text of Object.values(catalog)) expect(text.trim()).not.toBe('')
  })
  it('translates by key, and fills the placeholders', () => {
    expect(translator('en')('menu.file')).toBe('File')
    expect(translator('pt-BR')('menu.file')).toBe('Arquivo')
    expect(translator('en')('issue.file-missing', { path: 'a/b.png' })).toBe('a/b.png is listed in the manifest but is not in the file.')
    expect(translator('pt-BR')('integrity.running', { percent: 42 })).toBe('Verificando cada arquivo… 42%')
    expect(translator('en')('issue.file-missing')).toContain('{path}')
  })
  it('says every reason to refuse a file in plain words, in both languages, never "broken file"', () => {
    for (const code of ISSUE_CODES) {
      const key = `issue.${code}` as keyof typeof en
      expect(en[key], code).toBeTruthy()
      expect(ptBR[key], code).toBeTruthy()
      expect(en[key].toLowerCase()).not.toContain('broken')
    }
  })
})
