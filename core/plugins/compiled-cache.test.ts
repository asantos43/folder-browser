import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { completeManifest } from '../../fixtures/plugins.ts'
import { parseManifest } from './manifest.ts'
import { compilePlugin, type CompiledPlugin } from './compile.ts'
import { cacheKey, toCatalogEntry, writePayload, readPayload, writeCatalog, readCatalog, removePayload, createPayloadGeneration } from './compiled-cache.ts'
import { CACHE_SCHEMA, CATALOG_BYTE_LIMIT, PAYLOAD_BYTE_LIMIT, GENERATION_BYTE_LIMIT, resolvePluginText } from './runtime-types.ts'
import type { CacheKey } from './runtime-types.ts'

let root: string, compiled: CompiledPlugin
const key = cacheKey({ appVersion: '0.1.3', pluginId: 'acme.sample', version: '1.0.0', manifestSha256: `sha256:${'a'.repeat(64)}` })
const payloadFile = (identity = key) => path.join(root, `${createHash('sha256').update(JSON.stringify(cacheKey(identity))).digest('hex')}.json`)
async function compileFixture(raw: ReturnType<typeof completeManifest> & { texts?: CompiledPlugin['texts'] } = completeManifest(), extraFiles: Record<string, string> = {}, compiler = compilePlugin): Promise<CompiledPlugin> {
  raw.contributes.locales[0].language = 'fr'
  raw.activation = raw.activation.map(s => s === 'onLocale:pt-BR' ? 'onLocale:fr' : s)
  const parsed = parseManifest(raw)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed))
  const files: Record<string, string> = { 'themes/dark.json': '{"bg":"#123456"}', 'keymaps/default.json': '[{"command":"acme.sample:hello","key":"Mod+Alt+J"}]', 'locales/pt-BR.json': '{"hello":"Bonjour"}', ...extraFiles }
  const result = await compiler(parsed.manifest, { readFile: async file => Buffer.from(files[file]), knownCommands: new Set(), knownLanguages: new Set(['javascript']), builtinExtensions: new Set(), declaredTokens: new Set(['bg']), knownLocaleKeys: new Set(['hello']) })
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result.compiled
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.delegate/cache-test-'))
  compiled = await compileFixture()
})

it('roundtrips an isolated owner dictionary and leaves legacy payloads unchanged', async () => {
  const raw = completeManifest()
  const texts = { 'owner.title': { en: 'Title', 'pt-BR': 'Título' }, portuguese: { 'pt-BR': 'Português' } }
  const owned = await compileFixture({ ...raw, texts })
  await writePayload(root, key, owned)
  const result = await readPayload(root, key)
  expect(result.hit).toBe(true)
  if (!result.hit) throw new Error(result.reason)
  expect(result.compiled.texts).toEqual(texts)
  expect(Object.getPrototypeOf(result.compiled.texts)).toBe(null)
  expect(Object.isFrozen(result.compiled.texts?.['owner.title'])).toBe(true)
  expect(resolvePluginText(result.compiled.texts, 'owner.title', 'pt-BR')).toBe('Título')
  expect(resolvePluginText(result.compiled.texts, 'portuguese', 'en')).toBe('Português')
  expect(result.compiled.locales).toEqual(compiled.locales)
  expect(toCatalogEntry(owned, key, 'Sample')).toEqual(toCatalogEntry(compiled, key, 'Sample'))
  await writePayload(root, key, compiled)
  const legacy = await readPayload(root, key)
  expect(legacy).toEqual({ hit: true, compiled })
  if (legacy.hit) expect(legacy.compiled).not.toHaveProperty('texts')
})
it('versions the owner dictionary cache and refuses the previous schema with a reason', async () => {
  expect(CACHE_SCHEMA).toBe(2)
  const oldKey = cacheKey({ ...key, schema: 1 })
  await fs.writeFile(payloadFile(oldKey), JSON.stringify({ key: oldKey, compiled }))
  expect(await readPayload(root, oldKey)).toEqual({ hit: false, reason: 'unsupported cache schema' })
  await fs.writeFile(path.join(root, 'catalog.json'), JSON.stringify({ schema: 1, entries: [] }))
  const catalog = await readCatalog(root)
  expect(catalog.hit).toBe(false)
  if (!catalog.hit) expect(catalog.reason).toBeTruthy()
})
const invalidOwnerTexts = [
  { name: 'utf8', texts: { edge: { en: 'é'.repeat(1025) } }, reason: 'owner text byte limit' },
  { name: 'keys', texts: Object.fromEntries(Array.from({ length: 3001 }, (_, i) => [`key${i}`, {}])), reason: 'owner text key limit' },
  { name: 'dictionary-bytes', texts: Object.fromEntries(Array.from({ length: 260 }, (_, i) => [`key${i}`, { en: 'x'.repeat(2048) }])), reason: 'owner dictionary byte limit' },
  { name: 'controls', texts: { edge: { 'pt-BR': 'bad\ntext' } }, reason: 'owner text control' },
  { name: 'key-syntax', texts: { 'bad\nkey': { en: 'Hello' } }, reason: 'invalid owner text key' },
  { name: 'language', texts: { edge: { fr: 'Bonjour' } }, reason: 'unknown field' },
]
it.each(invalidOwnerTexts)('revalidates owner $name on cache write and read', async ({ texts, reason }) => {
  await expect(writePayload(root, key, { ...compiled, texts } as CompiledPlugin)).rejects.toThrow(reason)
  await writePayload(root, key, compiled)
  const data = JSON.parse(await fs.readFile(payloadFile(), 'utf8'))
  data.compiled.texts = texts
  await fs.writeFile(payloadFile(), JSON.stringify(data))
  expect(await readPayload(root, key)).toEqual({ hit: false, reason })
})
it('accepts exact owner cache boundaries and TAB', async () => {
  const texts = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`key${i}`, { en: '' }]))
  texts.key0 = { en: 'é'.repeat(1024) }
  texts.key1 = { en: 'Hello\tworld' }
  await writePayload(root, key, { ...compiled, texts })
  const result = await readPayload(root, key)
  expect(result.hit).toBe(true)
  if (result.hit) expect(result.compiled.texts).toEqual(texts)
})

it('detects undone owner format, compilation, cache and fallback guards through source-copy mutations', async () => {
  const directory = path.join(process.cwd(), 'core/plugins')
  const sources = Object.fromEntries(await Promise.all(['manifest', 'compile', 'runtime-types', 'compiled-cache'].map(async file => [file, await fs.readFile(path.join(directory, `${file}.ts`), 'utf8') as string]))) as Record<string, string>
  const raw = { ...completeManifest(), texts: { 'owner.title': { en: 'Title', 'pt-BR': 'Título' } } }
  const owned = await compileFixture(raw)
  const cases = [
    { file: 'manifest', before: 'if (data.texts !== undefined) data.texts = pluginTexts(data.texts)', after: '', probe: 'manifest-controls' },
    { file: 'manifest', before: 'if (byteLength(translation) > PLUGIN_TEXT_BYTE_LIMIT)', after: 'if (false)', probe: 'manifest-utf8' },
    { file: 'manifest', before: 'if (keys.length > PLUGIN_TEXT_KEY_LIMIT)', after: 'if (false)', probe: 'manifest-keys' },
    { file: 'manifest', before: 'if (PLUGIN_TEXT_CONTROLS.test(translation))', after: 'if (false)', probe: 'manifest-controls' },
    { file: 'manifest', before: 'if (!PLUGIN_TEXT_KEY_PATTERN.test(key))', after: 'if (false)', probe: 'manifest-key-syntax' },
    { file: 'compile', before: "...(manifest.texts === undefined ? {} : { texts: Object.fromEntries(Object.entries(manifest.texts).map(([key, entry]) => [key, { ...entry }])) }),", after: '', probe: 'compiled-texts' },
    { file: 'compile', before: 'if (io.knownLocaleKeys.has(key))', after: 'if (false)', probe: 'builtin' },
    { file: 'compiled-cache', before: "texts: ownerTexts,", after: "texts: record({}, [], record({ en: text, 'pt-BR': text }, ['en', 'pt-BR'])),", probe: 'cache-controls' },
    { file: 'compiled-cache', before: "if (Buffer.byteLength(data, 'utf8') > PLUGIN_TEXT_BYTE_LIMIT)", after: 'if (false)', probe: 'cache-utf8' },
    { file: 'compiled-cache', before: 'if (keys.length > PLUGIN_TEXT_KEY_LIMIT)', after: 'if (false)', probe: 'cache-keys' },
    { file: 'compiled-cache', before: "if (Buffer.byteLength(JSON.stringify(data), 'utf8') > PLUGIN_TEXT_DICTIONARY_LIMIT)", after: 'if (false)', probe: 'cache-dictionary-bytes' },
    { file: 'compiled-cache', before: 'if (PLUGIN_TEXT_CONTROLS.test(data))', after: 'if (false)', probe: 'cache-controls' },
    { file: 'compiled-cache', before: 'if (keys.some(key => !PLUGIN_TEXT_KEY_PATTERN.test(key)))', after: 'if (false)', probe: 'cache-key-syntax' },
    { file: 'compiled-cache', before: "if (identity.schema !== CACHE_SCHEMA) fail('unsupported cache schema')", after: '', probe: 'old-schema' },
    { file: 'runtime-types', before: 'export const CACHE_SCHEMA = 2', after: 'export const CACHE_SCHEMA = 1', probe: 'schema-version' },
    { file: 'runtime-types', before: "return selected || entry?.en || entry?.['pt-BR'] || label || key", after: "return entry?.en || entry?.['pt-BR'] || label || key", probe: 'fallback-selected' },
    { file: 'runtime-types', before: "return selected || entry?.en || entry?.['pt-BR'] || label || key", after: "return selected || entry?.['pt-BR'] || entry?.en || label || key", probe: 'fallback-en' },
    { file: 'runtime-types', before: "return selected || entry?.en || entry?.['pt-BR'] || label || key", after: 'return selected || entry?.en || label || key', probe: 'fallback-pt' },
    { file: 'runtime-types', before: "return selected || entry?.en || entry?.['pt-BR'] || label || key", after: "return selected || entry?.en || entry?.['pt-BR'] || key", probe: 'fallback-label' },
    { file: 'runtime-types', before: "return selected || entry?.en || entry?.['pt-BR'] || label || key", after: "return selected || entry?.en || entry?.['pt-BR'] || label || ''", probe: 'fallback-key' },
  ]
  for (const mutation of cases) {
    const source = sources[mutation.file]
    expect(source).toContain(mutation.before)
    const copy = path.join(directory, `${mutation.file}.mutation-${randomUUID()}.ts`)
    try {
      await fs.writeFile(copy, source.replace(mutation.before, mutation.after))
      const mutant = await import(/* @vite-ignore */ copy)
      if (mutation.probe.startsWith('manifest-')) {
        const invalid = invalidOwnerTexts.find(item => item.name === mutation.probe.slice(9))!
        expect(parseManifest({ ...completeManifest(), texts: invalid.texts }).ok).toBe(false)
        expect(() => expect(mutant.parseManifest({ ...completeManifest(), texts: invalid.texts }).ok).toBe(false), mutation.probe).toThrow()
      } else if (mutation.probe === 'compiled-texts') {
        const changed = await compileFixture(raw, {}, mutant.compilePlugin)
        expect(() => expect(changed.texts).toEqual(owned.texts)).toThrow()
      } else if (mutation.probe === 'builtin') {
        const assertConflict = async (compiler: typeof compilePlugin) => {
          await expect(compileFixture({ ...completeManifest(), texts: { hello: { en: 'Override' } } }, {}, compiler)).rejects.toThrow('compile.texts.builtin-conflict')
        }
        await assertConflict(compilePlugin)
        await expect(assertConflict(mutant.compilePlugin)).rejects.toThrow()
      } else if (mutation.probe.startsWith('cache-')) {
        const invalid = invalidOwnerTexts.find(item => item.name === mutation.probe.slice(6))!
        await writePayload(root, key, compiled)
        const data = JSON.parse(await fs.readFile(payloadFile(), 'utf8'))
        data.compiled.texts = invalid.texts
        await fs.writeFile(payloadFile(), JSON.stringify(data))
        expect((await readPayload(root, key)).hit).toBe(false)
        const changed = await mutant.readPayload(root, key)
        expect(() => expect(changed.hit).toBe(false), mutation.probe).toThrow()
      } else if (mutation.probe === 'old-schema') {
        const oldKey = cacheKey({ ...key, schema: 1 })
        await fs.writeFile(payloadFile(oldKey), JSON.stringify({ key: oldKey, compiled }))
        const changed = await mutant.readPayload(root, oldKey)
        expect(() => expect(changed.hit).toBe(false)).toThrow()
      } else if (mutation.probe === 'schema-version') {
        expect(() => expect(mutant.CACHE_SCHEMA).toBe(2)).toThrow()
      } else {
        const texts = { both: { en: 'English', 'pt-BR': 'Português' }, portuguese: { 'pt-BR': 'Só português' } }
        const parameters: [typeof texts | undefined, string, string, string?] = mutation.probe === 'fallback-selected' ? [texts, 'both', 'pt-BR'] : mutation.probe === 'fallback-en' ? [texts, 'both', 'fr'] : mutation.probe === 'fallback-pt' ? [texts, 'portuguese', 'en'] : mutation.probe === 'fallback-label' ? [texts, 'missing', 'en', 'Label'] : [undefined, 'missing', 'en']
        expect(() => expect(mutant.resolvePluginText(...parameters)).toBe(resolvePluginText(...parameters)), mutation.probe).toThrow()
      }
    } finally { await fs.rm(copy, { force: true }) }
  }
})
function schemeFixture(bindingCounts: number[]) {
  const raw = completeManifest(), files: Record<string, string> = {}
  raw.contributes.keymaps = bindingCounts.map((count, index) => {
    const id = `scheme-${index}`, keys = `keymaps/${id}.json`
    raw.files[keys] = `sha256:${'12'.repeat(32)}`
    files[keys] = JSON.stringify(Array.from({ length: count }, (_, i) => ({ command: 'acme.sample:hello', key: ['Mod+Alt+J', 'Mod+Alt+K'][i] })))
    return { id, label: `Scheme ${index}`, keys }
  })
  raw.activation = raw.activation.filter(item => !item.startsWith('onKeymap:'))
  return { raw, files, expected: raw.contributes.keymaps.map(({ id, label }) => ({ id, label })) }
}
it.each([[0], [2], [0, 2], [2, 0]])('roundtrips declared key schemes independently of %j bindings', async (...counts: number[]) => {
  const fixture = schemeFixture(counts), plugin = await compileFixture(fixture.raw, fixture.files)
  expect(plugin.keySchemes).toEqual(fixture.expected)
  expect(Object.isFrozen(plugin.keySchemes)).toBe(true)
  const entry = toCatalogEntry(plugin, key, 'Sample')
  expect(entry.keySchemes).toEqual(fixture.expected)
  expect(entry.counts.keySchemes).toBe(counts.length)
  expect(entry.counts.keymaps).toBe(counts.reduce((a, b) => a + b, 0))
  await writePayload(root, key, plugin); await writeCatalog(root, [entry])
  const payload = await readPayload(root, key), catalog = await readCatalog(root)
  expect(payload.hit).toBe(true); expect(catalog.hit).toBe(true)
  if (!payload.hit || !catalog.hit) throw new Error('Expected both cache hits')
  expect(payload.compiled.keySchemes).toEqual(fixture.expected)
  expect(catalog.entries[0].keySchemes).toEqual(fixture.expected)
  expect(catalog.entries[0].counts.keySchemes).toBe(counts.length)
  expect(catalog.entries[0].counts.keymaps).toBe(counts.reduce((a, b) => a + b, 0))
})
it.each(['duplicate', 'unknown', 'label-type', 'count'])('strictly refuses %s key scheme catalog/payload metadata', async kind => {
  await writePayload(root, key, compiled); await writeCatalog(root, [toCatalogEntry(compiled, key, 'Sample')])
  for (const file of [payloadFile(), path.join(root, 'catalog.json')]) {
    const data = JSON.parse(await fs.readFile(file, 'utf8'))
    const metadata = data.compiled ?? data.entries[0]
    if (kind === 'duplicate') metadata.keySchemes.push(metadata.keySchemes[0])
    if (kind === 'unknown') metadata.keySchemes[0].extra = true
    if (kind === 'label-type') metadata.keySchemes[0].label = 42
    if (kind === 'count') {
      if (metadata.counts) metadata.counts.keySchemes++
      else delete metadata.keySchemes
    }
    await fs.writeFile(file, JSON.stringify(data))
  }
  expect((await readPayload(root, key)).hit).toBe(false)
  expect((await readCatalog(root)).hit).toBe(false)
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })

it('roundtrips every contribution into new deeply frozen, null-prototype records and removes payloads', async () => {
  await writePayload(root, key, compiled)
  const result = await readPayload(root, key)
  expect(result.hit).toBe(true)
  if (!result.hit) throw new Error(result.reason)
  expect(result.compiled).toEqual(compiled)
  expect(result.compiled).not.toBe(compiled)
  function check(value: unknown): void {
    if (!value || typeof value !== 'object') return
    expect(Object.isFrozen(value)).toBe(true)
    if (!Array.isArray(value)) expect(Object.getPrototypeOf(value)).toBe(null)
    for (const child of Object.values(value)) check(child)
  }
  check(result.compiled)
  const entry = toCatalogEntry(compiled, key, 'Sample')
  await writeCatalog(root, [entry])
  const catalog = await readCatalog(root)
  expect(catalog).toEqual({ hit: true, entries: [entry] })
  if (catalog.hit) check(catalog.entries)
  expect(entry.ids.keymaps).toEqual(['sample-keys'])
  await removePayload(root, key)
  expect((await readPayload(root, key)).hit).toBe(false)
})
it.each(['schema', 'appVersion', 'pluginId', 'version', 'manifestSha256'] as const)('rejects divergent %s even at the expected filename', async field => {
  await writePayload(root, key, compiled)
  const data = JSON.parse(await fs.readFile(payloadFile(), 'utf8'))
  data.key[field] = field === 'schema' ? CACHE_SCHEMA + 1 : field === 'manifestSha256' ? `sha256:${'b'.repeat(64)}` : field === 'pluginId' ? 'acme.other' : '2.0.0'
  await fs.writeFile(payloadFile(), JSON.stringify(data))
  expect(await readPayload(root, key)).toEqual({ hit: false, reason: 'identity mismatch' })
})
it('treats a different requested version or manifest as a miss', async () => {
  await writePayload(root, key, compiled)
  for (const change of [{ version: '2.0.0' }, { manifestSha256: `sha256:${'b'.repeat(64)}` }]) expect((await readPayload(root, cacheKey({ ...key, ...change }))).hit).toBe(false)
})
it.each(['__proto__', 'constructor', 'prototype'])('refuses forbidden %s inside dictionaries', async name => {
  await writePayload(root, key, compiled)
  const raw = await fs.readFile(payloadFile(), 'utf8')
  await fs.writeFile(payloadFile(), raw.replace('"Bonjour"', `"Bonjour","${name}":"bad"`))
  expect(await readPayload(root, key)).toEqual({ hit: false, reason: 'forbidden property' })
})
it.each(['top', 'nested', 'type', 'json'])('refuses %s corruption', async kind => {
  await writePayload(root, key, compiled)
  const data = JSON.parse(await fs.readFile(payloadFile(), 'utf8'))
  if (kind === 'top') data.extra = true
  if (kind === 'nested') data.compiled.commands[0].extra = true
  if (kind === 'type') data.compiled.commands[0].palette = 'true'
  await fs.writeFile(payloadFile(), kind === 'json' ? 'broken {' : JSON.stringify(data))
  const result = await readPayload(root, key)
  expect(result.hit).toBe(false)
  if (kind === 'top' || kind === 'nested') expect(result).toEqual({ hit: false, reason: 'unknown field' })
})
it('does not invoke accessors or accept proxies, sparse arrays, inherited objects or unknown writer fields', async () => {
  const getter = vi.fn(() => 'text')
  const badArg = Object.defineProperty({}, 'kind', { enumerable: true, get: getter })
  for (const bad of [{ ...compiled, extra: true }, { ...compiled, themes: Array(1) }, Object.assign(Object.create({ inherited: true }), compiled),
    new Proxy(compiled, {}), { ...compiled, openWith: [{ ...compiled.openWith[0], args: [badArg] }] }]) {
    await expect(writePayload(root, key, bad as CompiledPlugin)).rejects.toThrow()
  }
  expect(getter).not.toHaveBeenCalled()
})
it.each(['file', 'root', 'ancestor'])('refuses %s symlinks for reading, writing and removal', async kind => {
  await writePayload(root, key, compiled)
  let targetRoot = root
  if (kind === 'file') {
    await fs.rename(payloadFile(), path.join(root, 'real'))
    await fs.symlink(path.join(root, 'real'), payloadFile())
  } else {
    await fs.mkdir(path.join(root, 'real-dir'))
    await fs.symlink(path.join(root, 'real-dir'), path.join(root, 'link'), 'dir')
    targetRoot = path.join(root, 'link', ...(kind === 'ancestor' ? ['child'] : []))
  }
  expect((await readPayload(targetRoot, key)).hit).toBe(false)
  await expect(writePayload(targetRoot, key, compiled)).rejects.toThrow('unsafe')
  await expect(removePayload(targetRoot, key)).rejects.toThrow('unsafe')
})
it('refuses traversal in root and identity without touching outside files', async () => {
  const traversal = path.join(root, 'child') + '/../escape'
  expect((await readPayload(traversal, key)).hit).toBe(false)
  await expect(writePayload(traversal, key, compiled)).rejects.toThrow('unsafe path')
  for (const pluginId of ['../evil', 'acme/evil', 'constructor']) expect(() => cacheKey({ ...key, pluginId })).toThrow()
})
it.each(['payload', 'catalog'])('accepts exact %s byte ceiling; rejects +1 and a giant sparse file before read/parse', async kind => {
  await writePayload(root, key, compiled)
  await writeCatalog(root, [toCatalogEntry(compiled, key, 'Sample')])
  const file = kind === 'payload' ? payloadFile() : path.join(root, 'catalog.json')
  const limit = kind === 'payload' ? PAYLOAD_BYTE_LIMIT : CATALOG_BYTE_LIMIT
  const read = () => kind === 'payload' ? readPayload(root, key) : readCatalog(root)
  const raw = await fs.readFile(file)
  await fs.writeFile(file, Buffer.concat([raw, Buffer.alloc(limit - raw.length, 32)]))
  expect((await read()).hit).toBe(true)
  await fs.appendFile(file, ' ')
  const parse = vi.spyOn(JSON, 'parse'), open = fs.open.bind(fs), reads = vi.fn()
  vi.spyOn(fs, 'open').mockImplementation(async (...parameters: Parameters<typeof fs.open>) => {
    const handle = await open(...parameters)
    const original = handle.read.bind(handle)
    handle.read = ((...params: Parameters<typeof handle.read>) => { reads(); return original(...params) }) as typeof handle.read
    return handle
  })
  expect(await read()).toEqual({ hit: false, reason: 'byte limit' })
  await fs.truncate(file, 1024 * 1024 * 1024)
  expect(await read()).toEqual({ hit: false, reason: 'byte limit' })
  expect(parse).not.toHaveBeenCalled(); expect(reads).not.toHaveBeenCalled()
})
it('enforces writer ceilings and catalog uniqueness/strictness', async () => {
  await expect(writePayload(root, key, { ...compiled, warnings: [{ path: '$', code: 'test', message: 'x'.repeat(PAYLOAD_BYTE_LIMIT) }] })).rejects.toThrow('byte limit')
  const entry = toCatalogEntry(compiled, key, 'Sample')
  await expect(writeCatalog(root, [{ ...entry, name: 'x'.repeat(CATALOG_BYTE_LIMIT) }])).rejects.toThrow('byte limit')
  await expect(writeCatalog(root, [entry, entry])).rejects.toThrow('duplicate')
  await writeCatalog(root, [entry])
  const data = JSON.parse(await fs.readFile(path.join(root, 'catalog.json'), 'utf8')); data.entries[0].extra = true
  await fs.writeFile(path.join(root, 'catalog.json'), JSON.stringify(data))
  expect((await readCatalog(root)).hit).toBe(false)
})
it('keeps the previous payload on interrupted rename, cleans its temporary and ignores crash orphans', async () => {
  await writePayload(root, key, compiled)
  const previous = await fs.readFile(payloadFile())
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('interrupted rename'))
  await expect(writePayload(root, key, { ...compiled, warnings: [] })).rejects.toThrow('interrupted rename')
  expect(await fs.readFile(payloadFile())).toEqual(previous)
  expect((await fs.readdir(root)).filter(n => n.endsWith('.tmp'))).toEqual([])
  await fs.writeFile(path.join(root, '.cache-orphan.tmp'), 'broken')
  expect((await readPayload(root, key)).hit).toBe(true)
  expect((await readCatalog(root)).hit).toBe(false)
})
it('bounds a generation at exactly 32 MiB, charges repeated identities once and refuses the next byte', async () => {
  const generation = createPayloadGeneration(1)
  const oversized = { ...compiled, warnings: [{ path: '$', code: 'test', message: 'x'.repeat(PAYLOAD_BYTE_LIMIT - 10000) }] }
  for (let i = 0; i < GENERATION_BYTE_LIMIT / PAYLOAD_BYTE_LIMIT; i++) {
    const identity = cacheKey({ ...key, version: `1.0.${i}` })
    await writePayload(root, identity, oversized)
    const file = payloadFile(identity), bytes = await fs.readFile(file)
    await fs.appendFile(file, ' '.repeat(PAYLOAD_BYTE_LIMIT - bytes.length))
    expect((await readPayload(root, identity, generation)).hit).toBe(true)
  }
  expect((await readPayload(root, key, generation)).hit).toBe(true)
  const next = cacheKey({ ...key, version: '2.0.0' })
  await writePayload(root, next, compiled)
  expect(await readPayload(root, next, generation)).toEqual({ hit: false, reason: 'generation byte limit' })
  expect((await readPayload(root, next, createPayloadGeneration(2))).hit).toBe(true)
})
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
it('proves ceiling/link/prototype/unknown-field/identity assertions fail on mutated source copies', async () => {
  const sourceFile = path.join(process.cwd(), 'core/plugins/compiled-cache.ts')
  const source = await fs.readFile(sourceFile, 'utf8')
  const cases = [
    { name: 'ceiling', edits: [["if (stat.size > limit) fail('byte limit')", ''], ["if (offset > limit || offset !== stat.size)", 'if (offset !== stat.size)']] },
    { name: 'link', edits: [["if (stat.isSymbolicLink() || !stat.isDirectory())", 'if (!stat.isDirectory() && !stat.isSymbolicLink())']] },
    { name: 'prototype', edits: [["typeof key !== 'string' || forbidden.has(key)", "typeof key !== 'string'"]] },
    { name: 'unknown-field', edits: [["if (!shape) fail('unknown field')", 'if (!shape) continue']] },
    { name: 'identity', edits: [["if (Object.keys(identity).some(k => identity[k as keyof CacheKey] !== data.key[k as keyof CacheKey]) || data.compiled.pluginId !== identity.pluginId || data.compiled.contribution.pluginId !== identity.pluginId)", 'if (false)']] },
  ]
  for (const mutation of cases) {
    await writePayload(root, key, compiled)
    let targetRoot = root
    if (mutation.name === 'ceiling') {
      const bytes = await fs.readFile(payloadFile())
      await fs.appendFile(payloadFile(), ' '.repeat(PAYLOAD_BYTE_LIMIT + 1 - bytes.length))
    } else if (mutation.name === 'link') {
      await fs.symlink(root, path.join(root, 'mutant-link'), 'dir')
      targetRoot = path.join(root, 'mutant-link')
    } else {
      const data = JSON.parse(await fs.readFile(payloadFile(), 'utf8'))
      if (mutation.name === 'prototype') Object.defineProperty(data.compiled.locales[0].translations, '__proto__', { value: 'bad', enumerable: true })
      if (mutation.name === 'unknown-field') data.compiled.commands[0].extra = true
      if (mutation.name === 'identity') data.key.version = '2.0.0'
      await fs.writeFile(payloadFile(), JSON.stringify(data))
    }
    const assertMiss = (result: Awaited<ReturnType<typeof readPayload>>) => expect(result.hit).toBe(false)
    assertMiss(await readPayload(targetRoot, key))
    let altered = source
    for (const [before, after] of mutation.edits) {
      expect(altered).toContain(before)
      altered = altered.replace(before, after)
    }
    const copy = path.join(path.dirname(sourceFile), `compiled-cache.mutation-${randomUUID()}.ts`)
    try {
      await fs.writeFile(copy, altered)
      const mutant = await import(/* @vite-ignore */ copy) as typeof import('./compiled-cache.ts')
      const result = await mutant.readPayload(targetRoot, key)
      expect(() => assertMiss(result), mutation.name).toThrow()
    } finally { await fs.rm(copy, { force: true }) }
  }
})
it('proves new key scheme assertions detect compiler/catalog source-copy mutations', async () => {
  const fixture = schemeFixture([2, 0]), plugin = await compileFixture(fixture.raw, fixture.files)
  const compilerFile = path.join(process.cwd(), 'core/plugins/compile.ts')
  const compilerSource = await fs.readFile(compilerFile, 'utf8')
  const cacheFile = path.join(process.cwd(), 'core/plugins/compiled-cache.ts')
  const cacheSource = await fs.readFile(cacheFile, 'utf8')
  const cases = [
    { file: compilerFile, source: compilerSource, before: 'keySchemes: keymaps.keySchemes,', after: 'keySchemes: keymaps.keySchemes.filter(s => keymaps.keymapKeys.some(k => k.source.keymapId === s.id)),', name: 'empty' },
    { file: compilerFile, source: compilerSource, before: 'keySchemes: keymaps.keySchemes,', after: 'keySchemes: [...keymaps.keySchemes].reverse(),', name: 'order' },
    { file: cacheFile, source: cacheSource, before: 'keySchemes: data.keySchemes,', after: 'keySchemes: data.keymaps.map(k => ({ id: k.source.keymapId, label: k.source.keymapLabel })),', name: 'bindings-as-schemes' },
    { file: cacheFile, source: cacheSource, before: 'keySchemes: data.keySchemes.length', after: 'keySchemes: data.keymaps.length', name: 'scheme-count' },
    { file: cacheFile, source: cacheSource, before: "if (new Set(schemes.map(scheme => scheme.id)).size !== schemes.length) fail('duplicate key scheme')", after: '', name: 'duplicate' },
  ]
  expect(plugin.keySchemes).toEqual(fixture.expected)
  expect(toCatalogEntry(plugin, key, 'Sample').keySchemes).toEqual(fixture.expected)
  for (const mutation of cases) {
    expect(mutation.source).toContain(mutation.before)
    const copy = path.join(path.dirname(mutation.file), `${path.basename(mutation.file, '.ts')}.mutation-${randomUUID()}.ts`)
    try {
      await fs.writeFile(copy, mutation.source.replace(mutation.before, mutation.after))
      if (mutation.file === compilerFile) {
        const mutant = await import(/* @vite-ignore */ copy) as typeof import('./compile.ts')
        const changed = await compileFixture(fixture.raw, fixture.files, mutant.compilePlugin)
        expect(() => expect(changed.keySchemes).toEqual(fixture.expected), mutation.name).toThrow()
      } else {
        const mutant = await import(/* @vite-ignore */ copy) as typeof import('./compiled-cache.ts')
        if (mutation.name === 'duplicate') {
          await writePayload(root, key, plugin)
          const data = JSON.parse(await fs.readFile(payloadFile(), 'utf8'))
          data.compiled.keySchemes.push(data.compiled.keySchemes[0])
          await fs.writeFile(payloadFile(), JSON.stringify(data))
          expect((await readPayload(root, key)).hit).toBe(false)
          const result = await mutant.readPayload(root, key)
          expect(() => expect(result.hit).toBe(false)).toThrow()
        } else {
          // A mismatched count is only visible when scheme and binding counts differ.
          const single = { ...plugin, keySchemes: [plugin.keySchemes[0]] }
          expect(() => {
            const entry = mutant.toCatalogEntry(mutation.name === 'scheme-count' ? single : plugin, key, 'Sample')
            expect(entry.keySchemes).toEqual(mutation.name === 'scheme-count' ? single.keySchemes : fixture.expected)
            expect(entry.counts.keySchemes).toBe(mutation.name === 'scheme-count' ? 1 : 2)
          }, mutation.name).toThrow()
        }
      }
    } finally { await fs.rm(copy, { force: true }) }
  }
})
it('reports typical payload read, parse and validation/freezing costs separately', async () => {
  await writePayload(root, key, compiled)
  const io: number[] = [], parse: number[] = [], validation: number[] = []
  let started = 0, closed = 0, parsed = 0, parseCost = 0
  const open = fs.open.bind(fs), jsonParse = JSON.parse
  vi.spyOn(fs, 'open').mockImplementation(async (...parameters: Parameters<typeof fs.open>) => {
    const handle = await open(...parameters), close = handle.close.bind(handle)
    handle.close = async () => { await close(); closed = performance.now() }
    return handle
  })
  vi.spyOn(JSON, 'parse').mockImplementation((...parameters: Parameters<typeof JSON.parse>) => {
    const start = performance.now(), result = jsonParse(...parameters)
    parsed = performance.now(); parseCost = parsed - start
    return result
  })
  for (let round = 0; round < 21; round++) {
    started = performance.now()
    const result = await readPayload(root, key), ended = performance.now()
    expect(result.hit).toBe(true)
    if (round >= 7) { io.push(closed - started); parse.push(parseCost); validation.push(ended - parsed) }
  }
  console.info('compiled-cache parts', JSON.stringify({ readMs: median(io), parseMs: median(parse), validationFreezeMs: median(validation) }))
})
it('meets catalog/write budgets and payload CPU budget (21 rounds of 100 real hits)', async () => {
  const entries = Array.from({ length: 50 }, (_, i) => {
    const identity: CacheKey = cacheKey({ ...key, pluginId: `acme.p${i}` })
    return toCatalogEntry({ ...compiled, pluginId: identity.pluginId, contribution: { ...compiled.contribution, pluginId: identity.pluginId } }, identity, `Plugin ${i}`)
  })
  await writeCatalog(root, entries); await writePayload(root, key, compiled)
  const catalog: number[] = [], payload: number[] = [], payloadProcessCpu: number[] = [], payloadElapsed: number[] = [], write: number[] = []
  // Measure the thread executing the cache, excluding libuv disk-worker CPU and wait.
  // Older Node 22 builds retain the conservative whole-process fallback.
  const cpuUsage = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage.bind(process) : process.cpuUsage.bind(process)
  for (let round = 0; round < 7; round++) {
    const cpu = process.cpuUsage()
    expect((await readCatalog(root)).hit).toBe(true)
    const used = process.cpuUsage(cpu); catalog.push((used.user + used.system) / 1000)
    const writing = performance.now(); await writePayload(root, key, compiled); write.push(performance.now() - writing)
  }
  for (let i = 0; i < 100; i++) {
    const result = await readPayload(root, key)
    if (!result.hit) throw new Error(result.reason)
  }
  for (let round = 0; round < 21; round++) {
    const cpu = cpuUsage(), processCpu = process.cpuUsage(), start = performance.now()
    for (let i = 0; i < 100; i++) {
      const result = await readPayload(root, key)
      if (!result.hit) throw new Error(result.reason)
    }
    const used = cpuUsage(cpu), processUsed = process.cpuUsage(processCpu)
    payload.push((used.user + used.system) / 1000 / 100)
    payloadProcessCpu.push((processUsed.user + processUsed.system) / 1000 / 100)
    payloadElapsed.push((performance.now() - start) / 100)
  }
  const measured = { catalogCpuMs: median(catalog), payloadCpuMs: median(payload), payloadProcessCpuMs: median(payloadProcessCpu), payloadElapsedMs: median(payloadElapsed), writeMs: median(write) }
  console.info('compiled-cache budgets', JSON.stringify(measured))
  expect(measured.catalogCpuMs).toBeLessThan(5)
  expect(measured.payloadCpuMs).toBeLessThan(0.5)
  expect(measured.writeMs).toBeLessThan(20)
}, 30000)
