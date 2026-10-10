import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseManifest, type PluginManifest } from './manifest.ts'
import { LANGUAGES } from '../filekind.ts'
import { compilePlugin, declaredTokensFromCss, escapeAttr, themePreview, themeToCss, type CompileIO, type CompiledTheme, type CompiledPlugin } from './compile.ts'

const TOKENS_CSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/theme/tokens.css')

/** The text of `tokens.css`: the disk is read only here, in the test, never by `compilePlugin`. */
function readTokensCss(): string { return readFileSync(TOKENS_CSS, 'utf8') }

/** The variables of `tokens.css` found by a parser of the test's own (line by line), independent of `declaredTokensFromCss`. */
function tokensByLines(css: string): Set<string> {
  const names = new Set<string>()
  let inComment = false
  for (const line of css.split('\n')) {
    if (inComment) { if (line.includes('*/')) inComment = false; continue }
    if (line.trimStart().startsWith('/*')) { if (!line.includes('*/')) inComment = true; continue }
    const match = /^\s*--([\w-]+)\s*:/.exec(line)
    if (match) names.add(match[1])
  }
  return names
}

/** Read every variable declared in `tokens.css` (feeds `CompileIO.declaredTokens`, as the host will). */
function loadDeclaredTokens(): ReadonlySet<string> { return declaredTokensFromCss(readTokensCss()) }

/** Read every top-level i18n key declared in `src/i18n/en.ts`. */
function loadLocaleKeys(): Set<string> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const text = readFileSync(path.resolve(here, '../../src/i18n/en.ts'), 'utf8')
  const names = new Set<string>()
  for (const match of text.matchAll(/^\s*'([^']+)'\s*:/gm)) names.add(match[1])
  return names
}

const declaredTokens = loadDeclaredTokens()
const localeKeys = loadLocaleKeys()

/** A minimal-valid manifest that the parser accepts, with a per-test mutate callback for overrides. */
function build(mutate: (raw: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    schema: 1,
    id: 'acme.sample', name: 'Sample', version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', key: `ed25519:${'ab'.repeat(32)}` },
    engines: { folderBrowser: '>=0.1.0 <1.0.0', api: 1 },
    uses: [],
    contributes: {},
    activation: ['onStartupFinished'],
    files: {},
  }
  mutate(raw)
  return raw
}

function accept(raw: unknown): PluginManifest {
  const result = parseManifest(raw)
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2))
  return result.manifest
}

function io(files: Record<string, Uint8Array>, extra: Partial<CompileIO> = {}): CompileIO {
  return {
    readFile: async path => files[path] === undefined ? Promise.reject(new Error(`Missing ${path}`)) : files[path],
    knownCommands: new Set<string>(),
    knownLanguages: new Set<string>(LANGUAGES),
    builtinExtensions: new Set(['.json', '.ts', '.tsx', '.md', '.html', '.css', '.js']),
    declaredTokens,
    knownLocaleKeys: localeKeys,
    ...extra,
  }
}

interface Options { files?: Record<string, Uint8Array>; commands?: string[]; extra?: Partial<CompileIO> }

async function compileOk(raw: unknown, options: Options = {}): Promise<CompiledPlugin> {
  const manifest = accept(raw)
  const files: Record<string, Uint8Array> = { ...(options.files ?? {}) }
  const io_ = io(files, { knownCommands: new Set(options.commands ?? []), ...options.extra })
  const result = await compilePlugin(manifest, io_)
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2))
  return result.compiled
}

async function compileBad(raw: unknown, options: Options = {}): Promise<{ ok: false; errors: { path: string; code: string; message: string }[] }> {
  const manifest = accept(raw)
  const files: Record<string, Uint8Array> = { ...(options.files ?? {}) }
  const io_ = io(files, { knownCommands: new Set(options.commands ?? []), ...options.extra })
  const result = await compilePlugin(manifest, io_)
  if (result.ok) throw new Error('Expected compile to fail but it succeeded')
  return result
}

const SAMPLE_FILES = {
  'themes/dark.json': () => Buffer.from(JSON.stringify({ 'vscode-foreground': '#ff00ff', 'vscode-editor-background': '#000000' })),
  'themes/light.json': () => Buffer.from(JSON.stringify({ 'vscode-foreground': '#101010', 'vscode-editor-background': '#ffffff' })),
  'keymaps/default.json': () => Buffer.from(JSON.stringify([{ command: 'acme.sample:hello', key: 'Ctrl+Alt+Y' }])),
  'locales/fr.json': () => Buffer.from(JSON.stringify({ 'menu.copy': 'Copier' })),
  'locales/es.json': () => Buffer.from(JSON.stringify({ 'menu.copy': 'Copiar' })),
}

function allTokensFile(): Buffer {
  // A theme whose keys are exactly the declared tokens (the real worst case: 97 today).
  const tokens: Record<string, string> = {}
  for (const name of declaredTokens) tokens[name] = '#abcdef'
  return Buffer.from(JSON.stringify(tokens))
}

describe('compilePlugin (pure TypeScript, no startup imports)', () => {
  it('produces a frozen, serialisable result with namespaced ids and stable codes', async () => {
    const raw = build((r) => {
      r.contributes = {
        themes: [{ id: 'sample-dark', label: 'theme.dark', base: 'dark', tokens: 'themes/dark.json' }],
        keymaps: [{ id: 'sample-keys', label: 'Keys', keys: 'keymaps/default.json' }],
        languages: [{ id: 'sample-language', label: 'Sample language', extensions: ['.sol'], filenames: ['Samplefile'], languageId: 'javascript' }],
        openWith: [{ id: 'sample-open', label: 'Open Sample', program: 'sample-tool', args: ['--file', '{file}'], extensions: ['.sol'] }],
        commands: [{ id: 'acme.sample:hello', title: 'command.hello', category: 'tools', keys: ['Mod+Alt+J'], when: 'enabled', palette: true,
          menu: { menu: 'menubar/tools', group: 'tools', order: 1 }, exec: { program: 'sample-tool', args: ['{file}', '{setting:enabled}'] } }],
        locales: [{ language: 'fr', label: 'Français', file: 'locales/fr.json' }],
        configuration: { title: 'Sample', properties: { enabled: { type: 'boolean', default: true, label: 'setting.enabled' } } },
      }
      r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}`, 'keymaps/default.json': `sha256:${'12'.repeat(32)}`, 'locales/fr.json': `sha256:${'12'.repeat(32)}` }
    })
    const compiled = await compileOk(raw, { files: {
      'themes/dark.json': SAMPLE_FILES['themes/dark.json'](),
      'keymaps/default.json': SAMPLE_FILES['keymaps/default.json'](),
      'locales/fr.json': SAMPLE_FILES['locales/fr.json'](),
    } })
    expect(compiled.pluginId).toBe('acme.sample')
    expect(compiled.themes[0].id).toBe('acme.sample:sample-dark')
    expect(compiled.themes[0].tokens['vscode-foreground']).toBe('#ff00ff')
    expect(compiled.languages[0].id).toBe('acme.sample:sample-language')
    expect(compiled.locales[0].translations['menu.copy']).toBe('Copier')
    // commands with `palette`, `exec` and full original fields preserved
    expect(compiled.commands).toHaveLength(1)
    expect(compiled.commands[0].id).toBe('acme.sample:hello')
    expect(compiled.commands[0].palette).toBe(true)
    expect(compiled.commands[0].defaultKeys).toEqual(['Mod+Alt+J'])
    expect(compiled.commands[0].exec?.program).toBe('sample-tool')
    expect(compiled.commands[0].exec?.args).toEqual([{ kind: 'file' }, { kind: 'setting', key: 'enabled' }])
    // keymap entries carry the keymap id as source
    expect(compiled.keymaps[0]).toEqual({ command: 'acme.sample:hello', key: 'Ctrl+Alt+Y', source: { keymapId: 'sample-keys', keymapLabel: 'Keys' } })
    expect(compiled.contribution.keymapKeys[0].source.keymapId).toBe('sample-keys')
    // openWith keeps the leading dot, its args become typed markers
    expect(compiled.openWith[0].extensions).toEqual(['.sol'])
    expect(compiled.openWith[0].args).toEqual([{ kind: 'text', value: '--file' }, { kind: 'file' }])
    // deep freeze
    expect(Object.isFrozen(compiled)).toBe(true)
    expect(Object.isFrozen(compiled.themes[0])).toBe(true)
    expect(Object.isFrozen(compiled.commands[0])).toBe(true)
    expect(Object.isFrozen(compiled.commands[0].exec!.args)).toBe(true)
    // structuredClone survives
    structuredClone(compiled)
    JSON.parse(JSON.stringify(compiled))
  })

  it('refuses an unknown theme token with the actual token name in the error path', async () => {
    const raw = build((r) => {
      r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
      r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
    })
    const result = await compileBad(raw, { files: {
      'themes/dark.json': Buffer.from(JSON.stringify({ 'not-a-real-token': '#fff' })),
    } })
    expect(result.errors[0].code).toBe('compile.theme.token.unknown')
    expect(result.errors[0].path).toContain('not-a-real-token')
  })

  it('refuses a theme value with url(, ;, {, var(, @import or a control character', async () => {
    const cases = ['url(/etc/passwd)', '#fff; display:none', 'red { color: blue }', 'var(--evil)', '#fff /*', '@import "x"', 'expression(x)', '#fff\0', '#fff\x1b', '#fff\x7f', '#fff\u0085']
    for (const value of cases) {
      const raw = build((r) => {
        r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
        r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
      })
      const result = await compileBad(raw, { files: {
        'themes/dark.json': Buffer.from(JSON.stringify({ 'vscode-foreground': value })),
      } })
      expect(result.errors.some(error => error.code === 'compile.theme.value.invalid')).toBe(true)
    }
  })

  it('refuses a theme file > 64 KB without parsing it (spy: zero JSON.parse calls)', async () => {
    const parse = JSON.parse
    let parses = 0
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => { parses++; return parse(...args) }) as typeof JSON.parse
    try {
      const huge = Buffer.alloc(64 * 1024 + 1, 0x20)
      const raw = build((r) => {
        r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
        r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
      })
      const result = await compileBad(raw, { files: { 'themes/dark.json': huge } })
      expect(result.errors[0].code).toBe('compile.theme.tokens.limit')
      expect(parses).toBe(0)
    } finally {
      JSON.parse = parse
    }
  })

  it('a theme file of exactly 64 KB parses (size limit excludes the boundary)', async () => {
    const css = JSON.stringify({ 'vscode-foreground': '#fff' })
    const atBoundary = Buffer.concat([Buffer.from(css), Buffer.alloc(64 * 1024 - Buffer.byteLength(css), 0x20)])
    expect(atBoundary.byteLength).toBe(64 * 1024)
    const raw = build((r) => {
      r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
      r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
    })
    const compiled = await compileOk(raw, { files: { 'themes/dark.json': atBoundary } })
    expect(compiled.themes[0].tokens['vscode-foreground']).toBe('#fff')
  })

  it('refuses more than 400 tokens (401 distinct token names)', async () => {
    const tokens: Record<string, string> = {}
    for (let i = 0; i < 401; i++) tokens[`fake-token-${i}`] = '#abcdef'
    const raw = build((r) => {
      r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
      r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
    })
    const result = await compileBad(raw, { files: { 'themes/dark.json': Buffer.from(JSON.stringify(tokens)) } })
    expect(result.errors[0].code).toBe('compile.theme.tokens.limit')
  })

  it('refuses a reserved chord on either platform and a key for an unknown command', async () => {
    const raw = build((r) => {
      r.contributes = {
        commands: [{ id: 'acme.sample:hello', title: 'Hello', category: 'tools' }],
        keymaps: [{ id: 'default', label: 'Default', keys: 'keymaps/default.json' }],
      }
      r.files = { 'keymaps/default.json': `sha256:${'12'.repeat(32)}` }
    })
    const result = await compileBad(raw, { files: {
      'keymaps/default.json': Buffer.from(JSON.stringify([{ command: 'acme.sample:hello', key: 'Ctrl+S' }])),
    }, commands: ['acme.sample:hello'] })
    expect(result.errors[0].code).toBe('compile.keymap.reserved')

    const result2 = await compileBad(raw, { files: {
      'keymaps/default.json': Buffer.from(JSON.stringify([{ command: 'other.unknown:cmd', key: 'Ctrl+Alt+Y' }])),
    } })
    expect(result2.errors[0].code).toBe('compile.keymap.command.unknown')
  })

  it('refuses a keymap with more than 500 entries and conflicting chord ownership', async () => {
    const big = Array.from({ length: 501 }, (_, i) => ({ command: `acme.sample:c${i}`, key: `Ctrl+Alt+Shift+${i}` }))
    const bigRaw = build((r) => {
      r.contributes = { keymaps: [{ id: 'default', label: 'Default', keys: 'keymaps/big.json' }] }
      r.files = { 'keymaps/big.json': `sha256:${'12'.repeat(32)}` }
    })
    const result = await compileBad(bigRaw, { files: {
      'keymaps/big.json': Buffer.from(JSON.stringify(big)),
    } })
    expect(result.errors[0].code).toBe('compile.keymap.keys.limit')

    const conflictRaw = build((r) => {
      r.contributes = {
        commands: [{ id: 'acme.sample:hello', title: 'H', category: 'tools' }, { id: 'acme.sample:hello-2', title: 'H2', category: 'tools' }],
        keymaps: [{ id: 'default', label: 'Default', keys: 'keymaps/conflict.json' }],
      }
      r.files = { 'keymaps/conflict.json': `sha256:${'12'.repeat(32)}` }
    })
    const result2 = await compileBad(conflictRaw, { files: {
      'keymaps/conflict.json': Buffer.from(JSON.stringify([
        { command: 'acme.sample:hello', key: 'Ctrl+Alt+Y' },
        { command: 'acme.sample:hello-2', key: 'Ctrl+Alt+Y' },
      ])),
    } })
    expect(result2.errors[0].code).toBe('compile.keymap.conflict')
  })

  it('refuses a language not in the editor, an extension already in use, and a duplicate extension as a warning', async () => {
    const raw1 = build((r) => {
      r.contributes = { languages: [{ id: 'sample', label: 'S', extensions: ['.sol'], languageId: 'made-up' }] }
    })
    const r1 = await compileBad(raw1)
    expect(r1.errors[0].code).toBe('compile.language.unknown')

    const raw2 = build((r) => {
      r.contributes = { languages: [{ id: 'sample', label: 'S', extensions: ['.json'], languageId: 'plain' }] }
    })
    const r2 = await compileBad(raw2)
    expect(r2.errors[0].code).toBe('compile.language.builtin-conflict')

    // A duplicate extension in the same language is a warning (the first wins; the rest remain in the list with a warning).
    const raw3 = build((r) => {
      r.contributes = { languages: [{ id: 'sample', label: 'S', extensions: ['.sol', '.sol', '.sol'], languageId: 'javascript' }] }
    })
    const r3 = await compilePlugin(accept(raw3), io({}))
    expect(r3.ok).toBe(true)
    if (!r3.ok) return
    expect(r3.compiled.languages[0].extensions).toEqual(['.sol', '.sol', '.sol'])
    const warning3 = r3.compiled.warnings.find(w => w.code === 'compile.language.duplicate')
    expect(warning3?.path).toContain('extensions')

    // A duplicate extension across two languages is also a warning (the first language wins at runtime).
    const raw4 = build((r) => {
      r.contributes = { languages: [{ id: 'one', label: 'L', extensions: ['.sol'], languageId: 'javascript' }, { id: 'two', label: 'L', extensions: ['.sol'], languageId: 'plain' }] }
    })
    const r4 = await compilePlugin(accept(raw4), io({}))
    expect(r4.ok).toBe(true)
    if (!r4.ok) return
    const warning4 = r4.compiled.warnings.find(w => w.code === 'compile.language.duplicate')
    expect(warning4?.path).toContain('two')
  })

  it('Open With keeps the leading dot and warns on duplicated extensions in the same entry', async () => {
    const raw = build((r) => {
      r.contributes = { openWith: [{ id: 'open', label: 'Open', program: 'sample-tool', args: [], extensions: ['.sol', '.sol', '.sol'] }] }
    })
    const r = await compilePlugin(accept(raw), io({}))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Open With duplicates stay in the output; the warning tells the author the first wins at runtime.
    expect(r.compiled.openWith[0].extensions).toEqual(['.sol', '.sol', '.sol'])
    const warning = r.compiled.warnings.find(w => w.code === 'compile.openWith.duplicate')
    expect(warning).toBeDefined()
  })

  it('ignores an unknown locale key as a warning and keeps the file otherwise', async () => {
    const raw = build((r) => {
      r.contributes = { locales: [{ language: 'fr', label: 'Français', file: 'locales/fr.json' }] }
      r.files = { 'locales/fr.json': `sha256:${'12'.repeat(32)}` }
    })
    const result = await compileOk(raw, { files: {
      'locales/fr.json': Buffer.from(JSON.stringify({ 'menu.copy': 'Copier', 'totally.unknown.key': 'xxx' })),
    } })
    expect(result.locales[0].translations['menu.copy']).toBe('Copier')
    expect(Object.hasOwn(result.locales[0].translations, 'totally.unknown.key')).toBe(false)
    expect(result.warnings.find(w => w.code === 'compile.locale.key.unknown')?.path).toContain('totally.unknown.key')
  })

  it('refuses locale text over 2 KB of UTF-8 bytes (1025 accented chars count bytes, not chars)', async () => {
    const raw = build((r) => {
      r.contributes = { locales: [{ language: 'fr', label: 'Français', file: 'locales/fr.json' }] }
      r.files = { 'locales/fr.json': `sha256:${'12'.repeat(32)}` }
    })
    // 1025 'é' = 2050 UTF-8 bytes (>2 KB): rejected, not accepted by character count.
    const r1 = await compileBad(raw, { files: {
      'locales/fr.json': Buffer.from(JSON.stringify({ 'menu.copy': 'é'.repeat(1025) })),
    } })
    expect(r1.errors[0].code).toBe('compile.locale.text.limit')

    // 1024 'é' = 2048 UTF-8 bytes (within limit): accepted.
    const r2 = await compileOk(raw, { files: {
      'locales/fr.json': Buffer.from(JSON.stringify({ 'menu.copy': 'é'.repeat(1024) })),
    } })
    expect(r2.locales[0].translations['menu.copy'].length).toBe(1024)

    // 2049 ASCII chars = 2049 bytes (just above the limit): rejected.
    const r3 = await compileBad(raw, { files: {
      'locales/fr.json': Buffer.from(JSON.stringify({ 'menu.copy': 'a'.repeat(2049) })),
    } })
    expect(r3.errors[0].code).toBe('compile.locale.text.limit')
  })

  it('refuses every control in a locale text except TAB: C0, LF, CR, DEL, C1, U+2028 and U+2029', async () => {
    const cases = ['\x00', '\x01', '\x1b', '\x7f', '\x85', '\x9f', '\n', '\r', '\u2028', '\u2029']
    const raw = build((r) => {
      r.contributes = { locales: [{ language: 'fr', label: 'Français', file: 'locales/fr.json' }] }
      r.files = { 'locales/fr.json': `sha256:${'12'.repeat(32)}` }
    })
    for (const control of cases) {
      const file = JSON.stringify({ 'menu.copy': 'x' + control }) // control character is a real character
      const result = await compileBad(raw, { files: {
        'locales/fr.json': Buffer.from(file, 'utf8'),
      } })
      expect(result.errors[0].code).toBe('compile.locale.text.control')
    }
    // TAB is the one control that passes.
    const ok = await compileOk(raw, { files: { 'locales/fr.json': Buffer.from(JSON.stringify({ 'menu.copy': 'a\tb' })) } })
    expect(ok.locales[0].translations['menu.copy']).toBe('a\tb')
  })

  it('accepts HTML-shaped text as plain text (a locale is data, never interpreted)', async () => {
    const raw = build((r) => {
      r.contributes = { locales: [{ language: 'fr', label: 'Français', file: 'locales/fr.json' }] }
      r.files = { 'locales/fr.json': `sha256:${'12'.repeat(32)}` }
    })
    const result = await compileOk(raw, { files: {
      'locales/fr.json': Buffer.from(JSON.stringify({ 'menu.copy': '<script>alert(1)</script>' })),
    } })
    expect(result.locales[0].translations['menu.copy']).toBe('<script>alert(1)</script>')
  })

  it('refuses a locale with a built-in language and a locale file over 512 KB', async () => {
    const raw1 = build((r) => {
      r.contributes = { locales: [{ language: 'en', label: 'English', file: 'locales/en.json' }] }
      r.files = { 'locales/en.json': `sha256:${'12'.repeat(32)}` }
    })
    const r1 = await compileBad(raw1, { files: { 'locales/en.json': Buffer.from('{}') } })
    expect(r1.errors[0].code).toBe('compile.locale.builtin-conflict')

    const raw2 = build((r) => {
      r.contributes = { locales: [{ language: 'fr', label: 'Français', file: 'locales/fr.json' }] }
      r.files = { 'locales/fr.json': `sha256:${'12'.repeat(32)}` }
    })
    const huge = Buffer.alloc(513 * 1024, 0x20)
    const r2 = await compileBad(raw2, { files: { 'locales/fr.json': huge } })
    expect(r2.errors[0].code).toBe('compile.locale.file.limit')
  })

  it('refuses a file referenced by the manifest but not declared in `files`', async () => {
    const raw = build((r) => {
      r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
      r.files = {}
    })
    const result = await compileBad(raw, { files: {} })
    expect(result.errors[0].code).toBe('compile.file.undeclared')
  })

  it('refuses an Open With `{setting:x}` placeholder when x is not declared', async () => {
    const raw = build((r) => {
      r.contributes = { openWith: [{ id: 'open', label: 'Open', program: 'sample-tool', args: ['{setting:contrast}'], extensions: ['.sol'] }], configuration: { title: 'Sample', properties: { enabled: { type: 'boolean', default: true, label: 'setting.enabled' } } }, }
    })
    const result = await compileBad(raw)
    expect(result.errors[0].code).toBe('compile.exec.setting.unknown')
  })

  it('refuses a command exec.args `{setting:x}` placeholder when x is not declared', async () => {
    const raw = build((r) => {
      r.contributes = { commands: [{ id: 'acme.sample:cmd', title: 'C', category: 'tools', exec: { program: 'sample-tool', args: ['{setting:contrast}'] } }], configuration: { title: 'Sample', properties: { enabled: { type: 'boolean', default: true, label: 'setting.enabled' } } }, }
    })
    const result = await compileBad(raw)
    expect(result.errors[0].code).toBe('compile.exec.setting.unknown')
  })

  it('keeps the Open With args typed (text, file, dir, name, setting) and never concatenates', async () => {
    const raw = build((r) => {
      r.contributes = {
        openWith: [{ id: 'open', label: 'Open', program: 'sample-tool',
          args: ['--literal', '{file}', '{dir}', '{name}', '{setting:enabled}'],
          extensions: ['.sol'] }],
        configuration: { title: 'Sample', properties: { enabled: { type: 'boolean', default: true, label: 'setting.enabled' } } },
      }
    })
    const result = await compileOk(raw)
    expect(result.openWith[0].args).toEqual([
      { kind: 'text', value: '--literal' },
      { kind: 'file' },
      { kind: 'dir' },
      { kind: 'name' },
      { kind: 'setting', key: 'enabled' },
    ])
  })

  it('is all-or-nothing: a single bad file refuses the whole plugin', async () => {
    const raw = build((r) => {
      r.contributes = {
        commands: [{ id: 'acme.sample:hello', title: 'Hello', category: 'tools' }],
        keymaps: [{ id: 'default', label: 'Default', keys: 'keymaps/default.json' }],
        themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }],
      }
      r.files = { 'keymaps/default.json': `sha256:${'12'.repeat(32)}`, 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
    })
    const result = await compileBad(raw, { files: {
      'themes/dark.json': Buffer.from('{}'),
      'keymaps/default.json': Buffer.from(JSON.stringify([{ command: 'acme.sample:unknown', key: 'Ctrl+Alt+Y' }])),
    } })
    expect(result.errors[0].code).toBe('compile.keymap.command.unknown')
  })

  it('survives an untrusted JSON with __proto__ at the top of a tokens file', async () => {
    const raw = build((r) => {
      r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
      r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
    })
    const evil = '{"vscode-foreground":"#fff","__proto__":{"polluted":true}}'
    await compileBad(raw, { files: { 'themes/dark.json': Buffer.from(evil) } })
    expect(({} as unknown as { polluted?: unknown }).polluted).toBeUndefined()
  })

  it('escapeAttr covers every control byte (LF/CR/FF/quote/backslash/nul) with a backslash + HEX + space format', () => {
    const id = 'x"\u005c\u000a\u000d\u000c\u0001\u007f\u0085 end'
    const escaped = escapeAttr(id)
    // A direct regex would match the backslashes that start the escape sequences themselves.
    // Peel the escape tokens first: every escape is `\` + 2 hex digits + a single space.
    const peeled = escaped.replace(/\\[0-9a-fA-F]{2} /g, '')
    // Whatever remains must be only printable ASCII (no controls, no `"`, no `\`).
    // eslint-disable-next-line no-control-regex
    expect(peeled).not.toMatch(/[\x00-\x1f\x7f-\x9f"\\]/)
    expect(peeled).toBe('x end') // the x, the spaces that came from escape terminators after the trailing chars, and the literal 'end' word
    expect(escaped).toContain('\\22 ')
    expect(escaped).toContain('\\0a ')
    expect(escaped).toContain('\\0d ')
    expect(escaped).toContain('\\0c ')
    expect(escaped).toContain('\\7f ')
    expect(escaped).toContain('\\85 ')
  })

  it('emits a CSS rule that does not let the selector id leak (no LF/CR/FF in the attribute value)', () => {
    const theme: CompiledTheme = { id: 'acme.weird:id\nbody{color:red}', label: 'Weird', base: 'dark', tokens: { 'vscode-foreground': '#fff' } }
    const css = themeToCss(theme)
    // The attribute value before `[data-theme-base` must not contain raw LF/CR/FF.
    const before = css.split('[data-theme-base')[0]
    // eslint-disable-next-line no-control-regex
    expect(before).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    const preview = themePreview(theme)
    // eslint-disable-next-line no-control-regex
    expect(preview.split('[data-theme-base')[0]).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
  })

  describe('the tokens a theme may set are exactly the variables of tokens.css', () => {
    const themeManifest = accept(build((r) => {
      r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
      r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
    }))
    /** The names, among the candidates, that the compiler lets a theme set when the host allows `allowed`. */
    async function acceptedTokens(allowed: ReadonlySet<string>, candidates: Iterable<string>): Promise<string[]> {
      const accepted: string[] = []
      for (const name of candidates) {
        const files = { 'themes/dark.json': Buffer.from(JSON.stringify({ [name]: '#abcdef' })) }
        const result = await compilePlugin(themeManifest, io(files, { declaredTokens: allowed }))
        if (result.ok) accepted.push(name)
      }
      return accepted.sort()
    }
    const fromCss = tokensByLines(readTokensCss())
    const expected = [...fromCss].sort()
    const decoys = ['not-a-token', 'vscode-not-declared', 'zzz']

    it('the parser used by the host finds the same variables as a line-by-line reading of the file', () => {
      expect(fromCss.size).toBeGreaterThan(0)
      expect([...declaredTokensFromCss(readTokensCss())].sort()).toEqual(expected)
    })

    it('ignores a variable that only appears inside a comment or as a reference', () => {
      const css = ':root {\n  /* --in-comment: 1; */\n  --real: #fff;\n  color: var(--used-only);\n}'
      expect([...declaredTokensFromCss(css)]).toEqual(['real'])
    })

    it('accepts every variable of tokens.css and nothing else', async () => {
      expect(await acceptedTokens(declaredTokens, [...fromCss, ...decoys])).toEqual(expected)
    })

    it('fails when a token is removed from, or added to, tokens.css (a temporary copy, the real file is not touched)', async () => {
      const css = readTokensCss()
      const first = expected[0]
      const folder = mkdtempSync(path.join(tmpdir(), 'fb-tokens-'))
      try {
        const removed = path.join(folder, 'removed.css')
        writeFileSync(removed, css.replace(new RegExp(`^\\s*--${first}\\s*:.*$`, 'gm'), ''))
        const added = path.join(folder, 'added.css')
        writeFileSync(added, css.replace(':root,', ':root {\n  --vscode-added-for-test: #123456;\n}\n:root,'))
        const withoutFirst = declaredTokensFromCss(readFileSync(removed, 'utf8'))
        const withExtra = declaredTokensFromCss(readFileSync(added, 'utf8'))
        expect(withoutFirst.size).toBe(fromCss.size - 1)
        expect(withExtra.has('vscode-added-for-test')).toBe(true)
        expect(await acceptedTokens(withoutFirst, [...fromCss, ...decoys])).not.toEqual(expected)
        expect(await acceptedTokens(withExtra, [...fromCss, 'vscode-added-for-test'])).not.toEqual(expected)
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    })

    it('fails when the compiler side drifts: one token missing or one extra allowed', async () => {
      expect(await acceptedTokens(new Set([...declaredTokens].slice(1)), [...fromCss])).not.toEqual(expected)
      expect(await acceptedTokens(new Set([...declaredTokens, 'extra-token']), [...fromCss, 'extra-token'])).not.toEqual(expected)
    })
  })

  describe('the limit of 400 tokens', () => {
    const names = (count: number): string[] => Array.from({ length: count }, (_, i) => `vscode-limit-${i}`)
    const file = (list: string[]): Buffer => Buffer.from(JSON.stringify(Object.fromEntries(list.map(name => [name, '#abcdef']))))
    const raw = () => build((r) => {
      r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
      r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
    })

    it('accepts 400 tokens (all of them declared by the host)', async () => {
      const list = names(400)
      const compiled = await compileOk(raw(), { files: { 'themes/dark.json': file(list) }, extra: { declaredTokens: new Set(list) } })
      expect(Object.keys(compiled.themes[0].tokens)).toHaveLength(400)
    })

    it('refuses 401 tokens even when the host declares all of them', async () => {
      const list = names(401)
      const result = await compileBad(raw(), { files: { 'themes/dark.json': file(list) }, extra: { declaredTokens: new Set(list) } })
      expect(result.errors[0].code).toBe('compile.theme.tokens.limit')
    })
  })

  it('accepts a setting declared with the plugin prefix and used without it, and the other way round', async () => {
    const prefixed = build((r) => {
      r.contributes = {
        openWith: [{ id: 'open', label: 'Open', program: 'sample-tool', args: ['{setting:enabled}'], extensions: ['.sol'] }],
        commands: [{ id: 'acme.sample:cmd', title: 'C', category: 'tools', exec: { program: 'sample-tool', args: ['{setting:enabled}'] } }],
        configuration: { title: 'Sample', properties: { 'acme.sample:enabled': { type: 'boolean', default: true, label: 'setting.enabled' } } },
      }
    })
    const a = await compileOk(prefixed)
    expect(a.openWith[0].args).toEqual([{ kind: 'setting', key: 'enabled' }])
    expect(a.commands[0].exec?.args).toEqual([{ kind: 'setting', key: 'enabled' }])

    const short = build((r) => {
      r.contributes = {
        openWith: [{ id: 'open', label: 'Open', program: 'sample-tool', args: ['{setting:acme.sample:enabled}'], extensions: ['.sol'] }],
        configuration: { title: 'Sample', properties: { enabled: { type: 'boolean', default: true, label: 'setting.enabled' } } },
      }
    })
    const b = await compileOk(short)
    expect(b.openWith[0].args).toEqual([{ kind: 'setting', key: 'enabled' }])
  })

  it('still refuses a setting of ANOTHER plugin, and a prefixed reference to a key that does not exist', async () => {
    for (const reference of ['{setting:other.plugin:enabled}', '{setting:acme.sample:missing}']) {
      const raw = build((r) => {
        r.contributes = {
          openWith: [{ id: 'open', label: 'Open', program: 'sample-tool', args: [reference], extensions: ['.sol'] }],
          configuration: { title: 'Sample', properties: { enabled: { type: 'boolean', default: true, label: 'setting.enabled' } } },
        }
      })
      const result = await compileBad(raw)
      expect(result.errors[0].code).toBe('compile.exec.setting.unknown')
    }
  })

  it('warns when a setting reference is embedded in text or written in capitals, and keeps it as literal text', async () => {
    const raw = build((r) => {
      r.contributes = {
        openWith: [{ id: 'open', label: 'Open', program: 'sample-tool', args: ['--o={setting:enabled}', '{SETTING:enabled}', '{setting:}', 'plain', '{setting:enabled}'], extensions: ['.sol'] }],
        commands: [{ id: 'acme.sample:cmd', title: 'C', category: 'tools', exec: { program: 'sample-tool', args: ['x{setting:enabled}'] } }],
        configuration: { title: 'Sample', properties: { enabled: { type: 'boolean', default: true, label: 'setting.enabled' } } },
      }
    })
    const compiled = await compileOk(raw)
    expect(compiled.openWith[0].args).toEqual([
      { kind: 'text', value: '--o={setting:enabled}' },
      { kind: 'text', value: '{SETTING:enabled}' },
      { kind: 'text', value: '{setting:}' },
      { kind: 'text', value: 'plain' },
      { kind: 'setting', key: 'enabled' },
    ])
    const literal = compiled.warnings.filter(w => w.code === 'compile.exec.setting.literal')
    expect(literal.map(w => w.path).sort()).toEqual([
      '$.contributes.commands[acme.sample:cmd].exec.args[0]',
      '$.contributes.openWith.open.args[0]',
      '$.contributes.openWith.open.args[1]',
      '$.contributes.openWith.open.args[2]',
    ])
  })

  it('says what really happens with a repeated extension: every occurrence stays, nothing is dropped', async () => {
    const raw = build((r) => {
      r.contributes = {
        languages: [{ id: 'sample', label: 'S', extensions: ['.sol', '.sol'], languageId: 'javascript' }],
        openWith: [{ id: 'open', label: 'Open', program: 'sample-tool', args: [], extensions: ['.sol', '.sol'] }],
      }
    })
    const compiled = await compileOk(raw)
    expect(compiled.languages[0].extensions).toEqual(['.sol', '.sol'])
    expect(compiled.openWith[0].extensions).toEqual(['.sol', '.sol'])
    for (const code of ['compile.language.duplicate', 'compile.openWith.duplicate']) {
      const warning = compiled.warnings.find(w => w.code === code)
      expect(warning, code).toBeDefined()
      expect(warning!.message).not.toMatch(/discard/i)
      expect(warning!.message).toMatch(/stays in the compiled list/)
    }
  })

  it('builds themes and locales without a prototype (a key such as toString or constructor is plain data)', async () => {
    const raw = build((r) => {
      r.contributes = {
        themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }],
        locales: [{ language: 'fr', label: 'Français', file: 'locales/fr.json' }],
      }
      r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}`, 'locales/fr.json': `sha256:${'12'.repeat(32)}` }
    })
    const compiled = await compileOk(raw, { files: { 'themes/dark.json': SAMPLE_FILES['themes/dark.json'](), 'locales/fr.json': SAMPLE_FILES['locales/fr.json']() } })
    expect(Object.getPrototypeOf(compiled.themes[0].tokens)).toBeNull()
    expect(Object.getPrototypeOf(compiled.locales[0].translations)).toBeNull()
    expect('toString' in compiled.themes[0].tokens).toBe(false)
    expect('constructor' in compiled.locales[0].translations).toBe(false)
  })

  it('accepts only real colours: malformed hex, names and incomplete functions are refused', async () => {
    const colour = async (value: string) => {
      const raw = build((r) => {
        r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
        r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
      })
      return compilePlugin(accept(raw), io({ 'themes/dark.json': Buffer.from(JSON.stringify({ 'vscode-foreground': value })) }))
    }
    for (const good of ['#fff', '#ffffff', '#ffffff80', '#ABCDEF', 'rgb(1,2,3)', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(10,20%,30%)', 'hsla(10,20%,30%,0.5)', 'transparent']) {
      expect((await colour(good)).ok, good).toBe(true)
    }
    for (const bad of ['red', 'blue', '#gggggg', '#ff', '#12345', '#1234567', 'rgb(1,2)', 'rgb(a,b,c)', 'hsl(1,2,3)', 'rgba(1,2,3)', '', ' ', '#fff #fff']) {
      const result = await colour(bad)
      expect(result.ok, JSON.stringify(bad)).toBe(false)
      if (!result.ok) expect(result.errors[0].code).toBe('compile.theme.value.invalid')
    }
  })

  it('refuses a control or line break hidden in the white space of a colour function', async () => {
    for (const bad of ['rgb(1,\n2,3)', 'rgb(1,\f2,3)', 'rgb(1,\u20282,3)', 'rgb(1,\u20292,3)', 'rgb(1,\r\n2,3)']) {
      const raw = build((r) => {
        r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
        r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
      })
      const result = await compileBad(raw, { files: { 'themes/dark.json': Buffer.from(JSON.stringify({ 'vscode-foreground': bad })) } })
      expect(result.errors[0].code, JSON.stringify(bad)).toBe('compile.theme.value.invalid')
    }
  })

  it('limits a locale to 3000 keys: 3000 are accepted, 3001 are refused', async () => {
    const raw = build((r) => {
      r.contributes = { locales: [{ language: 'fr', label: 'Français', file: 'locales/fr.json' }] }
      r.files = { 'locales/fr.json': `sha256:${'12'.repeat(32)}` }
    })
    const file = (count: number) => Buffer.from(JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) => [`unknown.key.${i}`, 'x']))))
    const ok = await compileOk(raw, { files: { 'locales/fr.json': file(3000) } })
    expect(ok.warnings.filter(w => w.code === 'compile.locale.key.unknown')).toHaveLength(3000)
    const bad = await compileBad(raw, { files: { 'locales/fr.json': file(3001) } })
    expect(bad.errors[0].code).toBe('compile.locale.file.limit')
  })

  it('refuses a chord reserved only on macOS and one reserved only elsewhere (each platform is checked)', async () => {
    const raw = build((r) => {
      r.contributes = {
        commands: [{ id: 'acme.sample:hello', title: 'Hello', category: 'tools' }],
        keymaps: [{ id: 'default', label: 'Default', keys: 'keymaps/default.json' }],
      }
      r.files = { 'keymaps/default.json': `sha256:${'12'.repeat(32)}` }
    })
    for (const key of ['Mod+Alt+H', 'Ctrl+Y', 'Mod+Q', 'Ctrl+S']) {
      const result = await compileBad(raw, { files: { 'keymaps/default.json': Buffer.from(JSON.stringify([{ command: 'acme.sample:hello', key }])) } })
      expect(result.errors[0].code, key).toBe('compile.keymap.reserved')
    }
    const free = await compileOk(raw, { files: { 'keymaps/default.json': Buffer.from(JSON.stringify([{ command: 'acme.sample:hello', key: 'Ctrl+Alt+Y' }])) } })
    expect(free.keymaps).toHaveLength(1)
  })

  it('refuses a file path that climbs out of the package with its own code, before any read', async () => {
    const manifest = accept(build((r) => {
      r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
      r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
    }))
    for (const bad of ['../dark.json', 'themes/../../dark.json', 'themes/./dark.json']) {
      const crafted = { ...manifest, contributes: { ...manifest.contributes, themes: [{ ...manifest.contributes.themes![0], tokens: bad }] }, files: { ...manifest.files, [bad]: manifest.files['themes/dark.json'] } } as PluginManifest
      let reads = 0
      const result = await compilePlugin(crafted, { ...io({}), readFile: async () => { reads++; return Buffer.from('{}') } })
      expect(result.ok, bad).toBe(false)
      if (!result.ok) expect(result.errors[0].code, bad).toBe('compile.file.path.invalid')
      expect(reads).toBe(0)
    }
  })

  it('handles the minimal manifest (no contributions) as a no-op success', async () => {
    const raw = build()
    const result = await compileOk(raw)
    expect(result.themes).toHaveLength(0)
    expect(result.keymaps).toHaveLength(0)
    expect(result.languages).toHaveLength(0)
    expect(result.locales).toHaveLength(0)
    expect(result.openWith).toHaveLength(0)
    expect(result.commands).toHaveLength(0)
    expect(result.contribution.commands).toHaveLength(0)
  })
})

/** The middle value of the sorted samples (the mean of the two middle ones for an even count). */
function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

describe('median helper', () => {
  it('takes the middle value, not the mean', () => {
    expect(median([1, 100, 2])).toBe(2)
    expect(median([5, 1, 3, 100, 4])).toBe(4)
    expect(median([1, 2, 3, 10])).toBe(2.5)
  })
})

const ROUNDS = 5

describe(`budgets (median of ${ROUNDS} rounds)`, () => {
  it('compiles 50 plugins with 2 themes, 1 keymap and 1 locale each (median of rounds in under 150 ms)', async () => {
    const samples: number[] = []
    for (let run = 0; run < ROUNDS; run++) {
      const fileMap = (id: string): Record<string, Uint8Array> => ({
        'themes/dark.json': SAMPLE_FILES['themes/dark.json'](),
        'themes/light.json': SAMPLE_FILES['themes/light.json'](),
        'keymaps/default.json': Buffer.from(JSON.stringify([{ command: `${id}:hello`, key: 'Ctrl+Alt+Shift+Q' }])),
        'locales/fr.json': SAMPLE_FILES['locales/fr.json'](),
      })
      const manifestBuilder = (i: number) => build((r) => {
        r.id = `acme.bench${i}`
        r.contributes = {
          themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }, { id: 'light', label: 'L', base: 'light', tokens: 'themes/light.json' }],
          keymaps: [{ id: 'default', label: 'Default', keys: 'keymaps/default.json' }],
          locales: [{ language: 'fr', label: 'Français', file: 'locales/fr.json' }],
          commands: [{ id: `acme.bench${i}:hello`, title: 'Hello', category: 'tools' }],
        }
        r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}`, 'themes/light.json': `sha256:${'12'.repeat(32)}`, 'keymaps/default.json': `sha256:${'12'.repeat(32)}`, 'locales/fr.json': `sha256:${'12'.repeat(32)}` }
      })
      const start = performance.now()
      for (let i = 0; i < 50; i++) {
        const id = `acme.bench${i}`
        const result = await compilePlugin(accept(manifestBuilder(i)), io(fileMap(id)))
        if (!result.ok) throw new Error(JSON.stringify(result.errors))
      }
      samples.push(performance.now() - start)
    }
    const middle = median(samples)
    process.stdout.write(`compilePlugin budget: 50 plugins median of ${ROUNDS}=${middle.toFixed(3)} ms; samples=${samples.map(s => s.toFixed(3)).join(', ')}\n`)
    expect(middle).toBeLessThan(150)
  })

  it('compiles a theme with every declared token (97 today) in under 5 ms (median of rounds)', async () => {
    const samples: number[] = []
    for (let run = 0; run < ROUNDS; run++) {
      const raw = build((r) => {
        r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
        r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
      })
      const start = performance.now()
      const result = await compilePlugin(accept(raw), io({ 'themes/dark.json': allTokensFile() }))
      const elapsed = performance.now() - start
      if (!result.ok) throw new Error(JSON.stringify(result.errors))
      samples.push(elapsed)
    }
    const middle = median(samples)
    process.stdout.write(`compilePlugin budget: full-declared theme median of ${ROUNDS}=${middle.toFixed(3)} ms; samples=${samples.map(s => s.toFixed(3)).join(', ')}\n`)
    expect(middle).toBeLessThan(5)
  })

  it('refuses a 64 KB+1 hostile tokens file in under 10 ms (median of rounds) without parsing it', async () => {
    const samples: number[] = []
    for (let run = 0; run < ROUNDS; run++) {
      const hostile = Buffer.alloc(64 * 1024 + 1, 0x20)
      const raw = build((r) => {
        r.contributes = { themes: [{ id: 'dark', label: 'D', base: 'dark', tokens: 'themes/dark.json' }] }
        r.files = { 'themes/dark.json': `sha256:${'12'.repeat(32)}` }
      })
      const start = performance.now()
      const result = await compilePlugin(accept(raw), io({ 'themes/dark.json': hostile }))
      const elapsed = performance.now() - start
      expect(result.ok).toBe(false)
      samples.push(elapsed)
    }
    const middle = median(samples)
    process.stdout.write(`compilePlugin budget: hostile 64 KB+1 median of ${ROUNDS}=${middle.toFixed(3)} ms; samples=${samples.map(s => s.toFixed(3)).join(', ')}\n`)
    expect(middle).toBeLessThan(10)
  })
})

describe('phase 1 import safety', () => {
  it('keeps the compile module out of every production startup module', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = `${directory}/${entry.name}`
      return entry.isDirectory() ? walk(path) : /\.(?:ts|tsx)$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : []
    })
    const offenders: string[] = []
    for (const path of ['src', 'electron', 'core'].flatMap(walk).filter(path => !path.startsWith('core/plugins/'))) {
      const source = readFileSync(path, 'utf8')
      const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1])
      const filtered = imports.filter(specifier => /(?:^|\/)plugins\/compile/.test(specifier))
      if (filtered.length) offenders.push(`${path}: ${filtered.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
