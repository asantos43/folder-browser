import { Buffer } from 'node:buffer'
import { normalizeChord } from '../keys/chord.ts'
import { assertPluginChord } from '../keys/reserved.ts'
import { safeRelative } from '../zip.ts'
import { parseCommandTemplate } from '../run.ts'
import type { ContributionCommand, ContributionKey, ContributionMenuItem, MenuPoint } from '../contributions/contract.ts'
import type { PluginManifest, OpenWith, ConfigurationProperty } from './manifest.ts'

/**
 * Compile a level-0 plugin (themes, keymaps, languages, locales, Open With
 * entries and commands) into the data the registries consume. The output is
 * detached, deeply frozen and serialisable: it is what gets written into
 * `installed.json` and read back at start.
 *
 * - **All-or-nothing.** A single bad file (a hostile theme, a reserved chord,
 *   a typo in a colour) refuses the whole plugin; nothing partial is returned.
 * - **Pure TypeScript, no startup imports.** The whole module is install-time;
 *   importing it from a production module adds nothing to the cold start.
 * - **No filesystem reads at runtime.** The tokens allowed in a theme and the
 *   locale keys come from the host (`CompileIO.declaredTokens` and
 *   `CompileIO.knownLocaleKeys`); the package reader (step 2.2) builds these
 *   from the bundled source. The unit tests load them from disk once.
 *
 * `io` is injected so the package reader can pass its own byte reader; the
 * tests use a small in-memory map.
 */

export interface CompileIO {
  /** Bounded read of one of the files the manifest declared. The path has already been validated as a safe relative. */
  readFile(path: string): Promise<Uint8Array>
  /** Built-in command ids the host already registered. Used to reject a key for a command that does not exist. */
  knownCommands: ReadonlySet<string>
  /** Built-in language ids the editor already knows. The list is the one CodeMirror wires up. */
  knownLanguages: ReadonlySet<string>
  /** Built-in extensions the editor already handles (e.g. `.json`, `.ts`). Compared lowercase. */
  builtinExtensions: ReadonlySet<string>
  /** Token names a theme may set: the CSS variables declared in `src/theme/tokens.css`. Supplied by the host. */
  declaredTokens: ReadonlySet<string>
  /** Top-level message keys of `src/i18n/en.ts`. Unknown locale keys pass as warnings, not errors. */
  knownLocaleKeys: ReadonlySet<string>
}

export interface CompileError { path: string; code: string; message: string }
export type CompileResult = { ok: true; compiled: CompiledPlugin } | { ok: false; errors: CompileError[] }

/** A compiled theme: the token overrides plus a base and an id that does not clash with another theme. */
export interface CompiledTheme {
  id: string
  label: string
  base: 'light' | 'dark'
  tokens: Readonly<Record<string, string>>
}

/** A keymap entry: a free chord for one of the plugin's commands, attached to the keymap that declared it. */
export interface CompiledKeyEntry {
  command: string
  key: string
  source: { keymapId: string; keymapLabel: string }
}

/** A language pack: extensions and/or filenames paired to a CodeMirror language id. */
export interface CompiledLanguage {
  id: string
  label: string
  extensions: readonly string[]
  filenames: readonly string[]
  languageId: string
}

/** One argument. The literal text or the placeholder token, kept as a typed marker so substitution happens at run time. */
export type CompiledArg = { kind: 'text'; value: string } | { kind: 'file' } | { kind: 'dir' } | { kind: 'name' } | { kind: 'setting'; key: string }

/** A normalised Open With entry, ready for the run engine. */
export interface CompiledOpenWith {
  id: string
  label: string
  extensions: readonly string[]
  program: string
  args: readonly CompiledArg[]
}

/** A command declared by the manifest, with all of its original fields preserved (palette, keys, menu, exec). */
export interface CompiledCommand {
  id: string
  title: string
  category: string
  when?: string
  palette?: boolean
  /** Default bindings the command ships with (`commands[].keys` in the manifest). */
  defaultKeys: readonly string[]
  /** Optional menu placement. */
  menu?: { menu: MenuPoint; group: string; order: number }
  /** Optional program the command starts (typed markers; substituted at run time). */
  exec?: { program: string; args: readonly CompiledArg[] }
}

/** A `Contribution` fragment the installer's gate accepts: commands, keys and menu items named with the plugin's id prefix. */
export interface CompiledContribution {
  pluginId: string
  commands: readonly ContributionCommand[]
  /** Default keys from `commands[].keys` plus keymap entries. The same `{command, key}` shape the gate accepts; keymap entries keep their source via the parallel `keymapKeys`. */
  keys: readonly ContributionKey[]
  menuItems: readonly ContributionMenuItem[]
  /** Key entries that came from a keymap file (the keymap's id and label). Not consumed by the gate; kept for the UI to attribute the key. */
  keymapKeys: readonly CompiledKeyEntry[]
}

/** A compiled locale: a flat dictionary of i18n text for the keys the interface actually uses. */
export interface CompiledLocale {
  language: string
  label: string
  translations: Readonly<Record<string, string>>
}

export interface CompiledPlugin {
  pluginId: string
  themes: readonly CompiledTheme[]
  keymaps: readonly CompiledKeyEntry[]
  languages: readonly CompiledLanguage[]
  locales: readonly CompiledLocale[]
  openWith: readonly CompiledOpenWith[]
  /** The plugin's own commands, with every field of the manifest preserved (palette, default keys, menu, exec). */
  commands: readonly CompiledCommand[]
  /** The `Contribution` fragment the installer's gate consumes: the same data subset, in `applyContribution`'s shape. */
  contribution: CompiledContribution
  /** Declarations of the plugin's `configuration`, ready for the settings registry. */
  configuration: readonly { id: string; property: ConfigurationProperty }[]
  /** Non-fatal issues (e.g. an unknown locale key or a duplicate extension). They do not fail the install. */
  warnings: readonly CompileError[]
}

const TEXT_FILE_LIMIT = 64 * 1024
const LOCALE_FILE_LIMIT = 512 * 1024
const MAX_TOKEN_COUNT = 400
const MAX_KEY_COUNT = 500
const MAX_LOCALE_KEYS = 3000
const LOCALE_TEXT_LIMIT = 2 * 1024
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const ALLOWED_PATH = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/
const ALLOWED_ID = /^[a-z0-9.:-]+$/
// Every control except TAB: C0 (\x00-\x08, \x0a-\x1f, so LF and CR too), DEL, C1 (\x7f-\x9f) and the Unicode line and paragraph separators.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u2028\u2029]/u
const FAIL = Symbol.for('compile.fail')

const HEX_SHORT = /^#[0-9a-fA-F]{3}$/
const HEX_FULL = /^#[0-9a-fA-F]{6}$/
const HEX_ALPHA = /^#[0-9a-fA-F]{8}$/
const RGB = /^rgb\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)$/
const RGBA = /^rgba\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*(?:0|1|0?\.\d+|\d+(?:\.\d+)?%)\s*\)$/
const HSL = /^hsl\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?%\s*,\s*\d+(?:\.\d+)?%\s*\)$/
const HSLA = /^hsla\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?%\s*,\s*\d+(?:\.\d+)?%\s*,\s*(?:0|1|0?\.\d+|\d+(?:\.\d+)?%)\s*\)$/
const FORBIDDEN_VALUE = /(?:\burl\s*\(|[{};\\/*]|\bvar\s*\(|\bexpression\b|@import\b|<|\bstyle\s*=)/i

/** A theme value is a colour or `transparent`; anything else is refused (`url(`, `;`, `{`, `var(`, `<`, controls). */
function colourValue(value: unknown, path: string, errors: CompileError[]): string {
  if (typeof value !== 'string') fail(errors, path, 'theme.value.invalid', 'use a colour: #rgb, #rrggbb, #rrggbbaa, rgb()/rgba()/hsl()/hsla() or transparent')
  const text = value as string
  if (Buffer.byteLength(text, 'utf8') > 200) fail(errors, path, 'theme.value.invalid', 'use a colour of at most 200 UTF-8 bytes')
  if (FORBIDDEN_CHARS.test(text)) fail(errors, path, 'theme.value.invalid', 'a colour must not contain control characters (only TAB is allowed), C1 controls or line separators')
  if (text === 'transparent') return text
  if (FORBIDDEN_VALUE.test(text)) fail(errors, path, 'theme.value.invalid', 'a colour must not contain url(, {, }, ;, \\, /, *, var(, expression, @import, < or style=')
  if (!(HEX_SHORT.test(text) || HEX_FULL.test(text) || HEX_ALPHA.test(text) || RGB.test(text) || RGBA.test(text) || HSL.test(text) || HSLA.test(text))) {
    fail(errors, path, 'theme.value.invalid', 'use a colour: #rgb, #rrggbb, #rrggbbaa, rgb()/rgba()/hsl()/hsla() or transparent')
  }
  return text
}

function baseValue(value: unknown, path: string, errors: CompileError[]): 'light' | 'dark' {
  if (value !== 'light' && value !== 'dark') fail(errors, path, 'theme.base.invalid', 'use base: "light" or "dark"')
  return value
}

function idValue(value: unknown, path: string, errors: CompileError[], max = 64): string {
  if (typeof value !== 'string' || RESERVED.has(value) || !ALLOWED_ID.test(value) || value.length === 0 || value.length > max) fail(errors, path, 'id.invalid', 'use a lowercase id (letters, digits, dot, colon, hyphen) without reserved names')
  return value
}

function labelValue(value: unknown, path: string, errors: CompileError[], max = 80): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || FORBIDDEN_CHARS.test(value)) fail(errors, path, 'label.invalid', `use nonempty text of at most ${max} characters without controls`)
  return value
}

function relativePath(value: unknown, path: string, errors: CompileError[], suffix: '.json'): string {
  if (typeof value !== 'string' || !value.endsWith(suffix) || safeRelative(value) === null || !ALLOWED_PATH.test(value)) fail(errors, path, 'file.path.invalid', `use a safe relative ${suffix} path`)
  return value
}

function fail(errors: CompileError[], path: string, code: string, message: string): never {
  errors.push({ path, code: `compile.${code}`, message })
  throw FAIL
}

/** Limit reads at the byte level before they reach `JSON.parse`. A hostile file over the limit is rejected without ever being parsed. */
async function readBounded(io: CompileIO, file: string, manifestFiles: Readonly<Record<string, string>>, errors: CompileError[], limit: number, kind: string): Promise<Uint8Array> {
  if (!ALLOWED_PATH.test(file) || RESERVED.has(file) || safeRelative(file) === null) fail(errors, `$.files.${file}`, 'file.undeclared', 'declare each file in the manifest and use a safe relative path')
  if (!Object.hasOwn(manifestFiles, file)) fail(errors, `$.files.${file}`, 'file.undeclared', `declare "${file}" in the manifest's files map with its sha256 hash`)
  const bytes = await io.readFile(file)
  if (bytes.byteLength > limit) fail(errors, `$.files.${file}`, `${kind}.limit`, `use a file of at most ${limit} bytes`)
  return bytes
}

function safeParse(text: string, kind: string): unknown {
  try { return JSON.parse(text) } catch { throw new SyntaxError(`Invalid ${kind}`) }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function freezeArray<T>(items: readonly T[]): readonly T[] { Object.freeze(items); return items }

/** Escape a value used inside a CSS attribute selector: every byte that has any meaning becomes `\HEX `. */
// eslint-disable-next-line no-control-regex
export function escapeAttr(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f-\x9f"\\]/g, char => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')} `)
}

async function compileThemes(manifest: PluginManifest, errors: CompileError[], io: CompileIO): Promise<CompiledTheme[]> {
  const themes = manifest.contributes.themes ?? []
  const allowed = io.declaredTokens
  const compiled: CompiledTheme[] = []
  for (const theme of themes) {
    const id = idValue(theme.id, `$.contributes.themes.${theme.id}.id`, errors)
    const base = baseValue(theme.base, `$.contributes.themes.${theme.id}.base`, errors)
    const label = labelValue(theme.label, `$.contributes.themes.${theme.id}.label`, errors)
    const tokensPath = `$.contributes.themes.${theme.id}.tokens`
    const tokensFile = relativePath(theme.tokens, tokensPath, errors, '.json')
    const raw = await readBounded(io, tokensFile, manifest.files, errors, TEXT_FILE_LIMIT, 'theme.tokens')
    let parsed: unknown
    try { parsed = safeParse(Buffer.from(raw).toString('utf8'), 'JSON') } catch { fail(errors, tokensPath, 'theme.tokens.json', 'provide valid JSON') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(errors, tokensPath, 'theme.tokens.object', 'use a flat object of token -> colour')
    const flat = parsed as Record<string, unknown>
    const keys = Object.keys(flat)
    const tokens: Record<string, string> = Object.create(null)
    // The limit runs first: a hostile theme with thousands of unknown tokens gets refused before token lookup.
    if (keys.length > MAX_TOKEN_COUNT) fail(errors, tokensPath, 'theme.tokens.limit', `declare at most ${MAX_TOKEN_COUNT} tokens per theme`)
    for (const name of keys) {
      if (!allowed.has(name)) fail(errors, `${tokensPath}.${name}`, 'theme.token.unknown', `use a token declared in src/theme/tokens.css; "${name}" is not a known token`)
      tokens[name] = colourValue(flat[name], `${tokensPath}.${name}`, errors)
    }
    compiled.push(deepFreeze({ id: `${manifest.id}:${id}`, label, base, tokens: deepFreeze(tokens) }))
  }
  return freezeArray(compiled) as CompiledTheme[]
}

function compileKeyEntry(raw: unknown, errors: CompileError[], pluginCommands: ReadonlySet<string>, builtins: ReadonlySet<string>, index: number, keymapId: string): CompiledKeyEntry {
  const path = `$.contributes.keymaps.${keymapId}.keys[${index}]`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(errors, path, 'keymap.entry.invalid', 'use an object with "command" and "key"')
  const entry = raw as Record<string, unknown>
  const command = labelValue(entry.command, `${path}.command`, errors, 130)
  if (!pluginCommands.has(command) && !builtins.has(command)) fail(errors, `${path}.command`, 'keymap.command.unknown', `reference a command declared in this plugin or a built-in command; "${command}" is unknown`)
  const key = labelValue(entry.key, `${path}.key`, errors, 64)
  try { assertPluginChord(key, true); assertPluginChord(key, false) } catch (error) { fail(errors, `${path}.key`, 'keymap.reserved', (error as Error).message) }
  return { command, key, source: { keymapId, keymapLabel: '' } }
}

async function compileKeymaps(manifest: PluginManifest, errors: CompileError[], warnings: CompileError[], io: CompileIO): Promise<{ keymapKeys: CompiledKeyEntry[]; commands: CompiledCommand[]; contributionCommands: ContributionCommand[]; contributionKeys: ContributionKey[]; menuItems: ContributionMenuItem[] }> {
  const keymaps = manifest.contributes.keymaps ?? []
  const commands = manifest.contributes.commands ?? []
  const pluginCommands = new Set(commands.map(c => c.id))
  const contributionCommands: ContributionCommand[] = []
  const contributionKeys: ContributionKey[] = []
  const menuItems: ContributionMenuItem[] = []
  const compiledCommands: CompiledCommand[] = []
  // Project the manifest's commands. Each default key in `command.keys` becomes a `ContributionKey` and is also kept
  // on the full `CompiledCommand` (with the rest of the original fields — palette, menu, exec).
  for (const command of commands) {
    const when = command.when
    const projected: ContributionCommand = { id: command.id, title: command.title, category: command.category ?? manifest.id, ...(when === undefined ? {} : { when }), ...(command.palette === undefined ? {} : { palette: command.palette }) }
    contributionCommands.push(projected)
    if (command.keys) for (const key of command.keys) contributionKeys.push({ command: command.id, key })
    if (command.menu) menuItems.push({ id: `${command.id}-menu`, command: command.id, point: command.menu.menu as MenuPoint, group: command.menu.group, order: command.menu.order })
    const compiled: CompiledCommand = deepFreeze({
      id: command.id,
      title: command.title,
      category: command.category ?? manifest.id,
      ...(when === undefined ? {} : { when }),
      ...(command.palette === undefined ? {} : { palette: command.palette }),
      defaultKeys: Object.freeze([...(command.keys ?? [])]),
      ...(command.menu === undefined ? {} : { menu: { menu: command.menu.menu as MenuPoint, group: command.menu.group, order: command.menu.order } }),
      ...(command.exec === undefined ? {} : { exec: { program: command.exec.program, args: compileArgs(command.exec.args, `$.contributes.commands[${command.id}].exec.args`, errors, warnings, manifest.id) } }),
    })
    compiledCommands.push(compiled)
  }
  // Keymap entries: each `{command, key}` becomes a `CompiledKeyEntry` with the keymap id as its source.
  const keymapKeys: CompiledKeyEntry[] = []
  for (const keymap of keymaps) {
    const keymapId = idValue(keymap.id, `$.contributes.keymaps.${keymap.id}.id`, errors)
    const keymapLabel = labelValue(keymap.label, `$.contributes.keymaps.${keymapId}.label`, errors)
    const keyPath = `$.contributes.keymaps.${keymapId}`
    const keysFile = relativePath(keymap.keys, `${keyPath}.keys`, errors, '.json')
    const raw = await readBounded(io, keysFile, manifest.files, errors, TEXT_FILE_LIMIT, 'keymap.keys')
    let parsed: unknown
    try { parsed = safeParse(Buffer.from(raw).toString('utf8'), 'JSON') } catch { fail(errors, `${keyPath}.keys`, 'keymap.keys.json', 'provide valid JSON') }
    if (!Array.isArray(parsed)) fail(errors, `${keyPath}.keys`, 'keymap.keys.list', 'use a JSON array of {command, key} entries')
    if (parsed.length > MAX_KEY_COUNT) fail(errors, `${keyPath}.keys`, 'keymap.keys.limit', `declare at most ${MAX_KEY_COUNT} keys per keymap`)
    const seen = new Map<string, string>()
    for (const [index, entry] of parsed.entries()) {
      const compiled = compileKeyEntry(entry, errors, pluginCommands, io.knownCommands, index, keymapId)
      compiled.source.keymapLabel = keymapLabel
      const both = [normalizeChord(compiled.key, true), normalizeChord(compiled.key, false)]
      for (const chord of both) {
        const owner = seen.get(chord)
        if (owner && owner !== compiled.command) fail(errors, `${keyPath}.keys[${index}]`, 'keymap.conflict', `the chord "${compiled.key}" is already taken by "${owner}"`)
        seen.set(chord, compiled.command)
      }
      keymapKeys.push(deepFreeze(compiled))
    }
  }
  return {
    keymapKeys: freezeArray(keymapKeys) as CompiledKeyEntry[],
    commands: freezeArray(compiledCommands) as CompiledCommand[],
    contributionCommands: freezeArray(contributionCommands) as ContributionCommand[],
    contributionKeys: freezeArray(contributionKeys) as ContributionKey[],
    menuItems: freezeArray(menuItems) as ContributionMenuItem[],
  }
}

/**
 * Compile a list of argument strings into typed markers. `{file}` / `{dir}` / `{name}` and `{setting:x}` are preserved.
 * A setting key may be written with or without the plugin's own id prefix (`enabled` or `<plugin id>:enabled`); the marker
 * keeps the short form. Text that only looks like a setting reference (`--o={setting:x}`, `{SETTING:x}`, `{setting:}`) stays
 * literal text and gets a `compile.exec.setting.literal` warning, so the author is told it will not be substituted.
 */
function compileArgs(args: readonly string[], path: string, errors: CompileError[], warnings: CompileError[], pluginId: string): readonly CompiledArg[] {
  const compiled: CompiledArg[] = []
  const prefix = `${pluginId}:`
  for (const [i, arg] of args.entries()) {
    if (typeof arg !== 'string') fail(errors, `${path}[${i}]`, 'exec.argument.invalid', 'use a string argument')
    if (arg === '{file}') compiled.push({ kind: 'file' })
    else if (arg === '{dir}') compiled.push({ kind: 'dir' })
    else if (arg === '{name}') compiled.push({ kind: 'name' })
    else {
      const match = /^\{setting:([a-z][a-zA-Z0-9._:-]{0,127})\}$/.exec(arg)
      if (match) compiled.push({ kind: 'setting', key: match[1].startsWith(prefix) ? match[1].slice(prefix.length) : match[1] })
      else {
        if (/\{\s*setting\s*:/i.test(arg)) warnings.push({ path: `${path}[${i}]`, code: 'compile.exec.setting.literal', message: 'this argument looks like a setting reference but is not a whole argument written as {setting:key}; it stays literal text and is not substituted' })
        compiled.push({ kind: 'text', value: arg })
      }
    }
  }
  return freezeArray(compiled) as CompiledArg[]
}

/** All `{setting:x}` keys referenced by the compiled commands and Open With entries. */
function collectSettingRefs(commands: readonly CompiledCommand[], openWith: readonly CompiledOpenWith[]): Set<string> {
  const refs = new Set<string>()
  for (const command of commands) for (const arg of command.exec?.args ?? []) if (arg.kind === 'setting') refs.add(arg.key)
  for (const ow of openWith) for (const arg of ow.args) if (arg.kind === 'setting') refs.add(arg.key)
  return refs
}

function compileLanguages(manifest: PluginManifest, errors: CompileError[], warnings: CompileError[], io: CompileIO): CompiledLanguage[] {
  const languages = manifest.contributes.languages ?? []
  const compiled: CompiledLanguage[] = []
  const seenExtensions = new Set<string>()
  for (const language of languages) {
    const path = `$.contributes.languages.${language.id}`
    const id = idValue(language.id, `${path}.id`, errors)
    const label = labelValue(language.label, `${path}.label`, errors)
    if (!io.knownLanguages.has(language.languageId)) fail(errors, `${path}.languageId`, 'language.unknown', `use a built-in language id; "${language.languageId}" is not one of the editor's languages`)
    // Duplicates are warnings: the first occurrence wins at runtime, but every entry stays in the compiled list
    // (the editor still uses the names; the rule is only that the editor's "this extension belongs to language X" lookup
    // picks the first language that declared it).
    const extensions: string[] = []
    for (const [i, ext] of (language.extensions ?? []).entries()) {
      if (typeof ext !== 'string') fail(errors, `${path}.extensions[${i}]`, 'language.extension.invalid', 'use a string extension')
      if (!ext.startsWith('.') || !/^\.[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(ext)) fail(errors, `${path}.extensions[${i}]`, 'language.extension.invalid', 'use an extension beginning with a dot, without path separators')
      const lower = ext.toLowerCase()
      if (lower !== ext) fail(errors, `${path}.extensions[${i}]`, 'language.extension.case', 'use a lowercase extension')
      if (io.builtinExtensions.has(lower)) fail(errors, `${path}.extensions[${i}]`, 'language.builtin-conflict', `the extension "${lower}" is already handled by the editor; it cannot be taken by a plugin without an explicit override in a later version`)
      if (seenExtensions.has(lower)) warnings.push({ path: `${path}.extensions[${i}]`, code: 'compile.language.duplicate', message: `the extension "${lower}" is already declared earlier in this plugin; every occurrence stays in the compiled list (nothing is dropped) and the editor uses the first language that declared it` })
      seenExtensions.add(lower)
      extensions.push(lower)
    }
    const filenames = (language.filenames ?? []).map((file, i) => {
      if (typeof file !== 'string' || file.length === 0 || /[/\\]/.test(file) || file === '.' || file === '..') fail(errors, `${path}.filenames[${i}]`, 'language.filename.invalid', 'use a filename without path separators, dots or double dots')
      return file
    })
    if (extensions.length === 0 && filenames.length === 0) fail(errors, path, 'language.matches.required', 'provide at least one extension or filename')
    compiled.push(deepFreeze({ id: `${manifest.id}:${id}`, label, extensions: freezeArray(extensions), filenames: freezeArray(filenames), languageId: language.languageId }))
  }
  return freezeArray(compiled) as CompiledLanguage[]
}

async function compileLocales(manifest: PluginManifest, errors: CompileError[], warnings: CompileError[], io: CompileIO): Promise<CompiledLocale[]> {
  const locales = manifest.contributes.locales ?? []
  const validKeys = io.knownLocaleKeys
  const compiled: CompiledLocale[] = []
  for (const locale of locales) {
    if (typeof locale.language !== 'string' || !localeTag(locale.language)) fail(errors, `$.contributes.locales.${locale.language}.language`, 'locale.invalid', 'use a BCP47 tag')
    if (locale.language === 'en' || locale.language === 'pt-BR') fail(errors, `$.contributes.locales.${locale.language}.language`, 'locale.builtin-conflict', `the language "${locale.language}" is built-in; it cannot be redeclared in version 1`)
    if (typeof locale.label !== 'string') fail(errors, `$.contributes.locales.${locale.language}.label`, 'locale.label.invalid', 'use a label')
    const fileField = `$.contributes.locales.${locale.language}.file`
    const filePath = relativePath(locale.file, fileField, errors, '.json')
    const raw = await readBounded(io, filePath, manifest.files, errors, LOCALE_FILE_LIMIT, 'locale.file')
    let parsed: unknown
    try { parsed = safeParse(Buffer.from(raw).toString('utf8'), 'JSON') } catch { fail(errors, fileField, 'locale.file.json', 'provide valid JSON') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(errors, fileField, 'locale.file.object', 'use a flat object of key -> text')
    const flat = parsed as Record<string, unknown>
    const keys = Object.keys(flat)
    if (keys.length > MAX_LOCALE_KEYS) fail(errors, fileField, 'locale.file.limit', `declare at most ${MAX_LOCALE_KEYS} keys per locale`)
    const translations: Record<string, string> = Object.create(null)
    for (const key of keys) {
      const value = flat[key]
      const textField = `${fileField}.${key}`
      if (typeof value !== 'string') fail(errors, textField, 'locale.text.invalid', 'use a string')
      const text = value as string
      // UTF-8 byte length, not character count: a French phrase of 1025 accented characters is rejected too.
      if (Buffer.byteLength(text, 'utf8') > LOCALE_TEXT_LIMIT) fail(errors, textField, 'locale.text.limit', `use a translation of at most ${LOCALE_TEXT_LIMIT} UTF-8 bytes`)
      if (FORBIDDEN_CHARS.test(text)) fail(errors, textField, 'locale.text.control', 'remove control characters, line breaks and line separators (only TAB is allowed)')
      if (!validKeys.has(key)) { warnings.push({ path: textField, code: 'compile.locale.key.unknown', message: `the key "${key}" is not in the built-in English catalog; it will be ignored` }); continue }
      translations[key] = text
    }
    compiled.push(deepFreeze({ language: locale.language, label: locale.label, translations: deepFreeze(translations) }))
  }
  return freezeArray(compiled) as CompiledLocale[]
}

function localeTag(value: string): boolean { return /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value) }

function compileOpenWith(openWith: OpenWith[], manifest: PluginManifest, errors: CompileError[], warnings: CompileError[]): { compiled: CompiledOpenWith[]; warnings: CompileError[] } {
  const compiled: CompiledOpenWith[] = []
  const localWarnings: CompileError[] = []
  for (const entry of openWith) {
    const path = '$.contributes.openWith.' + entry.id
    parseCommandTemplate({ id: 'plugin', name: 'plugin', program: entry.program, args: entry.args as string[] })
    // Manifest's `extensions` carries the leading dot; we keep it, lowercase, and warn on duplicates inside the same Open With entry.
    const seen = new Set<string>()
    const extensions: string[] = []
    for (let i = 0; i < (entry.extensions ?? []).length; i++) {
      const ext = (entry.extensions ?? [])[i]
      if (typeof ext !== 'string' || !ext.startsWith('.') || !/^\.[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(ext)) fail(errors, `${path}.extensions[${i}]`, 'openWith.extension.invalid', 'use an extension beginning with a dot')
      const lower = ext.toLowerCase()
      if (lower !== ext) fail(errors, `${path}.extensions[${i}]`, 'openWith.extension.case', 'use a lowercase extension')
      if (seen.has(lower)) localWarnings.push({ path: `${path}.extensions[${i}]`, code: 'compile.openWith.duplicate', message: `the extension "${lower}" is repeated in this Open With entry; every occurrence stays in the compiled list (nothing is dropped), remove the repeat` })
      seen.add(lower)
      extensions.push(lower)
    }
    compiled.push(deepFreeze({
      id: `${manifest.id}:${entry.id}`,
      label: entry.label,
      extensions: freezeArray(extensions) as string[],
      program: entry.program,
      args: compileArgs(entry.args, `${path}.args`, errors, localWarnings, manifest.id),
    }))
  }
  warnings.push(...localWarnings)
  return { compiled: freezeArray(compiled) as CompiledOpenWith[], warnings }
}

function compileConfiguration(manifest: PluginManifest): readonly { id: string; property: ConfigurationProperty }[] {
  const configuration = manifest.contributes.configuration
  if (!configuration) return []
  return freezeArray(Object.entries(configuration.properties).map(([key, property]) => ({ id: key, property })))
}

/**
 * The token names a theme may set: every custom property declared (`--name:`) in the text of `src/theme/tokens.css`.
 * Pure: the host (and the tests) read the file and pass its text, so `compilePlugin` itself never touches the disk.
 */
export function declaredTokensFromCss(css: string): ReadonlySet<string> {
  const names = new Set<string>()
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[\s;{])--([a-zA-Z][a-zA-Z0-9-]*)\s*:/g)) names.add(match[1])
  return names
}

/** A theme's tokens become CSS variables inside a `[data-theme-plugin="<id>"]` rule. */
export function themeToCss(theme: CompiledTheme): string {
  const id = escapeAttr(theme.id)
  const properties = Object.entries(theme.tokens).map(([token, colour]) => `  --${token}: ${colour};`).join('\n')
  return `html[data-theme-plugin="${id}"][data-theme-base="${theme.base}"] {\n${properties}\n}`
}

/** A preview marks the rule with `data-theme-plugin-preview` so the UI can remove it without losing the user's choice. */
export function themePreview(theme: CompiledTheme): string {
  const id = escapeAttr(theme.id)
  const properties = Object.entries(theme.tokens).map(([token, colour]) => `  --${token}: ${colour};`).join('\n')
  return `html[data-theme-plugin-preview="${id}"][data-theme-base="${theme.base}"] {\n${properties}\n}`
}

/** Run the compile on a single plugin's manifest and its files. Returns either a ready payload or an error list. */
export async function compilePlugin(manifest: PluginManifest, io: CompileIO): Promise<CompileResult> {
  const errors: CompileError[] = []
  const warnings: CompileError[] = []
  try {
    const configuration = compileConfiguration(manifest)
    // A setting may be declared as `enabled` or `<plugin id>:enabled`; references are compared by the short form.
    const prefix = `${manifest.id}:`
    const configurationKeys = new Set(configuration.map(c => c.id.startsWith(prefix) ? c.id.slice(prefix.length) : c.id))
    const themes = await compileThemes(manifest, errors, io)
    const keymaps = await compileKeymaps(manifest, errors, warnings, io)
    const languages = compileLanguages(manifest, errors, warnings, io)
    const locales = await compileLocales(manifest, errors, warnings, io)
    const openWith = compileOpenWith(manifest.contributes.openWith ?? [], manifest, errors, warnings).compiled
    // Every `{setting:x}` the plugin references must be declared in its `configuration`.
    const refs = collectSettingRefs(keymaps.commands, openWith)
    for (const setting of refs) {
      if (!configurationKeys.has(setting)) {
        const message = 'the setting "' + setting + '" referenced from an Open With arg or a command exec.args is not in this plugin configuration'
        fail(errors, `$.contributes`, 'exec.setting.unknown', message)
      }
    }
    // Surface unknown settings as an additional warning when `configuration` is empty.
    if (configuration.length === 0 && refs.size > 0) {
      warnings.push({ path: '$.contributes', code: 'compile.exec.setting.no-configuration', message: `${refs.size} setting reference(s) found but the plugin declares no configuration; check the manifest` })
    }
    const compiled: CompiledPlugin = deepFreeze({
      pluginId: manifest.id,
      themes,
      keymaps: keymaps.keymapKeys,
      languages,
      locales,
      openWith,
      commands: keymaps.commands,
      contribution: deepFreeze({
        pluginId: manifest.id,
        commands: keymaps.contributionCommands,
        keys: keymaps.contributionKeys,
        menuItems: keymaps.menuItems,
        keymapKeys: keymaps.keymapKeys,
      }),
      configuration,
      warnings: Object.freeze([...warnings]),
    })
    if (errors.length) return { ok: false, errors: [...errors] }
    return { ok: true, compiled }
  } catch (caught) {
    if (caught === FAIL) return { ok: false, errors: [...errors] }
    errors.push({ path: '$', code: 'compile.fatal', message: (caught as Error).message })
    return { ok: false, errors: [...errors] }
  }
}
