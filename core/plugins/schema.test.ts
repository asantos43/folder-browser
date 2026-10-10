import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { completeManifest } from '../../fixtures/plugins.ts'
import { parseManifest } from './manifest.ts'

interface Leaf { type?: string; minLength?: number; maxLength?: number; pattern?: string; allOf?: Leaf[] }
type SchemaNode = Leaf & { properties?: Record<string, SchemaNode>; items?: SchemaNode; propertyNames?: SchemaNode; $defs?: Record<string, SchemaNode> }
const schema = JSON.parse(readFileSync(new URL('../../docs/schema/plugin.schema.json', import.meta.url), 'utf8')) as SchemaNode
/** Deliberately a string-leaf evaluator, not a JSON Schema implementation. */
function compileLeaf(leaf: Leaf): (value: unknown) => boolean {
  const pattern = leaf.pattern === undefined ? undefined : new RegExp(leaf.pattern, 'u')
  const other = leaf.allOf?.map(compileLeaf) ?? []
  return value => typeof value === 'string' && (leaf.type === undefined || leaf.type === 'string')
    && (leaf.minLength === undefined || [...value].length >= leaf.minLength)
    && (leaf.maxLength === undefined || [...value].length <= leaf.maxLength)
    && (!pattern || pattern.test(value)) && other.every(test => test(value))
}
const root = schema.properties!, contributes = root.contributes.properties!
const command = contributes.commands.items!.properties!, config = schema.$defs!.configurationProperty.properties!
const rows: Array<{ name: string; leaf: Leaf; value: unknown; valid: boolean; set: (raw: ReturnType<typeof completeManifest>, value: unknown) => void }> = []
function cases(name: string, leaf: Leaf, path: string[], values: Array<[unknown, boolean]>) {
  for (const [value, valid] of values) rows.push({ name, leaf, value, valid, set(raw, v) {
    let parent = raw as unknown as Record<string, unknown>
    for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>
    parent[path.at(-1)!] = v
  } })
}
cases('name', root.name, ['name'], [[' ', false], ['', false], ['ok', true], ['a\0b', false], ['a'.repeat(81), false], [42, false]])
cases('publisher name', root.publisher.properties!.name, ['publisher', 'name'], [['\t\n', false], ['ok', true]])
cases('description', root.description, ['description'], [[' ', false], ['ok\ntext', true]])
cases('main', root.main, ['main'], [['ok', true], ['a\0b', false], ['a\tb', false], ['a\u007fb', false], ['../x', false], ['', false]])
cases('theme path', contributes.themes.items!.properties!.tokens, ['contributes', 'themes', '0', 'tokens'], [['ok.json', true], ['a\0b.json', false], ['a\nb.json', false]])
cases('keymap path', contributes.keymaps.items!.properties!.keys, ['contributes', 'keymaps', '0', 'keys'], [['ok.json', true], ['a\rb.json', false]])
cases('locale path', contributes.locales.items!.properties!.file, ['contributes', 'locales', '0', 'file'], [['ok.json', true], ['a\tb.json', false]])
for (const [value, valid] of [['ok', true], ['a\0b', false], ['a\nb', false]] as const) rows.push({ name: 'files path', leaf: root.files.propertyNames!, value, valid, set(raw, v) { raw.files = { [v as string]: `sha256:${'ab'.repeat(32)}` } } })
cases('homepage', root.homepage, ['homepage'], [['HTTPS://example.org', true], ['https://example.org', true], [' HTTPS://example.org ', true], ['https:example.org', true], ['h\tttps://example.org', true], ['http://example.org', false], ['javascript:alert(1)', false]])
cases('keywords', config.keywords.items!, ['contributes', 'configuration', 'properties', 'count', 'keywords', '0'], [['', true], [' ', true], ['ok', true], ['a\0b', true], [12, false], ['x'.repeat(4097), false]])
cases('chord', command.keys.items!, ['contributes', 'commands', '0', 'keys', '0'], [['Ctrl+', false], ['Ctrl+ ', false], ['', false], [' ', false], ['a\0b', false], ['\0', false], ['Ctrl+Q', true], ['+', true], ['Ctrl++', true], ['Ctrl+Plus', true]])

it('aligns string leaf contracts with the parser and rejects expressible hostile leaves', () => {
  expect(rows.length).toBeGreaterThanOrEqual(12)
  for (const row of rows) {
    const raw = completeManifest(); row.set(raw, row.value)
    const parsed = parseManifest(raw), allowed = compileLeaf(row.leaf)(row.value)
    const label = `${row.name}: ${JSON.stringify(row.value)}`
    expect(parsed.ok, label).toBe(row.valid)
    if (parsed.ok) expect(allowed, `parser acceptance implies schema acceptance: ${label}`).toBe(true)
    else expect(allowed, `expressible refusal: ${label}`).toBe(false)
  }
})
it('requires a nonblank character in every minLength: 1 string leaf', () => {
  let tested = 0
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const leaf = value as Leaf
    if (leaf.type === 'string' && leaf.minLength === 1) { expect(compileLeaf(leaf)(' ')).toBe(false); tested++ }
    Object.values(value).forEach(visit)
  }
  visit(schema); expect(tested).toBeGreaterThan(20)
})
