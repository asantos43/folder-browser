import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { LanguageRegistry, type LanguagePackage } from './registry.ts'
import { languageOf, setPluginLanguageIndex, viewKind } from '../filekind.ts'

// The host's own keys, used to refuse plugin overlap. Kept short: representative built-ins
// from `BY_EXTENSION` and `PLAIN_NAMES` (the full set lives in `core/filekind.ts`).
// Keys are without a leading dot, matching the form `extensionKey(name)` returns.
const BUILTIN = new Set(['html', 'css', 'js', 'json', 'md', 'py', 'rs', 'sh', 'ts', 'tsx', 'yaml', 'makefile', 'dockerfile', 'env'])

function pkg(id: string, languages: LanguagePackage['languages']): LanguagePackage {
  return { pluginId: id, languages }
}

function lang(id: string, languageId: string, extensions: readonly string[] = [], filenames: readonly string[] = []) {
  return { id, label: id, languageId, extensions, filenames }
}

describe('LanguageRegistry: plugin-owned language associations', () => {
  it('answers a key registered by a plugin', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('acme:foo', [lang('foo', 'python', ['.foo'])]))
    expect(r.lookup('foo')).toBe('python')
    expect(r.lookup('FOO')).toBe('python') // case-insensitive
  })

  it('answers whole filenames (no extension) the same way', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('acme:foo', [lang('foo', 'shell', [], ['Procfile'])]))
    expect(r.lookup('procfile')).toBe('shell')
    expect(r.lookup('PROCFILE')).toBe('shell')
  })

  it('returns undefined for keys the registry has not seen', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('acme:foo', [lang('foo', 'python', ['.foo'])]))
    expect(r.lookup('bar')).toBeUndefined()
  })

  it('refuses built-in keys and warns', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('acme:foo', [lang('foo', 'python', ['.py', '.foo'])]))
    expect(r.lookup('py')).toBeUndefined()
    expect(r.lookup('foo')).toBe('python')
    const warnings = r.drainWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ owner: 'acme:foo', code: 'language.builtin', key: 'py' })
  })

  it('rejects invalid keys (empty, ".", "..", with separators)', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('acme:foo', [
      { id: 'a', label: 'a', languageId: 'plain', extensions: ['', '..', '.', '.ok', 'a/b'], filenames: [] },
    ]))
    expect(r.lookup('ok')).toBe('plain')
    const warnings = r.drainWarnings()
    expect(warnings.every(w => w.code === 'language.invalid')).toBe(true)
    expect(warnings.length).toBe(4) // '', '..', '.', 'a/b'
  })

  it('keeps the first language within one package and warns on duplicates in the same language', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('acme:foo', [lang('foo', 'python', ['.foo', '.foo', '.foo', '.bar'])]))
    expect(r.lookup('foo')).toBe('python')
    expect(r.lookup('bar')).toBe('python')
    const warnings = r.drainWarnings()
    expect(warnings).toHaveLength(2)
    expect(warnings.every(w => w.code === 'language.duplicate')).toBe(true)
  })

  it('first language within a package wins on overlapping extensions across languages', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('acme:foo', [
      lang('a', 'python', ['.foo']),
      lang('b', 'shell', ['.foo']),
    ]))
    expect(r.lookup('foo')).toBe('python')
    const warnings = r.drainWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ code: 'language.duplicate', key: 'foo' })
  })

  it('first package wins across packages, the second is warned and not indexed', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('acme:one', [lang('a', 'python', ['.foo'])]))
    r.set(pkg('acme:two', [lang('b', 'shell', ['.foo'])]))
    expect(r.lookup('foo')).toBe('python')
    const warnings = r.drainWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ code: 'language.duplicate', key: 'foo', owner: 'acme:two' })
  })

  it('removing a package drops only its keys', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('a', [lang('x', 'python', ['.a'])]))
    r.set(pkg('b', [lang('y', 'shell', ['.b'])]))
    expect(r.lookup('a')).toBe('python')
    expect(r.lookup('b')).toBe('shell')
    r.remove('a')
    expect(r.lookup('a')).toBeUndefined()
    expect(r.lookup('b')).toBe('shell')
  })

  it('replacing a package drops the previous keys before the new ones are indexed', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('a', [lang('x', 'python', ['.foo', '.bar'])]))
    expect(r.lookup('foo')).toBe('python')
    expect(r.lookup('bar')).toBe('python')
    r.set(pkg('a', [lang('y', 'shell', ['.foo'])]))
    expect(r.lookup('foo')).toBe('shell')
    expect(r.lookup('bar')).toBeUndefined()
  })

  it('removing a missing owner is harmless', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.remove('nobody')
    r.set(pkg('a', [lang('x', 'python', ['.a'])]))
    r.remove('a')
    r.remove('a')
    expect(r.size()).toBe(0)
  })

  it('keeps duplicate filenames inside one language as a warning and the first wins', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('a', [lang('x', 'python', [], ['Procfile', 'Procfile', 'Procfile'])]))
    expect(r.lookup('procfile')).toBe('python')
    expect(r.size()).toBe(1)
    const warnings = r.drainWarnings()
    expect(warnings.filter(w => w.code === 'language.duplicate')).toHaveLength(2)
  })

  it('rejects an entry with no id or languageId', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('a', [
      { id: '', label: 'a', languageId: 'plain', extensions: ['.a'], filenames: [] },
      { id: 'b', label: 'b', languageId: '', extensions: ['.b'], filenames: [] },
    ]))
    expect(r.size()).toBe(0)
    const warnings = r.drainWarnings()
    expect(warnings.every(w => w.code === 'language.invalid')).toBe(true)
  })

  it('debugEntries lists every key with its owner in insertion order', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('a', [lang('x', 'python', ['.a', '.b'])]))
    r.set(pkg('b', [lang('y', 'shell', ['.c'])]))
    expect(r.debugEntries().map(e => `${e.owner}:${e.key}=${e.languageId}`)).toEqual([
      'a:a=python', 'a:b=python', 'b:c=shell',
    ])
  })
})

describe('LanguageRegistry performance budget', () => {
  it('indexes 5,000 plugin associations in under 10 ms (median of 7)', () => {
    const samples: number[] = []
    for (let sample = 0; sample < 7; sample++) {
      const fresh = new LanguageRegistry(BUILTIN)
      const start = performance.now()
      for (let p = 0; p < 50; p++) {
        const chunk = []
        for (let i = 0; i < 100; i++) {
          const id = p * 100 + i
          chunk.push(lang(`lang-${id}`, 'plain', [`.ext${id}`]))
        }
        fresh.set(pkg(`p:${p}`, chunk))
      }
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    expect(samples[3]).toBeLessThan(10)
  })

  it('answers 100,000 lookups in under 100 ms (median of 7)', () => {
    const r = new LanguageRegistry(BUILTIN)
    for (let p = 0; p < 50; p++) {
      const chunk = []
      for (let i = 0; i < 100; i++) chunk.push(lang(`lang-${p * 100 + i}`, 'plain', [`.ext${p * 100 + i}`]))
      r.set(pkg(`p:${p}`, chunk))
    }
    const keys: string[] = []
    for (let i = 0; i < 5_000; i++) keys.push(`ext${i}`)
    const samples: number[] = []
    let totalHits = 0
    for (let sample = 0; sample < 7; sample++) {
      const start = performance.now()
      let hits = 0
      for (let i = 0; i < 100_000; i++) {
        const v = r.lookup(keys[i % keys.length])
        if (v) hits++
      }
      samples.push(performance.now() - start)
      totalHits += hits
    }
    samples.sort((a, b) => a - b)
    expect(totalHits).toBe(7 * 100_000)
    expect(samples[3]).toBeLessThan(100)
  })
})

describe('plugin language index in core/filekind', () => {
  beforeEach(() => setPluginLanguageIndex(null))
  afterEach(() => setPluginLanguageIndex(null))

  it('keeps the default behaviour when no plugin is installed', () => {
    expect(languageOf('application/octet-stream', 'unknown.foo')).toBe('plain')
    expect(languageOf('application/octet-stream', 'tool.py')).toBe('python')
    expect(languageOf('text/markdown', 'README.md')).toBe('markdown')
  })

  it('uses the plugin language when the host has no answer and the file name matches', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('acme:foo', [lang('foo', 'python', ['.foo'])]))
    setPluginLanguageIndex({ get: key => r.lookup(key) })
    expect(languageOf('application/octet-stream', 'tool.foo')).toBe('python')
    // The built-in case is unchanged: a plugin cannot replace a built-in key.
    expect(languageOf('application/octet-stream', 'tool.py')).toBe('python')
  })

  it('does not promote binary, document, ZIP or snapshot types to text via a plugin language', () => {
    const r = new LanguageRegistry(new Set()) // empty: every key the plugin declares is allowed
    r.set(pkg('p', [
      lang('binary', 'plain', ['.png']),
      lang('document', 'plain', ['.docx']),
      lang('zip', 'plain', ['.zip']),
      lang('wsnp', 'plain', ['.wsnp']),
    ]))
    setPluginLanguageIndex({ get: key => r.lookup(key) })
    // viewKind is decided by effectiveType, which the plugin does not change.
    expect(viewKind('application/octet-stream', 'logo.png', 100)).toBe('image')
    expect(viewKind('application/octet-stream', 'a.docx', 100)).toBe('document')
    expect(viewKind('application/octet-stream', 'bundle.zip', 100)).toBe('zip')
    expect(viewKind('application/octet-stream', 'page.wsnp', 100)).toBe('other')
    // The plugin does not change the type either.
    expect(viewKind('application/octet-stream', 'script.unknownext', 100)).toBe('other')
  })

  it('clears the index when set to null', () => {
    const r = new LanguageRegistry(BUILTIN)
    r.set(pkg('p', [lang('foo', 'python', ['.foo'])]))
    setPluginLanguageIndex({ get: key => r.lookup(key) })
    expect(languageOf('application/octet-stream', 'tool.foo')).toBe('python')
    setPluginLanguageIndex(null)
    expect(languageOf('application/octet-stream', 'tool.foo')).toBe('plain')
  })

  it('falls back to plain when the type is decisive even with a plugin installed', () => {
    const r = new LanguageRegistry(new Set())
    r.set(pkg('p', [lang('foo', 'plain', ['.js'])])) // plugin tries to claim .js (built-in)
    setPluginLanguageIndex({ get: key => r.lookup(key) })
    // The plugin's entry for .js is refused (built-in), so the host's answer is unchanged.
    expect(languageOf('text/javascript', 'app.js')).toBe('javascript')
  })
})
