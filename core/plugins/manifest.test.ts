import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { completeManifest, hostileManifests, minimalManifest } from '../../fixtures/plugins.ts'
import { parseManifest, type PluginManifest } from './manifest.ts'

function accepted(raw: unknown): PluginManifest {
  const result = parseManifest(raw)
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  expect(structure(typeof raw === 'string' ? JSON.parse(raw) : raw, schema)).toBe(true)
  return result.manifest
}
function rejected(raw: unknown, code?: string, path?: string) {
  const result = parseManifest(raw)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Accepted hostile data')
  expect(result.errors.length).toBeGreaterThan(0)
  for (const error of result.errors) {
    expect(error.code).toMatch(/^manifest\.[a-zA-Z.]+$/)
    expect(error.path).toMatch(/^\$/)
    expect(error.message).not.toMatch(/[\r\n]/)
  }
  if (code) expect(result.errors[0].code).toBe(code)
  if (path) expect(result.errors[0].path).toBe(path)
  return result.errors[0]
}
it('accepts minimal and complete level 0 manifests as data and JSON text', () => {
  for (const raw of [minimalManifest(), completeManifest()]) {
    expect(accepted(raw).hasCode).toBe(false)
    expect(accepted(JSON.stringify(raw))).toEqual({ ...raw, hasCode: false })
  }
  const manifest = accepted(completeManifest())
  expect(manifest.contributes.configuration?.properties.contrast.type).toBe('enum')
  expect(manifest.contributes.configuration?.properties.contrast.renamedFrom).toBe('old-contrast')
})
it('recognizes a code entry without running anything', () => {
  expect(accepted({ ...minimalManifest(), main: 'code/main.js', uses: ['process', 'network'] }).hasCode).toBe(true)
  rejected({ ...minimalManifest(), main: '../main.js' }, 'manifest.path.invalid', '$.main')
})
it.each(hostileManifests())('refuses $name', ({ raw }) => { rejected(raw) })
it.each(['schema', 'id', 'name', 'version', 'publisher', 'engines', 'uses', 'contributes', 'activation', 'files'])('requires %s', field => {
  const raw: Record<string, unknown> = minimalManifest(); delete raw[field]
  rejected(raw, 'manifest.field.required', `$.${field}`)
})
it('reports stable codes, field paths and the corrective rule', () => {
  rejected({ ...minimalManifest(), id: 'Acme.sample' }, 'manifest.id.invalid', '$.id')
  rejected({ ...minimalManifest(), uses: ['network', 'network'] }, 'manifest.uses.duplicate', '$.uses')
  rejected({ ...minimalManifest(), version: '1.2' }, 'manifest.version.invalid', '$.version')
  const error = rejected({ ...minimalManifest(), contributes: { secret: [] } }, 'manifest.field.unknown', '$.contributes.secret')
  expect(error.message).toContain('secret'); expect(error.message).toContain('strict')
  rejected({ ...minimalManifest(), 'bad\nfield': true }, 'manifest.field.unknown')
  rejected({ ...minimalManifest(), activation: ['onFile:test'] }, 'manifest.activation.unknown', '$.activation.0')
  rejected({ ...minimalManifest(), contributes: { configuration: { title: 'Sample', properties: { action: { type: 'action', label: 'action', default: '' } } } } }, 'manifest.configuration.type.unsupported')
})
it('makes a detached, deeply frozen result and keeps strings as text', () => {
  const raw = completeManifest(), manifest = accepted(raw)
  expect(manifest).not.toBe(raw)
  raw.publisher.name = 'changed'; raw.contributes.themes[0].tokens = 'changed.json'
  raw.contributes.configuration.properties.items.default.push('changed')
  expect(manifest.publisher.name).toBe('Acme')
  expect(manifest.contributes.themes?.[0].tokens).toBe('themes/dark.json')
  expect(manifest.contributes.configuration?.properties.items.default).toEqual(['one'])
  expect(manifest.contributes.configuration?.properties.text.default).toBe('<b>plain text</b>')
  const check = (value: unknown) => { if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(check) } }
  check(manifest)
})
it('never invokes a getter or Proxy trap, including nested data', () => {
  const getter = vi.fn(() => 'bad'), trap = vi.fn(() => [])
  const raw = minimalManifest()
  Object.defineProperty(raw.publisher, 'name', { enumerable: true, get: getter })
  rejected(raw, 'manifest.accessor.forbidden'); expect(getter).not.toHaveBeenCalled()
  rejected({ ...minimalManifest(), contributes: new Proxy({}, { ownKeys: trap }) }, 'manifest.data.invalid')
  expect(trap).not.toHaveBeenCalled()
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke()
  rejected(proxy, 'manifest.data.invalid')
})
it('enforces node, depth, array, prototype, descriptor and byte budgets', () => {
  rejected({ ...minimalManifest(), evil: Array.from({ length: 25 }, () => Array(1000).fill(0)) }, 'manifest.nodes.limit')
  rejected({ ...minimalManifest(), description: 'é'.repeat(251) }, 'manifest.string.invalid')
  rejected({ ...minimalManifest(), evil: Object.create({ inherited: true }) }, 'manifest.prototype.invalid')
  rejected({ ...minimalManifest(), evil: Object.defineProperty({}, 'hidden', { value: 1 }) }, 'manifest.accessor.forbidden')
  rejected({ ...minimalManifest(), evil: { [Symbol('bad')]: 1 } }, 'manifest.property.forbidden')
  const array: unknown[] = []; Object.defineProperty(array, 'x', { value: 1, enumerable: true })
  rejected({ ...minimalManifest(), evil: array }, 'manifest.array.invalid')
  rejected({ ...minimalManifest(), evil: NaN }, 'manifest.data.invalid')
  rejected({ ...minimalManifest(), evil: () => 1 }, 'manifest.data.invalid')
  rejected('not JSON', 'manifest.json.invalid')
  const raw = JSON.stringify({ ...minimalManifest(), evil: Array(1000).fill('x'.repeat(270)) })
  expect(Buffer.byteLength(raw)).toBeGreaterThan(256 * 1024)
  rejected(raw, 'manifest.size.limit')
})
it('allows configured 4 KB strings and 1,000-item lists without changing the gate defaults', () => {
  const raw = completeManifest()
  raw.contributes.configuration.properties.text.default = 'x'.repeat(4096)
  raw.contributes.configuration.properties.items.default = Array(1000).fill('a')
  accepted(raw)
  raw.contributes.configuration.properties.text.default = 'é'.repeat(2049)
  rejected(raw, 'manifest.string.limit')
})
it('enforces depth 8 at the boundary before reporting unknown fields', () => {
  const nested = (depth: number): unknown => depth === 0 ? 0 : { child: nested(depth - 1) }
  rejected({ ...minimalManifest(), extra: nested(7) }, 'manifest.field.unknown', '$.extra')
  rejected({ ...minimalManifest(), extra: nested(8) }, 'manifest.depth.limit', `$.extra${'.child'.repeat(8)}`)
})
it('reports the actual language field for invalid and duplicate locales', () => {
  const raw = completeManifest()
  rejected({ ...raw, contributes: { locales: [{ language: 42, label: 'Locale', file: 'locale.json' }] } }, 'manifest.string.invalid', '$.contributes.locales.0.language')
  raw.contributes.locales.push({ ...raw.contributes.locales[0] })
  rejected(raw, 'manifest.contribution.duplicate', '$.contributes.locales.1.language')
})
it('diagnoses a wrong boolean default at default with the expected type', () => {
  const raw = completeManifest()
  const changed = { ...raw.contributes.configuration.properties.enabled, default: 'true' }
  const error = rejected({ ...raw, contributes: { configuration: { title: 'Sample', properties: { enabled: changed } } } }, 'manifest.configuration.default.invalid', '$.contributes.configuration.properties.enabled.default')
  expect(error.message).toContain('boolean')
})
it('diagnoses an empty command category at its category field', () => {
  const raw = completeManifest(); raw.contributes.commands[0].category = ' '
  rejected(raw, 'manifest.string.invalid', '$.contributes.commands.0.category')
})
it('diagnoses exec program and args separately using the shared run validator', () => {
  const raw = completeManifest(); raw.contributes.commands[0].exec.program = './tool'
  rejected(raw, 'manifest.execution.invalid', '$.contributes.commands.0.exec.program')
  raw.contributes.commands[0].exec.program = 'tool'; raw.contributes.commands[0].exec.args = Array(65).fill('arg')
  rejected(raw, 'manifest.execution.invalid', '$.contributes.commands.0.exec.args')
})
it('checks every contribution shape, ownership, duplicate and activation reference', () => {
  const cases: Array<(raw: ReturnType<typeof completeManifest>) => void> = [
    r => { r.contributes.themes.push({ ...r.contributes.themes[0] }) },
    r => { r.contributes.themes[0].base = 'other' },
    r => { r.contributes.themes[0].tokens = 'theme.js' },
    r => { r.contributes.keymaps[0].keys = '../keys.json' },
    r => { r.contributes.languages[0].extensions = []; r.contributes.languages[0].filenames = [] },
    r => { r.contributes.languages[0].extensions = ['sol'] },
    r => { r.contributes.languages[0].filenames = ['../file'] },
    r => { r.contributes.openWith[0].program = './tool' },
    r => { r.contributes.openWith[0].args = Array(65).fill('arg') },
    r => { r.contributes.commands[0].id = 'other.plugin:hello' },
    r => { r.contributes.commands[0].when = 'enabled; evil' },
    r => { r.contributes.commands[0].keys = ['Ctrl+'] },
    r => { r.contributes.commands[0].menu.menu = 'context/tree' },
    r => { r.contributes.commands[0].exec.program = './tool' },
    r => { r.contributes.locales[0].language = 'not a tag' },
    r => { r.contributes.locales[0].file = 'lang.js' },
    r => { r.activation.push('onTheme:missing') },
    r => { r.activation.push(r.activation[0]) },
  ]
  for (const mutate of cases) { const raw = completeManifest(); mutate(raw); rejected(raw) }
  const raw = completeManifest(); raw.contributes.commands[0].keys = ['Ctrl+Q']
  accepted(raw) // Reserved chords are the installer's concern, not the manifest's.
})
it('limits every contribution list to 100, languages matches to 50, and rejects extra fields at every level', () => {
  for (const name of ['themes', 'keymaps', 'languages', 'openWith', 'commands', 'locales'] as const) {
    const raw = completeManifest()
    const items = raw.contributes[name] as unknown[]
    rejected({ ...raw, contributes: { ...raw.contributes, [name]: Array(101).fill(items[0]) } }, 'manifest.list.invalid', `$.contributes.${name}`)
    rejected({ ...raw, contributes: { ...raw.contributes, [name]: [{ ...(items[0] as object), unknown: true }] } }, 'manifest.field.unknown', `$.contributes.${name}.0.unknown`)
  }
  const raw = completeManifest(); raw.contributes.languages[0].extensions = Array(51).fill('.sol')
  rejected(raw, 'manifest.list.invalid')
  rejected({ ...minimalManifest(), publisher: { id: 'other', name: 'Other' } }, 'manifest.id.publisher')
  rejected({ ...minimalManifest(), engines: { folderBrowser: '^1.0.0', api: 1 } }, 'manifest.engines.range.invalid')
  rejected({ ...minimalManifest(), engines: { folderBrowser: '1.0.0', api: 2 } }, 'manifest.engines.api.invalid')
  rejected({ ...minimalManifest(), publisher: { id: 'acme', name: 'Acme', key: 'ed25519:123' } }, 'manifest.publisher.key.invalid')
})
it('checks configuration metadata, bounds, defaults and forbidden patterns', () => {
  const property = (p: unknown) => ({ ...minimalManifest(), contributes: { configuration: { title: 'Settings', properties: { value: p } } } })
  for (const p of [
    { type: 'boolean', label: 's', default: 'true' }, { type: 'number', label: 's', default: 3, min: 4 },
    { type: 'number', label: 's', default: 3, min: 4, max: 2 }, { type: 'number', label: 's', default: 3, step: 0 },
    { type: 'string', label: 's', default: 'abc', maxLength: 2 }, { type: 'list', label: 's', default: [1] },
    { type: 'list', label: 's', default: ['a'], maxItems: 0 }, { type: 'colour', label: 's', default: 'red' },
    { type: 'boolean', label: 's', default: false, min: 0 }, { type: 'string', label: 's', default: '', pattern: 'a+' },
    { type: 'string', label: 's', default: '', scope: 'folder' }, { type: 'boolean', label: 's', default: false, sensitive: 'yes' },
    { type: 'enum', label: 's', default: 'a', values: ['a'], valueLabels: [] },
    { type: 'enum', label: 's', default: 'b', values: ['a'], valueLabels: ['a'] },
    { type: 'string', label: 's', default: '', renamedFrom: '../x' },
    { type: 'boolean', label: 's', default: true, enabledWhen: 'eval(x)' },
  ]) rejected(property(p))
  accepted(property({ type: 'string', label: 's', default: 'multiline\ntext' }))
  accepted({ ...minimalManifest(), contributes: { commands: [{ id: 'acme.sample:hello', title: 'Hello' }], configuration: { title: 'Sample', properties: { 'acme.sample:value': { type: 'boolean', default: true, label: 's' } } } } })
  rejected({ ...minimalManifest(), contributes: { configuration: { title: 'Sample', properties: { 'other.plugin:value': { type: 'boolean', default: true, label: 's' } } } } })
})

type Schema = { $schema?: string; $defs?: Record<string, Schema>; $ref?: string; type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean | Schema; items?: Schema }
const schema = JSON.parse(readFileSync(new URL('../../docs/schema/plugin.schema.json', import.meta.url), 'utf8')) as Schema
/** Structural fallback only: package.json has no JSON Schema validator. */
function structure(value: unknown, rule: Schema): boolean {
  if (rule.$ref) return structure(value, schema.$defs![rule.$ref.split('/').at(-1)!])
  if (Array.isArray(value) && rule.items) return value.every(item => structure(item, rule.items!))
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true
  const data = value as Record<string, unknown>
  if (rule.required?.some(key => !Object.hasOwn(data, key))) return false
  for (const [key, child] of Object.entries(data)) {
    const childRule = rule.properties?.[key] ?? rule.additionalProperties
    if (childRule === false) return false
    if (childRule && typeof childRule === 'object' && !structure(child, childRule)) return false
  }
  return true
}
it('keeps schema required/allowed keys aligned with every valid fixture (structural fallback)', () => {
  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
  expect(schema.additionalProperties).toBe(false)
  expect(schema.required).toEqual(['schema', 'id', 'name', 'version', 'publisher', 'engines', 'uses', 'contributes', 'activation', 'files'])
  expect(Object.keys(schema.properties!)).toEqual(['schema', 'id', 'name', 'version', 'publisher', 'description', 'license', 'homepage', 'engines', 'uses', 'contributes', 'activation', 'files', 'main'])
  expect(Object.keys(schema.properties!.contributes.properties!)).toEqual(['themes', 'keymaps', 'languages', 'openWith', 'commands', 'locales', 'configuration'])
  for (const raw of [minimalManifest(), completeManifest(), { ...completeManifest(), main: 'main.js' }]) expect(structure(raw, schema)).toBe(true)
  for (const key of schema.required!) { const raw: Record<string, unknown> = minimalManifest(); delete raw[key]; expect(structure(raw, schema)).toBe(false) }
  for (const raw of [{ ...minimalManifest(), unknown: true }, { ...minimalManifest(), contributes: { unknown: [] } }, { ...minimalManifest(), publisher: { id: 'acme', name: 'Acme', unknown: '' } }, { ...minimalManifest(), contributes: { configuration: { title: 'Sample', properties: { p: { type: 'string', label: 'p', default: '', pattern: 'a+' } } } } }]) expect(structure(raw, schema)).toBe(false)
})
