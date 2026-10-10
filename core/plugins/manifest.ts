import { types } from 'node:util'
import { safeRelative } from '../zip.ts'
import { validateContribution, type Contribution, type MenuPoint } from '../contributions/types.ts'
import { parseCommandTemplate, validProgram } from '../run.ts'
import { parseRange, parseSemver } from './semver.ts'

export const MANIFEST_TEXT_LIMIT = 256 * 1024
export const MANIFEST_NODE_LIMIT = 20000
const forbidden = new Set(['__proto__', 'constructor', 'prototype'])
const itemId = /^[a-z][a-z0-9-]{0,63}$/
const localeTag = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/
export const declaredUses = ['files.read', 'files.write', 'network', 'process', 'ui', 'commands', 'storage'] as const
export type DeclaredUse = typeof declaredUses[number]
export interface ManifestError { path: string; code: string; message: string }
export interface Execution { program: string; args: string[] }
export interface Theme { id: string; label: string; base: 'light' | 'dark'; tokens: string }
export interface Keymap { id: string; label: string; keys: string }
export interface Language { id: string; label: string; extensions?: string[]; filenames?: string[]; languageId: string }
export interface OpenWith extends Execution { id: string; label: string; extensions?: string[] }
export interface Locale { language: string; label: string; file: string }
export interface ManifestCommand {
  id: string; title: string; category?: string; when?: string; palette?: boolean; keys?: string[]
  menu?: { menu: MenuPoint; group: string; order: number }; exec?: Execution
}
export interface ConfigurationProperty {
  type: 'boolean' | 'enum' | 'number' | 'string' | 'colour' | 'list'
  default: boolean | number | string | string[]; label: string; description?: string
  values?: (string | number | boolean)[]; valueLabels?: string[]; min?: number; max?: number; step?: number
  maxLength?: number; maxItems?: number; group?: string; order?: number; keywords?: string[]
  enabledWhen?: string; scope?: 'user'; reload?: boolean; sensitive?: boolean; renamedFrom?: string
}
export interface ManifestContributes {
  themes?: Theme[]; keymaps?: Keymap[]; languages?: Language[]; openWith?: OpenWith[]
  commands?: ManifestCommand[]; locales?: Locale[]
  configuration?: { title: string; properties: Record<string, ConfigurationProperty> }
}
export interface PluginManifest {
  schema: 1; id: string; name: string; version: string; publisher: { id: string; name: string; key?: string }
  description?: string; license?: string; homepage?: string; engines: { folderBrowser: string; api: 1 }
  uses: DeclaredUse[]; contributes: ManifestContributes; activation: string[]; files: Record<string, string>
  main?: string; readonly hasCode: boolean
}
type ObjectData = Record<string, unknown>
class Invalid extends Error {
  readonly detail: ManifestError
  constructor(detail: ManifestError) { super(detail.message); this.detail = detail }
}
function bad(path: string, code: string, fix: string): never {
  throw new Invalid({ path, code: `manifest.${code}`, message: `${path}: ${fix}`.replace(/[\r\n\u2028\u2029]/g, ' ') })
}
const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

/** Inspect descriptors before reading values; proxies cannot impersonate plain JSON. */
function copyData(raw: unknown): unknown {
  let nodes = 0, size = 0
  const charge = (bytes: number, path: string) => { size += bytes; if (size > MANIFEST_TEXT_LIMIT) bad(path, 'size.limit', 'use at most 256 KB of JSON') }
  function visit(value: unknown, path: string, depth: number): unknown {
    if (++nodes > MANIFEST_NODE_LIMIT) bad(path, 'nodes.limit', 'use at most 20,000 data nodes')
    if (depth > 8) bad(path, 'depth.limit', 'use at most 8 nesting levels')
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) { charge(JSON.stringify(value).length, path); return value }
    if (typeof value === 'string') {
      if (value.length > MANIFEST_TEXT_LIMIT) bad(path, 'size.limit', 'use at most 256 KB of JSON')
      charge(byteLength(JSON.stringify(value)), path)
      if (byteLength(value) > 4096) bad(path, 'string.limit', 'use strings of at most 4 KB')
      return value
    }
    if (!value || typeof value !== 'object' || types.isProxy(value)) bad(path, 'data.invalid', 'use plain JSON data, without Proxy objects')
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value)
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) bad(path, 'prototype.invalid', 'use plain objects or arrays')
    if (array && value.length > 1000) bad(path, 'array.limit', 'use at most 1,000 list items')
    const keys = Reflect.ownKeys(value)
    if (keys.length > MANIFEST_NODE_LIMIT) bad(path, 'nodes.limit', 'use at most 20,000 data nodes')
    const out: ObjectData | unknown[] = array ? [] : {}
    charge(2, path)
    let entries = 0
    for (const key of keys) {
      if (array && key === 'length') continue
      if (typeof key !== 'string' || forbidden.has(key)) bad(`${path}.${String(key)}`, 'property.forbidden', 'remove this forbidden property')
      if (byteLength(key) > 4096) bad(path, 'string.limit', 'use property names of at most 4 KB')
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) bad(`${path}.${key}`, 'array.invalid', 'use only indexed array elements')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) bad(`${path}.${key}`, 'accessor.forbidden', 'replace accessors with plain JSON values')
      charge((array ? 0 : byteLength(JSON.stringify(key)) + 1) + (entries++ ? 1 : 0), path)
      ;(out as ObjectData)[key] = visit(descriptor.value, `${path}.${key}`, depth + 1)
    }
    if (array && ((out as unknown[]).length !== value.length || keys.length !== value.length + 1)) bad(path, 'array.sparse', 'fill every array index')
    return out
  }
  return visit(raw, '$', 0)
}
function object(value: unknown, path: string, allowed: readonly string[], required: readonly string[] = []): ObjectData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad(path, 'object.invalid', 'use an object')
  const obj = value as ObjectData
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) bad(`${path}.${key}`, 'field.unknown', `remove unknown field "${key}"; schema 1 is strict`)
  for (const key of required) if (!Object.hasOwn(obj, key)) bad(`${path}.${key}`, 'field.required', `add required field "${key}"`)
  return obj
}
function text(value: unknown, path: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || byteLength(value) > max || value.includes('\0')) bad(path, 'string.invalid', `use nonempty text of at most ${max} UTF-8 bytes without NUL`)
  return value
}
function list(value: unknown, path: string, max = 100): unknown[] {
  if (!Array.isArray(value) || value.length > max) bad(path, 'list.invalid', `use a list of at most ${max} items`)
  return value
}
function pathName(value: unknown, path: string, json = false): string {
  const name = text(value, path, 256)
  if ([...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || safeRelative(name) === null || name.endsWith('/') || (json && !name.endsWith('.json'))) bad(path, 'path.invalid', `use a safe relative ${json ? '.json file ' : ''}path without controls, .., absolute paths or backslashes`)
  return name
}
function id(value: unknown, path: string): string {
  const result = text(value, path, 64)
  if (!itemId.test(result) || forbidden.has(result)) bad(path, 'id.invalid', 'use a lowercase id starting with a letter (letters, digits, hyphens)')
  return result
}
function extensions(value: unknown, path: string): string[] {
  return list(value, path, 50).map((v, i) => {
    const ext = text(v, `${path}.${i}`, 40)
    if (!/^\.[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(ext)) bad(`${path}.${i}`, 'extension.invalid', 'use an extension beginning with a dot, without path separators')
    return ext
  })
}
function execution(value: unknown, path: string): Execution {
  const data = object(value, path, ['program', 'args'], ['program', 'args'])
  try {
    const result = parseCommandTemplate({ id: 'manifest', name: 'manifest', ...data })
    return { program: result.program, args: result.args }
  } catch {
    if (!validProgram(data.program)) bad(`${path}.program`, 'execution.invalid', 'use a PATH name or absolute program of at most 4 KB without NUL')
    bad(`${path}.args`, 'execution.invalid', 'use at most 64 literal arguments of 4 KB without NUL')
  }
}
function gate(data: ObjectData, path: string): Contribution {
  try { return validateContribution(data, { stringLength: 4096, arrayLength: 1000, allowTextControls: true }) }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid contribution'
    if (/Invalid default for setting|invalid default data/.test(message) && Array.isArray(data.settings)) bad(`${path}.default`, 'configuration.default.invalid', `use a valid ${data.settings[0].type} default`)
    bad(path, 'contribution.invalid', `${message}; correct the declaration`)
  }
}
const propertyFields = ['type', 'default', 'label', 'description', 'values', 'valueLabels', 'min', 'max', 'step', 'maxLength', 'maxItems', 'group', 'order', 'keywords', 'enabledWhen', 'scope', 'reload', 'sensitive', 'renamedFrom']
function configuration(value: unknown, pluginId: string, path: string): { title: string; properties: Record<string, ConfigurationProperty> } {
  const config = object(value, path, ['title', 'properties'], ['title', 'properties'])
  text(config.title, `${path}.title`, 80)
  const props = object(config.properties, `${path}.properties`, Object.keys((config.properties && typeof config.properties === 'object') ? config.properties : {}))
  if (Object.keys(props).length > 100) bad(`${path}.properties`, 'configuration.limit', 'declare at most 100 properties')
  const ownedIds = new Set<string>()
  for (const [key, raw] of Object.entries(props)) {
    const p = `${path}.properties.${key}`, data = object(raw, p, propertyFields, ['type', 'default', 'label'])
    const full = key.includes(':') ? key : `${pluginId}:${key}`
    const local = full.slice(pluginId.length + 1)
    if (!full.startsWith(`${pluginId}:`) || !itemId.test(local) || forbidden.has(local)) bad(p, 'configuration.id.invalid', `use a local setting id or ${pluginId}:<id>`)
    if (ownedIds.has(full)) bad(p, 'configuration.duplicate', 'declare each setting once')
    ownedIds.add(full)
    const type = text(data.type, `${p}.type`, 20)
    if (!['boolean', 'enum', 'number', 'string', 'colour', 'list'].includes(type)) bad(`${p}.type`, 'configuration.type.unsupported', 'planned for a later step')
    text(data.label, `${p}.label`, 80)
    for (const field of ['description', 'group', 'enabledWhen', 'renamedFrom']) if (data[field] !== undefined) text(data[field], `${p}.${field}`, field === 'description' ? 500 : 256)
    if (data.renamedFrom !== undefined && (!itemId.test(data.renamedFrom as string) || forbidden.has(data.renamedFrom as string))) bad(`${p}.renamedFrom`, 'configuration.rename.invalid', 'use a local setting id')
    for (const field of ['reload', 'sensitive']) if (data[field] !== undefined && typeof data[field] !== 'boolean') bad(`${p}.${field}`, 'configuration.flag.invalid', 'use a boolean')
    if (data.scope !== undefined && data.scope !== 'user') bad(`${p}.scope`, 'configuration.scope.invalid', 'use user scope in schema 1')
    for (const field of ['min', 'max', 'step', 'order', 'maxLength', 'maxItems']) if (data[field] !== undefined && (typeof data[field] !== 'number' || !Number.isFinite(data[field]))) bad(`${p}.${field}`, 'configuration.number.invalid', 'use a finite number')
    if (data.step !== undefined && (type !== 'number' || (data.step as number) <= 0)) bad(`${p}.step`, 'configuration.step.invalid', 'use a positive number step')
    for (const [field, limit, expected] of [['maxLength', 4096, 'string'], ['maxItems', 1000, 'list']] as const) {
      if (data[field] !== undefined && (type !== expected || !Number.isInteger(data[field]) || (data[field] as number) < 0 || (data[field] as number) > limit)) bad(`${p}.${field}`, 'configuration.bound.invalid', `use an integer from 0 to ${limit} for ${expected}`)
    }
    if ((data.min !== undefined || data.max !== undefined) && type !== 'number') bad(p, 'configuration.bound.invalid', 'min and max apply only to numbers')
    if ((data.values !== undefined || data.valueLabels !== undefined) && type !== 'enum') bad(p, 'configuration.enum.invalid', 'values and valueLabels apply only to enum')
    if (type === 'enum') {
      const values = list(data.values, `${p}.values`, 1000)
      if (!values.length || new Set(values).size !== values.length) bad(`${p}.values`, 'configuration.enum.invalid', 'provide nonempty unique values')
      const labels = list(data.valueLabels, `${p}.valueLabels`, 1000)
      if (labels.length !== values.length) bad(`${p}.valueLabels`, 'configuration.enum.invalid', 'provide one locale label per value')
      labels.forEach((v, i) => text(v, `${p}.valueLabels.${i}`, 80))
    }
    if (type === 'string' && (typeof data.default !== 'string' || byteLength(data.default) > (data.maxLength as number ?? 4096))) bad(`${p}.default`, 'configuration.default.invalid', 'use a string within maxLength (at most 4 KB)')
    if (type === 'list' && (!Array.isArray(data.default) || data.default.length > (data.maxItems as number ?? 1000))) bad(`${p}.default`, 'configuration.default.invalid', 'use a list within maxItems (at most 1,000 items)')
    gate({ pluginId, settings: [{ id: full, type: type === 'enum' ? 'choice' : type, default: data.default, category: data.group ?? pluginId, label: data.label,
      ...(data.description === undefined ? {} : { description: data.description }), ...(data.values === undefined ? {} : { choices: data.values }),
      ...(data.valueLabels === undefined ? {} : { choiceLabels: data.valueLabels }), ...(data.min === undefined ? {} : { min: data.min }), ...(data.max === undefined ? {} : { max: data.max }),
      ...(data.keywords === undefined ? {} : { keywords: data.keywords }), ...(data.reload === undefined ? {} : { restart: data.reload }), ...(data.sensitive === undefined ? {} : { safety: data.sensitive }) }] }, p)
    if (data.enabledWhen !== undefined) {
      const match = /^([a-z][a-z0-9-]*)\s*(?:==|!=)\s*(?:'[^'\r\n]*'|true|false|-?\d+(?:\.\d+)?)$/.exec(data.enabledWhen as string)
      if (!match || (!Object.hasOwn(props, match[1]) && !Object.hasOwn(props, `${pluginId}:${match[1]}`))) bad(`${p}.enabledWhen`, 'configuration.condition.invalid', 'use a plain comparison with a setting declared in this plugin')
    }
  }
  return config as unknown as { title: string; properties: Record<string, ConfigurationProperty> }
}
function contributions(value: unknown, pluginId: string): ManifestContributes {
  const path = '$.contributes', data = object(value, path, ['themes', 'keymaps', 'languages', 'openWith', 'commands', 'locales', 'configuration'])
  for (const name of ['themes', 'keymaps', 'languages', 'openWith', 'commands', 'locales'] as const) {
    if (data[name] === undefined) continue
    const ids = new Set<string>()
    list(data[name], `${path}.${name}`).forEach((raw, index) => {
      const p = `${path}.${name}.${index}`
      const fields = name === 'themes' ? ['id', 'label', 'base', 'tokens'] : name === 'keymaps' ? ['id', 'label', 'keys'] : name === 'languages' ? ['id', 'label', 'extensions', 'filenames', 'languageId'] : name === 'openWith' ? ['id', 'label', 'program', 'args', 'extensions'] : name === 'commands' ? ['id', 'title', 'category', 'when', 'palette', 'keys', 'menu', 'exec'] : ['language', 'label', 'file']
      const item = object(raw, p, fields, name === 'commands' ? ['id', 'title'] : name === 'locales' ? ['language', 'label', 'file'] : ['id', 'label'])
      const identifierPath = `${p}.${name === 'locales' ? 'language' : 'id'}`
      const identifier = text(item[name === 'locales' ? 'language' : 'id'], identifierPath, name === 'commands' ? 130 : 64)
      if (name !== 'commands' && name !== 'locales') id(identifier, `${p}.id`)
      if (ids.has(identifier)) bad(identifierPath, 'contribution.duplicate', 'use a unique id within this list')
      ids.add(identifier)
      text(item[name === 'commands' ? 'title' : 'label'], `${p}.${name === 'commands' ? 'title' : 'label'}`, 80)
      if (name === 'themes') {
        if (!['light', 'dark'].includes(item.base as string)) bad(`${p}.base`, 'theme.base.invalid', 'use light or dark')
        pathName(item.tokens, `${p}.tokens`, true)
      }
      if (name === 'keymaps') pathName(item.keys, `${p}.keys`, true)
      if (name === 'languages') {
        text(item.languageId, `${p}.languageId`, 40)
        if ((!Array.isArray(item.extensions) || !item.extensions.length) && (!Array.isArray(item.filenames) || !item.filenames.length)) bad(p, 'language.matches.required', 'provide at least one extension or filename')
        if (item.filenames !== undefined) list(item.filenames, `${p}.filenames`, 50).forEach((v, i) => { const f = text(v, `${p}.filenames.${i}`, 256); if (f === '.' || f === '..' || /[\\/]/.test(f)) bad(`${p}.filenames.${i}`, 'language.filename.invalid', 'use a filename without path separators') })
      }
      if ((name === 'languages' || name === 'openWith') && item.extensions !== undefined) extensions(item.extensions, `${p}.extensions`)
      if (name === 'openWith') execution({ program: item.program, args: item.args }, p)
      if (name === 'locales') {
        if (identifier.length > 12 || !localeTag.test(identifier)) bad(`${p}.language`, 'locale.invalid', 'use a simple BCP47 tag of at most 12 characters')
        pathName(item.file, `${p}.file`, true)
      }
      if (name === 'commands') {
        if (!identifier.startsWith(`${pluginId}:`) || !itemId.test(identifier.slice(pluginId.length + 1)) || forbidden.has(identifier.slice(pluginId.length + 1))) bad(`${p}.id`, 'command.id.invalid', `use ${pluginId}: followed by a lowercase local item id`)
        const { exec, keys, menu, ...command } = item
        if (command.category === undefined) command.category = pluginId
        text(command.category, `${p}.category`)
        const menuItem = menu === undefined ? undefined : object(menu, `${p}.menu`, ['menu', 'group', 'order'], ['menu', 'group', 'order'])
        gate({ pluginId, commands: [command], ...(keys === undefined ? {} : { keys: list(keys, `${p}.keys`, 100).map((key, index) => ({ command: identifier, key: text(key, `${p}.keys.${index}`) })) }),
          ...(menuItem === undefined ? {} : { menuItems: [{ id: `${identifier}-menu`, command: identifier, point: menuItem.menu, group: menuItem.group, order: menuItem.order }] }) }, p)
        if (exec !== undefined) execution(exec, `${p}.exec`)
      }
    })
  }
  if (data.configuration !== undefined) configuration(data.configuration, pluginId, `${path}.configuration`)
  return data as ManifestContributes
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
/** Parse bounded JSON text or untrusted JSON data; never retain or execute the input. */
export function parseManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; errors: ManifestError[] } {
  try {
    if (typeof raw === 'string') {
      if (byteLength(raw) > MANIFEST_TEXT_LIMIT) bad('$', 'size.limit', 'use at most 256 KB of JSON text')
      try { raw = JSON.parse(raw) } catch { bad('$', 'json.invalid', 'provide valid JSON text') }
    }
    const data = object(copyData(raw), '$', ['schema', 'id', 'name', 'version', 'publisher', 'description', 'license', 'homepage', 'engines', 'uses', 'contributes', 'activation', 'files', 'main'], ['schema', 'id', 'name', 'version', 'publisher', 'engines', 'uses', 'contributes', 'activation', 'files'])
    if (data.schema !== 1) bad('$.schema', 'schema.invalid', 'use schema 1')
    const pluginId = data.id
    if (typeof pluginId !== 'string' || pluginId.length > 64 || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(pluginId) || pluginId.split('.').some(part => forbidden.has(part))) bad('$.id', 'id.invalid', 'use publisher.name in lowercase, without empty segments, at most 64 bytes')
    text(data.name, '$.name', 80)
    if (!parseSemver(text(data.version, '$.version', 128))) bad('$.version', 'version.invalid', 'use a strict semver such as 1.2.3')
    const publisher = object(data.publisher, '$.publisher', ['id', 'name', 'key'], ['id', 'name'])
    const publisherId = id(publisher.id, '$.publisher.id'); text(publisher.name, '$.publisher.name', 80)
    if (!pluginId.startsWith(`${publisherId}.`)) bad('$.id', 'id.publisher', 'prefix the plugin id with publisher.id and a dot')
    if (publisher.key !== undefined && !/^ed25519:[a-fA-F0-9]{64}$/.test(text(publisher.key, '$.publisher.key', 72))) bad('$.publisher.key', 'publisher.key.invalid', 'use ed25519: followed by 64 hexadecimal digits')
    for (const [field, max] of [['description', 500], ['license', 80], ['homepage', 2048]] as const) if (data[field] !== undefined) text(data[field], `$.${field}`, max)
    if (data.homepage !== undefined) {
      let url: URL; try { url = new URL(data.homepage as string) } catch { bad('$.homepage', 'homepage.invalid', 'use an absolute https URL') }
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) bad('$.homepage', 'homepage.invalid', 'use an https URL without credentials')
    }
    const engines = object(data.engines, '$.engines', ['folderBrowser', 'api'], ['folderBrowser', 'api'])
    if (engines.api !== 1) bad('$.engines.api', 'engines.api.invalid', 'use API 1')
    if (!parseRange(text(engines.folderBrowser, '$.engines.folderBrowser', 256))) bad('$.engines.folderBrowser', 'engines.range.invalid', 'use an exact semver or space-separated semver comparators')
    const uses = list(data.uses, '$.uses', 7), seenUses = new Set<string>()
    for (const use of uses) {
      if (typeof use !== 'string' || !declaredUses.includes(use as DeclaredUse)) bad('$.uses', 'uses.unknown', `use only ${declaredUses.join(', ')}`)
      if (seenUses.has(use)) bad('$.uses', 'uses.duplicate', 'declare each use only once')
      seenUses.add(use)
    }
    const contributes = contributions(data.contributes, pluginId)
    const activation = list(data.activation, '$.activation'), events = new Set<string>()
    const collections: Record<string, string[]> = { onTheme: contributes.themes?.map(v => v.id) ?? [], onCommand: contributes.commands?.map(v => v.id) ?? [], onKeymap: contributes.keymaps?.map(v => v.id) ?? [], onLanguage: contributes.languages?.map(v => v.id) ?? [], onLocale: contributes.locales?.map(v => v.language) ?? [], onOpenWith: contributes.openWith?.map(v => v.id) ?? [] }
    activation.forEach((v, i) => {
      const event = text(v, `$.activation.${i}`, 160), colon = event.indexOf(':'), kind = event.slice(0, colon), target = event.slice(colon + 1)
      if (event !== 'onStartupFinished' && !Object.hasOwn(collections, kind)) bad(`$.activation.${i}`, 'activation.unknown', 'use a level 0 event; code events come in phase 3')
      if (event !== 'onStartupFinished' && !collections[kind].includes(target)) bad(`$.activation.${i}`, 'activation.reference', 'reference an item declared in this plugin')
      if (events.has(event)) bad(`$.activation.${i}`, 'activation.duplicate', 'declare each event only once')
      events.add(event)
    })
    const files = object(data.files, '$.files', Object.keys((data.files && typeof data.files === 'object') ? data.files : {}))
    if (Object.keys(files).length > 1000) bad('$.files', 'files.limit', 'declare at most 1,000 files')
    for (const [name, hash] of Object.entries(files)) {
      pathName(name, `$.files.${name}`)
      if (typeof hash !== 'string' || !/^sha256:[a-fA-F0-9]{64}$/.test(hash)) bad(`$.files.${name}`, 'files.hash.invalid', 'use sha256: followed by 64 hexadecimal digits')
    }
    if (data.main !== undefined) pathName(data.main, '$.main')
    return { ok: true, manifest: freeze({ ...data, contributes, hasCode: data.main !== undefined } as unknown as PluginManifest) }
  } catch (error) {
    return { ok: false, errors: [error instanceof Invalid ? error.detail : { path: '$', code: 'manifest.data.invalid', message: '$: use bounded plain JSON data' }] }
  }
}
