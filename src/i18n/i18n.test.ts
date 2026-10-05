import { ISSUE_CODES } from '@core/validate/issues.ts'
import { describe, expect, it } from 'vitest'
import { en } from './en.ts'
import { languageFor, translator } from './index.ts'
import { ptBR } from './pt-BR.ts'

describe('languages', () => {
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
