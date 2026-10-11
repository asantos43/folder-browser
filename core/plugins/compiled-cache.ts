import fs from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { types } from 'node:util'
import type { CompiledPlugin } from './compile.ts'
import { CACHE_SCHEMA, CATALOG_BYTE_LIMIT, PAYLOAD_BYTE_LIMIT, GENERATION_BYTE_LIMIT } from './runtime-types.ts'
import { PLUGIN_TEXT_KEY_LIMIT, PLUGIN_TEXT_BYTE_LIMIT, PLUGIN_TEXT_DICTIONARY_LIMIT, PLUGIN_TEXT_KEY_PATTERN, PLUGIN_TEXT_CONTROLS } from './runtime-types.ts'
import type { CacheKey, CatalogEntry, ContributionKind, PayloadGeneration, PayloadReadResult } from './runtime-types.ts'

type Shape = (value: unknown, depth?: number) => unknown
const forbidden = new Set(['__proto__', 'constructor', 'prototype'])
function fail(reason: string): never { throw new Error(reason) }
const text: Shape = value => typeof value === 'string' ? value : fail('invalid string')
const number: Shape = value => typeof value === 'number' && Number.isFinite(value) ? value : fail('invalid number')
const boolean: Shape = value => typeof value === 'boolean' ? value : fail('invalid boolean')
const enumeration = (...values: unknown[]): Shape => value => values.includes(value) ? value : fail('invalid enum')
function list(shape: Shape): Shape {
  return (value, depth = 0) => {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 20000 || Reflect.ownKeys(value).length !== value.length + 1) fail('invalid list')
    const out = new Array<unknown>(value.length)
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
      if (!descriptor || !('value' in descriptor)) fail('invalid list descriptor')
      out[i] = shape(descriptor.value, depth + 1)
    }
    return Object.freeze(out)
  }
}
function record(fields: Record<string, Shape>, optional: readonly string[] = [], dictionary?: Shape): Shape {
  const required = Object.keys(fields).filter(key => !optional.includes(key))
  return (value, depth = 0) => {
    if (depth > 12 || !value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) fail('invalid object')
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype) fail('invalid object')
    const out: Record<string, unknown> = Object.create(null)
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || forbidden.has(key)) fail('forbidden property')
      const shape = Object.hasOwn(fields, key) ? fields[key] : dictionary
      if (!shape) fail('unknown field')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!descriptor.enumerable || !('value' in descriptor)) fail('invalid descriptor')
      out[key] = shape(descriptor.value, depth + 1)
    }
    for (const key of required) if (!Object.hasOwn(out, key)) fail('missing field')
    return Object.freeze(out)
  }
}
const strings = list(text)
function discriminant(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || types.isProxy(value)) fail('invalid object')
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !('value' in descriptor)) fail('invalid descriptor')
  return descriptor.value
}
const textArg = record({ kind: enumeration('text'), value: text })
const settingArg = record({ kind: enumeration('setting'), key: text })
const markerArg = record({ kind: enumeration('file', 'dir', 'name') })
const arg: Shape = (value, depth) => {
  const kind = discriminant(value, 'kind')
  return (kind === 'text' ? textArg : kind === 'setting' ? settingArg : markerArg)(value, depth)
}
const args = list(arg)
const keyEntry = record({ command: text, key: text, source: record({ keymapId: text, keymapLabel: text }) })
const schemeList = list(record({ id: text, label: text }))
const keySchemes: Shape = (value, depth) => {
  const schemes = schemeList(value, depth) as readonly { id: string; label: string }[]
  if (new Set(schemes.map(scheme => scheme.id)).size !== schemes.length) fail('duplicate key scheme')
  return schemes
}
const commandFields = { id: text, title: text, category: text, when: text, palette: boolean }
const scalar: Shape = v => ['string', 'boolean', 'number'].includes(typeof v) ? (typeof v === 'number' ? number(v) : v) : fail('invalid scalar')
function propertyShape(defaultShape: Shape): Shape {
  return record({ type: enumeration('boolean', 'enum', 'number', 'string', 'colour', 'list'), default: defaultShape, label: text,
    description: text, values: list(scalar), valueLabels: strings, min: number, max: number, step: number, maxLength: number,
    maxItems: number, group: text, order: number, keywords: strings, enabledWhen: text, scope: enumeration('user'), reload: boolean,
    sensitive: boolean, renamedFrom: text }, ['description', 'values', 'valueLabels', 'min', 'max', 'step', 'maxLength', 'maxItems', 'group', 'order', 'keywords', 'enabledWhen', 'scope', 'reload', 'sensitive', 'renamedFrom'])
}
const propertyShapes: Record<string, Shape> = { boolean: propertyShape(boolean), number: propertyShape(number), list: propertyShape(strings), enum: propertyShape(scalar), string: propertyShape(text), colour: propertyShape(text) }
const property: Shape = (value, depth) => {
  const type = discriminant(value, 'type')
  if (typeof type !== 'string' || !Object.hasOwn(propertyShapes, type)) fail('invalid enum')
  return propertyShapes[type](value, depth)
}
const ownerText: Shape = value => {
  const data = text(value) as string
  if (Buffer.byteLength(data, 'utf8') > PLUGIN_TEXT_BYTE_LIMIT) fail('owner text byte limit')
  if (PLUGIN_TEXT_CONTROLS.test(data)) fail('owner text control')
  return data
}
const ownerTextsRecord = record({}, [], record({ en: ownerText, 'pt-BR': ownerText }, ['en', 'pt-BR']))
const ownerTexts: Shape = (value, depth) => {
  const data = ownerTextsRecord(value, depth) as Record<string, unknown>
  const keys = Object.keys(data)
  if (keys.length > PLUGIN_TEXT_KEY_LIMIT) fail('owner text key limit')
  if (keys.some(key => !PLUGIN_TEXT_KEY_PATTERN.test(key))) fail('invalid owner text key')
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > PLUGIN_TEXT_DICTIONARY_LIMIT) fail('owner dictionary byte limit')
  return data
}
const compiledShape = record({
  pluginId: text,
  texts: ownerTexts,
  themes: list(record({ id: text, label: text, base: enumeration('light', 'dark'), tokens: record({}, [], text) })),
  keymaps: list(keyEntry),
  keySchemes,
  languages: list(record({ id: text, label: text, extensions: strings, filenames: strings, languageId: text })),
  locales: list(record({ language: text, label: text, translations: record({}, [], text) })),
  openWith: list(record({ id: text, label: text, extensions: strings, program: text, args })),
  commands: list(record({ ...commandFields, defaultKeys: strings, menu: record({ menu: text, group: text, order: number }), exec: record({ program: text, args }) }, ['when', 'palette', 'menu', 'exec'])),
  contribution: record({ pluginId: text, commands: list(record(commandFields, ['when', 'palette'])), keys: list(record({ command: text, key: text })),
    menuItems: list(record({ id: text, command: text, point: text, group: text, order: number, when: text }, ['when'])), keymapKeys: list(keyEntry) }),
  configuration: list(record({ id: text, property })), warnings: list(record({ path: text, code: text, message: text })),
}, ['texts'])
const keyShape = record({ schema: number, appVersion: text, pluginId: text, version: text, manifestSha256: text })
const payloadShape = record({ key: keyShape, compiled: compiledShape })
/** Identity is data, never a path. A stable hash names the payload file. */
export function cacheKey(input: Omit<CacheKey, 'schema'> & { schema?: number }): CacheKey {
  const key = keyShape({ schema: CACHE_SCHEMA, ...input }) as CacheKey
  if (!Number.isSafeInteger(key.schema) || key.schema < 1 || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/.test(key.pluginId) || key.pluginId.split('.').some(v => forbidden.has(v)) || !/^sha256:[a-f0-9]{64}$/.test(key.manifestSha256)) fail('invalid identity')
  for (const value of [key.appVersion, key.version]) if (!value || value.length > 128 || /[/\\]/.test(value) || value.includes('..')) fail('invalid version')
  return key
}
/** Callers validate the identity once before deriving its filename. */
function filename(key: CacheKey): string { return `${createHash('sha256').update(JSON.stringify(key)).digest('hex')}.json` }
const kinds: readonly ContributionKind[] = ['themes', 'keymaps', 'languages', 'locales', 'openWith', 'commands', 'configuration']
const count: Shape = value => Number.isSafeInteger(value) && (value as number) >= 0 ? value : fail('invalid count')
const catalogShape = record({ key: keyShape, name: text, keySchemes, counts: record(Object.fromEntries([...kinds, 'keySchemes'].map(k => [k, count]))), ids: record(Object.fromEntries(kinds.map(k => [k, strings]))) })
function catalogEntry(raw: unknown): CatalogEntry {
  const entry = catalogShape(raw) as CatalogEntry
  cacheKey(entry.key)
  for (const kind of kinds) if (entry.counts[kind] !== entry.ids[kind].length) fail('invalid catalog counts')
  if (entry.counts.keySchemes !== entry.keySchemes.length) fail('invalid catalog counts')
  return entry
}
/** CompiledPlugin has no display name/version; the manifest metadata is supplied explicitly. */
export function toCatalogEntry(compiled: CompiledPlugin, key: CacheKey, name: string): CatalogEntry {
  const data = compiledShape(compiled) as CompiledPlugin
  if (data.pluginId !== key.pluginId) fail('identity mismatch')
  const ids = Object.fromEntries(kinds.map(kind => [kind, data[kind].map(item => kind === 'keymaps' ? (item as CompiledPlugin['keymaps'][number]).source.keymapId : kind === 'locales' ? (item as CompiledPlugin['locales'][number]).language : (item as { id: string }).id)]))
  return catalogEntry({ key: cacheKey(key), name, keySchemes: data.keySchemes, counts: { ...Object.fromEntries(kinds.map(kind => [kind, data[kind].length])), keySchemes: data.keySchemes.length }, ids })
}

/** Inspect every component, including ancestors of root, before creating or opening anything. */
async function rootAt(root: string, create = false): Promise<string> {
  if (root.split(/[/\\]/).includes('..')) fail('unsafe path')
  const resolved = path.resolve(root)
  let current = path.parse(resolved).root
  const components: string[] = []
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    components.push(current)
  }
  const check = async (component: string) => {
    const stat = await fs.lstat(component)
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('unsafe directory')
  }
  if (create) for (const component of components) {
    await fs.mkdir(component).catch(error => { if (error.code !== 'EEXIST') throw error })
    await check(component)
  } else await Promise.all(components.map(check))
  return resolved
}
async function fileAt(root: string, name: string, create = false): Promise<string> {
  const dir = await rootAt(root, create), file = path.join(dir, name)
  const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) fail('unsafe file')
  return file
}
async function boundedRead(root: string, name: string, limit: number): Promise<Buffer> {
  // POSIX O_NOFOLLOW checks the final component atomically; fstat checks its kind/size.
  // Windows also needs lstat because its open flags do not provide O_NOFOLLOW.
  const file = process.platform === 'win32' ? await fileAt(root, name) : path.join(await rootAt(root), name)
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) fail('unsafe file')
    if (stat.size > limit) fail('byte limit')
    const bytes = Buffer.alloc(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > limit || offset !== stat.size) fail('file changed or byte limit')
    return bytes.subarray(0, offset)
  } finally { await handle.close() }
}
async function atomicWrite(root: string, name: string, data: unknown, limit: number): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(data))
  if (bytes.length > limit) fail('byte limit')
  const dest = await fileAt(root, name, true), temp = await fileAt(root, `.cache-${randomUUID()}.tmp`)
  try {
    const handle = await fs.open(temp, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    await fileAt(root, name)
    await fs.rename(temp, dest)
  } finally { await fs.rm(temp, { force: true }) }
}
export async function writePayload(root: string, key: CacheKey, compiled: CompiledPlugin): Promise<void> {
  const identity = cacheKey(key), data = compiledShape(compiled) as CompiledPlugin
  if (identity.schema !== CACHE_SCHEMA || data.pluginId !== identity.pluginId || data.contribution.pluginId !== identity.pluginId) fail('identity mismatch')
  await atomicWrite(root, filename(identity), { key: identity, compiled: data }, PAYLOAD_BYTE_LIMIT)
}
const generations = new WeakMap<PayloadGeneration, Map<string, number>>()
export function createPayloadGeneration(generation: number): PayloadGeneration {
  if (!Number.isSafeInteger(generation) || generation < 0) fail('invalid generation')
  const token = Object.freeze({ generation }); generations.set(token, new Map()); return token
}
export async function readPayload(root: string, key: CacheKey, generation?: PayloadGeneration): Promise<PayloadReadResult> {
  try {
    const identity = cacheKey(key)
    if (identity.schema !== CACHE_SCHEMA) fail('unsupported cache schema')
    const name = filename(identity)
    const bytes = await boundedRead(root, name, PAYLOAD_BYTE_LIMIT)
    const data = payloadShape(JSON.parse(bytes.toString('utf8'))) as { key: CacheKey; compiled: CompiledPlugin }
    if (Object.keys(identity).some(k => identity[k as keyof CacheKey] !== data.key[k as keyof CacheKey]) || data.compiled.pluginId !== identity.pluginId || data.compiled.contribution.pluginId !== identity.pluginId) fail('identity mismatch')
    if (generation) {
      const admitted = generations.get(generation)
      if (!admitted) fail('invalid generation')
      const id = `${path.resolve(root)}:${name}`
      const total = [...admitted.values()].reduce((a, b) => a + b, 0) - (admitted.get(id) ?? 0) + bytes.length
      if (total > GENERATION_BYTE_LIMIT) fail('generation byte limit')
      admitted.set(id, bytes.length)
    }
    return { hit: true, compiled: data.compiled }
  } catch (error) { return { hit: false, reason: error instanceof Error ? error.message : 'invalid cache' } }
}
export async function writeCatalog(root: string, entries: readonly CatalogEntry[]): Promise<void> {
  const data = entries.map(catalogEntry)
  if (new Set(data.map(e => e.key.pluginId)).size !== data.length) fail('duplicate plugin')
  await atomicWrite(root, 'catalog.json', { schema: CACHE_SCHEMA, entries: data }, CATALOG_BYTE_LIMIT)
}
export async function readCatalog(root: string): Promise<{ hit: true; entries: readonly CatalogEntry[] } | { hit: false; reason: string }> {
  try {
    const raw = record({ schema: enumeration(CACHE_SCHEMA), entries: list(catalogEntry) })(JSON.parse((await boundedRead(root, 'catalog.json', CATALOG_BYTE_LIMIT)).toString('utf8'))) as { entries: CatalogEntry[] }
    if (new Set(raw.entries.map(e => e.key.pluginId)).size !== raw.entries.length) fail('duplicate plugin')
    return { hit: true, entries: raw.entries }
  } catch (error) { return { hit: false, reason: error instanceof Error ? error.message : 'invalid cache' } }
}
export async function removePayload(root: string, key: CacheKey): Promise<void> {
  await fs.rm(await fileAt(root, filename(cacheKey(key))), { force: true })
}
