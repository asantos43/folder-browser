import { createHash, sign, type KeyObject } from 'node:crypto'
import { writeZip } from '../core/archive/writer.ts'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Synthetic plugin data only. No real files, processes or network. */
export function minimalManifest() {
  return { schema: 1, id: 'acme.sample', name: 'Sample', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' },
    engines: { folderBrowser: '>=0.1.0 <1.0.0', api: 1 }, uses: [] as string[], contributes: {}, activation: [] as string[], files: {} }
}

export interface KeyPair { publicKey: KeyObject; privateKey: KeyObject }
/** Materialise synthetic unpacked data, shared by host and real-boundary tests. */
export async function buildPluginFolder(dir: string, options: Parameters<typeof buildPlugin>[0] = {}) {
  const fixture = await buildPlugin(options)
  for (const entry of fixture.entries) {
    const file = path.join(dir, entry.name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, entry.data)
  }
  return dir
}
/** The installer intentionally publishes read-only directories. Restore fixture permissions. */
export async function removePluginFixture(dir: string): Promise<void> {
  async function writable(file: string): Promise<void> {
    const st = await fs.lstat(file)
    if (st.isSymbolicLink()) return
    await fs.chmod(file, st.isDirectory() ? 0o755 : 0o644)
    if (st.isDirectory()) for (const name of await fs.readdir(file)) await writable(path.join(file, name))
  }
  await writable(dir)
  await fs.rm(dir, { recursive: true, force: true })
}
/** Builds the same byte layout for a ZIP or an unpacked fixture. */
export async function buildPlugin(options: {
  file?: string; files?: Record<string, Buffer | string>; manifest?: Record<string, unknown>; signWith?: KeyPair
  tamperFile?: string; tamperManifest?: boolean; wrongKey?: KeyPair
} = {}) {
  const files = options.files ?? { 'README.md': 'Synthetic plugin' }
  const manifest = { ...minimalManifest(), files: Object.fromEntries(Object.entries(files).map(([name, data]) =>
    [name, `sha256:${createHash('sha256').update(data).digest('hex')}`])), ...options.manifest }
  if (options.signWith) {
    const key = (options.wrongKey ?? options.signWith).publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
    manifest.publisher = { ...manifest.publisher, key: `ed25519:${key.toString('hex')}` } as typeof manifest.publisher
  }
  const raw = Buffer.from(JSON.stringify(manifest))
  const entries: { name: string; data: Buffer | string }[] = [{ name: 'plugin.json', data: options.tamperManifest ? Buffer.from(JSON.stringify({ ...manifest, name: 'Altered' })) : raw },
    ...Object.entries(files).map(([name, data]) => ({ name, data: options.tamperFile === name ? Buffer.from('altered') : data }))]
  if (options.signWith) {
    const key = options.signWith.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
    entries.push({ name: 'SIGNATURE', data: JSON.stringify({ alg: 'ed25519', key: `ed25519:${key.toString('hex')}`, sig: sign(null, raw, options.signWith.privateKey).toString('hex') }) })
  }
  if (options.file) await writeZip(options.file, entries)
  return { manifest, entries }
}
export function completeManifest() {
  return { ...minimalManifest(), description: 'Synthetic level 0 contributions.', license: 'MIT', homepage: 'https://example.org/sample',
    publisher: { id: 'acme', name: 'Acme', key: `ed25519:${'ab'.repeat(32)}` },
    contributes: {
      themes: [{ id: 'sample-dark', label: 'theme.dark', base: 'dark', tokens: 'themes/dark.json' }],
      keymaps: [{ id: 'sample-keys', label: 'Keys', keys: 'keymaps/default.json' }],
      languages: [{ id: 'sample-language', label: 'Sample language', extensions: ['.sol'], filenames: ['Samplefile'], languageId: 'javascript' }],
      openWith: [{ id: 'sample-open', label: 'Open Sample', program: 'sample-tool', args: ['--file', '{file}'], extensions: ['.sol'] }],
      commands: [{ id: 'acme.sample:hello', title: 'command.hello', category: 'tools', keys: ['Mod+Alt+J'], when: 'enabled', palette: true,
        menu: { menu: 'menubar/tools', group: 'tools', order: 1 }, exec: { program: 'sample-tool', args: ['{file}'] } }],
      locales: [{ language: 'pt-BR', label: 'Português', file: 'locales/pt-BR.json' }],
      configuration: { title: 'Sample', properties: {
        enabled: { type: 'boolean', default: true, label: 'setting.enabled', description: 'setting.enabled.help', reload: true, sensitive: false, scope: 'user' },
        contrast: { type: 'enum', values: ['low', 'normal', 'high'], valueLabels: ['contrast.low', 'contrast.normal', 'contrast.high'], default: 'normal', label: 'setting.contrast', renamedFrom: 'old-contrast' },
        count: { type: 'number', min: 0, max: 10, step: 1, default: 2, label: 'setting.count', group: 'tools', order: 2, keywords: ['count'], enabledWhen: 'enabled == true' },
        text: { type: 'string', default: '<b>plain text</b>', maxLength: 4096, label: 'setting.text' },
        colour: { type: 'colour', default: '#abcdef', label: 'setting.colour' },
        items: { type: 'list', default: ['one'], maxItems: 1000, label: 'setting.items' },
      } },
    }, activation: ['onTheme:sample-dark', 'onKeymap:sample-keys', 'onLanguage:sample-language', 'onOpenWith:sample-open', 'onCommand:acme.sample:hello', 'onLocale:pt-BR', 'onStartupFinished'],
    files: Object.fromEntries(['themes/dark.json', 'keymaps/default.json', 'locales/pt-BR.json'].map(name => [name, `sha256:${'12'.repeat(32)}`])),
  }
}
export interface HostileManifest { name: string; raw: unknown; path?: string; code?: string }
export function hostileManifests(): HostileManifest[] {
  const top = (name: string, changes: object): HostileManifest => ({ name, raw: { ...minimalManifest(), ...changes } })
  const config = (name: string, property: object): HostileManifest => top(name, { contributes: { configuration: { title: 'Sample', properties: { bad: property } } } })
  const cases: HostileManifest[] = [
    top('missing schema', { schema: undefined }), top('wrong name type', { name: 42 }),
    ...['Acme.sample', 'acme.sample name', 'acme..sample', `acme.${'x'.repeat(64)}`].map(id => top(`id ${id}`, { id })),
    top('non-semver', { version: '1.2' }), top('unknown use', { uses: ['secrets'] }), top('duplicate use', { uses: ['network', 'network'] }),
    top('http homepage', { homepage: 'http://example.org' }), top('script homepage', { homepage: 'javascript:alert(1)' }),
    top('unknown contribution', { contributes: { surprise: [] } }), top('unknown top field', { extra: true }),
    top('huge string', { description: 'x'.repeat(4097) }), top('unknown activation', { activation: ['onFile:test'] }),
    top('missing activation target', { activation: ['onTheme:missing'] }), top('bad hash', { files: { 'file.txt': 'sha256:123' } }),
    ...['../x', '/abs', 'a\\b', ''].map(name => top(`unsafe path ${name}`, { files: { [name]: `sha256:${'a'.repeat(64)}` } })),
    config('regex pattern', { type: 'string', label: 'bad', default: '', pattern: '(a+)+$' }),
    ...['key', 'folder', 'file', 'action'].map(type => config(`unsupported ${type}`, { type, label: 'bad', default: '' })),
    top('101 properties', { contributes: { configuration: { title: 'Sample', properties: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`s${i}`, { type: 'boolean', label: 's', default: true }])) } } }),
    { name: 'over 256 KB', raw: ' '.repeat(256 * 1024 + 1) },
    top('depth 50', { contributes: { themes: Array.from({ length: 50 }).reduce<unknown>(value => ({ nested: value }), {}) } }),
    top('million-element list rejected by array size limit', { uses: Array(1_000_000).fill(false) }),
    top('sparse array', { uses: Array(1) }), top('strange prototype', { publisher: new Date() }),
    { name: 'accessor', raw: Object.defineProperty(minimalManifest(), 'name', { enumerable: true, get() { throw new Error('must never run') } }) },
    { name: 'Proxy', raw: new Proxy(minimalManifest(), { ownKeys() { throw new Error('must never run') } }) },
  ]
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    cases.push({ name: `forbidden top ${key}`, raw: JSON.parse(JSON.stringify(minimalManifest()).replace(/}$/, `,"${key}":{}}`)) })
    cases.push(top(`forbidden nested ${key}`, { contributes: JSON.parse(`{"themes":[{"${key}":{}}]}`) }))
  }
  return cases
}
