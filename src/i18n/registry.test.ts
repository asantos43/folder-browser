import { describe, expect, it, vi } from 'vitest'
import { I18nRegistry, type LocaleCatalog } from './registry.ts'

const core = { en: { 'menu.file': 'File', danger: 'Confirm {name}' }, 'pt-BR': { 'menu.file': 'Arquivo' } }
const registry = () => new I18nRegistry(core)
const locale = (translations: Record<string, string>, language = 'fr'): LocaleCatalog => ({ language, label: language, load: () => translations })

describe('owner locale registry', () => {
  it('versions updates, coalesces notifications and isolates observers', async () => {
    const r = registry(), observer = vi.fn(), throwing = vi.fn(() => { throw new Error('observer') })
    r.subscribe(throwing)
    const unsubscribe = r.subscribe(observer)
    r.setPlugin('pack', [locale({ danger: 'First' })])
    r.select('fr')
    r.setPlugin('pack', [locale({ danger: 'Updated' })])
    expect(r.version()).toBe(3)
    expect(observer).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(observer).toHaveBeenCalledTimes(1)
    expect(throwing).toHaveBeenCalledTimes(1)
    expect(r.resolve('danger')).toBe('Updated')
    r.select('fr')
    r.removePlugin('missing')
    expect(() => r.setPlugin('bad', [locale({}, 'en')])).toThrow()
    expect(r.version()).toBe(3)
    unsubscribe()
    r.removePlugin('pack')
    expect(r.version()).toBe(4)
    await Promise.resolve()
    expect(observer).toHaveBeenCalledTimes(1)
  })
  it('loads only the active language and uses stable requested → en → key fallback', () => {
    const r = registry()
    const fr = vi.fn(() => ({ 'menu.file': 'Fichier', unknown: 'ignored' }))
    const de = vi.fn(() => ({ 'menu.file': 'Datei' }))
    r.setPlugin('pack', [{ language: 'fr', label: 'Français', load: fr }, { language: 'de', label: 'Deutsch', load: de }])
    expect(fr).not.toHaveBeenCalled()
    expect(de).not.toHaveBeenCalled()
    r.select('fr')
    expect(fr).toHaveBeenCalledTimes(1)
    expect(de).not.toHaveBeenCalled()
    expect(r.resolve('menu.file')).toBe('Fichier')
    expect(r.resolve('danger')).toBe('Confirm {name}')
    expect(r.resolve('unknown')).toBe('unknown')
    expect(r.resolve('constructor')).toBe('constructor')
    expect(r.listLanguages()).toEqual([{ language: 'fr', label: 'Français' }, { language: 'de', label: 'Deutsch' }])
    expect(r.listAvailableLanguages()).toEqual([{ language: 'en', label: 'English' }, { language: 'pt-BR', label: 'Português (Brasil)' }, { language: 'fr', label: 'Français' }, { language: 'de', label: 'Deutsch' }])
  })

  it('lists built-in languages separately from plugin languages before activation and after removal', () => {
    const r = registry()
    const builtins = [{ language: 'en', label: 'English' }, { language: 'pt-BR', label: 'Português (Brasil)' }]
    expect(r.listLanguages()).toEqual([])
    expect(r.listAvailableLanguages()).toEqual(builtins)
    const load = vi.fn(() => ({}))
    r.setPlugin('pack', [{ language: 'fr', label: 'Français', load }])
    expect(r.listLanguages()).toEqual([{ language: 'fr', label: 'Français' }])
    expect(r.listAvailableLanguages()).toEqual([...builtins, { language: 'fr', label: 'Français' }])
    expect(load).not.toHaveBeenCalled()
    r.removePlugin('pack')
    expect(r.listLanguages()).toEqual([])
    expect(r.listAvailableLanguages()).toEqual(builtins)
  })

  it('keeps unavailable preference, restores it on reinstall, and drops old keys on update', () => {
    const r = registry()
    r.setPlugin('pack', [locale({ 'menu.file': 'Old', danger: 'Old danger' })], { title: { en: 'Old title' } })
    r.select('fr')
    r.removePlugin('pack')
    expect(r.selection).toEqual({ requested: 'fr', effective: 'en', unavailable: true })
    expect(r.resolve('menu.file')).toBe('File')
    expect(r.resolve('pack.title')).toBe('pack.title')
    r.setPlugin('pack', [locale({ 'menu.file': 'New' })])
    expect(r.selection).toEqual({ requested: 'fr', effective: 'fr', unavailable: false })
    expect(r.resolve('menu.file')).toBe('New')
    expect(r.resolve('danger')).toBe('Confirm {name}')
    r.setPlugin('pack', [locale({ danger: 'Latest' })])
    expect(r.resolve('menu.file')).toBe('File')
    expect(r.resolve('danger')).toBe('Latest')
  })

  it('refuses collisions atomically, including core tags and scoped core keys', () => {
    const r = registry()
    r.setPlugin('one', [locale({ 'menu.file': 'First' })])
    expect(() => r.setPlugin('two', [locale({})])).toThrow()
    expect(() => r.setPlugin('one', [locale({}, 'en')])).toThrow()
    expect(() => r.setPlugin('one', [locale({}, 'pt-BR')])).toThrow()
    expect(() => r.setPlugin('one', [locale({}, 'fr'), locale({}, 'fr')])).toThrow()
    expect(() => r.setPlugin('one', [locale({}, 'not_a_tag')])).toThrow()
    expect(() => r.setPlugin('menu', [], { file: { en: 'Override' } })).toThrow()
    r.setPlugin('a', [], { 'b.c': { en: 'First scope' } })
    expect(() => r.setPlugin('a.b', [], { c: { en: 'Wrong scope' } })).toThrow()
    r.select('fr')
    expect(r.resolve('menu.file')).toBe('First')
    expect(r.coreText('menu.file')).toBe('File')
    expect(r.resolve('a.b.c')).toBe('First scope')
  })

  it('isolates owner text from core and other owners; copies inputs', () => {
    const r = registry()
    const texts = { title: { en: 'English', 'pt-BR': 'Português' }, only: { 'pt-BR': 'Só português' } }
    r.setPlugin('one', [], texts)
    r.setPlugin('two', [], { title: { en: 'Other' } })
    texts.title.en = 'Changed outside'
    r.select('pt-BR')
    expect(r.resolve('one.title')).toBe('Português')
    expect(r.resolve('two.title')).toBe('Other')
    expect(r.resolve('menu.file')).toBe('Arquivo')
    expect(r.coreText('one.title')).toBe('one.title')
    r.select('de')
    expect(r.resolve('one.title')).toBe('English')
    expect(r.resolve('one.only')).toBe('one.only')
    expect(r.coreText('constructor')).toBe('constructor')
  })

  it('preserves HTML, bidi and TAB as literal text; enforces UTF-8 bounds', () => {
    const r = registry()
    const literal = '<img src=x onerror=alert(1)>\u202e{name}\t'
    r.setPlugin('pack', [], { title: { en: literal }, boundary: { en: 'é'.repeat(1024) } })
    expect(r.resolve('pack.title')).toBe(literal)
    expect(r.resolve('pack.boundary')).toBe('é'.repeat(1024))
    expect(() => r.setPlugin('pack', [], { title: { en: 'é'.repeat(1025) } })).toThrow()
    expect(r.resolve('pack.title')).toBe(literal)
    for (const control of ['\0', '\n', '\r', '\x7f', '\x85', '\u2028', '\u2029']) {
      expect(() => r.setPlugin('bad', [], { title: { en: control } })).toThrow()
      r.setPlugin('locale', [locale({ danger: control })])
      expect(() => r.select('fr')).toThrow()
      expect(r.selection.requested).toBe('en')
    }
    r.setPlugin('locale', [locale({ danger: 'é'.repeat(1025) })])
    expect(() => r.select('fr')).toThrow()
  })

  it('refuses oversized dictionaries and rolls back an invalid active update', () => {
    const r = registry()
    const big = Object.fromEntries(Array.from({ length: 3001 }, (_, i) => [`key${i}`, 'text']))
    expect(() => r.setPlugin('big', [], Object.fromEntries(Object.keys(big).map(k => [k, { en: 'text' }])))).toThrow()
    r.setPlugin('pack', [locale({ 'menu.file': 'Good' })])
    r.select('fr')
    expect(() => r.setPlugin('pack', [locale(big)])).toThrow()
    expect(r.resolve('menu.file')).toBe('Good')
    r.select('en')
    r.select('fr')
    expect(r.resolve('menu.file')).toBe('Good')
  })

  it('indexes 3000 keys under 10 ms and resolves 100000 queries under 100 ms', () => {
    const en = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`key${i}`, `English ${i}`]))
    const translated = Object.fromEntries(Object.keys(en).map(k => [k, `French ${k}`]))
    const r = new I18nRegistry({ en })
    r.setPlugin('pack', [locale(translated)])
    const times: number[] = [], lookups: number[] = []
    let result = ''
    for (let round = 0; round < 7; round++) {
      let start = performance.now()
      r.select('fr')
      times.push(performance.now() - start)
      start = performance.now()
      for (let i = 0; i < 100000; i++) result = r.resolve('key2999')
      lookups.push(performance.now() - start)
    }
    expect(result).toBe('French key2999')
    const median = (values: number[]) => values.sort((a, b) => a - b)[3]!
    const load = median(times), lookup = median(lookups)
    console.info(`i18n budget: 3000 keys ${load.toFixed(3)} ms; 100000 queries ${lookup.toFixed(3)} ms`)
    expect(load).toBeLessThan(10)
    expect(lookup).toBeLessThan(100)
  })
})
