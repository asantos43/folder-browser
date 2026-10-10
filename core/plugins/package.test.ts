import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { generateKeyPairSync, randomBytes, createHash } from 'node:crypto'
import { readPackage, trustLabel, PACKAGE_LIMITS, type PackageOptions, type PackageResult, type SignatureState } from './package.ts'
import { buildPlugin, minimalManifest } from '../../fixtures/plugins.ts'
import { hostilePluginNames, pluginZipMetadata, pluginBomb, pluginManyEntries } from '../../fixtures/hostile.ts'
import { zipSync, zipBuffer } from '../../fixtures/zip.ts'
import { SignerStore } from '../signers.ts'
import { fingerprintOf } from '../validate/signature.ts'

let dir: string, file: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-package-')); file = path.join(dir, 'sample.fbplugin') })
afterEach(async () => { await fs.chmod(dir, 0o700); await fs.rm(dir, { recursive: true, force: true }) })
const code = (result: PackageResult) => result.ok ? 'accepted' : result.errors[0].code
async function readBytes(bytes: Buffer, options?: PackageOptions) {
  await fs.writeFile(file, bytes)
  const before = await fs.readdir(dir)
  const result = await readPackage({ kind: 'zip', file }, options)
  expect(await fs.readdir(dir)).toEqual(before)
  if (result.ok) await result.package.close()
  return result
}
async function unpack(entries: { name: string; data: Buffer | string }[]) {
  const folder = path.join(dir, 'folder'); await fs.mkdir(folder)
  for (const entry of entries) { const target = path.join(folder, entry.name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, entry.data) }
  return folder
}
describe('package reader', () => {
  it.each(hostilePluginNames())('refuses hostile name $name without writes', async ({ bytes, code: expected }) => {
    expect(code(await readBytes(bytes))).toBe(expected)
  })
  it.each([
    ['duplicate', ['a.txt', 'a.txt']], ['case collision', ['a.txt', 'A.txt']],
    ['NFC collision', ['é.txt', 'e\u0301.txt']], ['file/directory collision', ['a', 'a/']],
    ['parent is file', ['a', 'a/b']],
    ['implicit directory case collision', ['A/x', 'a/y']], ['implicit directory NFC collision', ['é/x', 'e\u0301/y']],
  ])('refuses %s', async (_label, names) => {
    expect(code(await readBytes(zipSync((names as string[]).map(name => ({ name })))))).toBe('package.entry.duplicate')
  })
  it.each([
    [{ symlink: true }, 'package.entry.symlink'], [{ hardlink: true }, 'package.entry.symlink'],
    [{ encrypted: true }, 'package.entry.encrypted'], [{ size: 1 << 30 }, 'package.limit.size'],
  ])('refuses hostile metadata %j', async (changes, expected) => {
    expect(code(await readBytes(pluginZipMetadata(zipSync([{ name: 'x' }]), changes as Parameters<typeof pluginZipMetadata>[1])))).toBe(expected)
  })
  it('gives identical folder/ZIP manifests and files, bounded declared reads and streams', async () => {
    const fixture = await buildPlugin({ file, files: { 'README.md': 'hello', 'theme/dark.json': '{}' } })
    const folder = await unpack(fixture.entries)
    await fs.chmod(folder, 0o555)
    const zipped = await readPackage({ kind: 'zip', file }), unpacked = await readPackage({ kind: 'folder', dir: folder }, { origin: { kind: 'catalog' } })
    expect(zipped.ok && unpacked.ok).toBe(true)
    if (!zipped.ok || !unpacked.ok) return
    try {
      expect(zipped.package.manifest).toEqual(unpacked.package.manifest)
      expect(zipped.package.files).toEqual(unpacked.package.files)
      expect(unpacked.package.trust).toBe('unsigned')
      expect(await zipped.package.readFile('README.md')).toEqual(Buffer.from('hello'))
      const chunks: Buffer[] = []; for await (const chunk of await unpacked.package.openStream('README.md')) chunks.push(chunk)
      expect(Buffer.concat(chunks).toString()).toBe('hello')
      for (const name of ['../x', '/etc/passwd', 'plugin.json', 'absent']) await expect(zipped.package.readFile(name)).rejects.toMatchObject({ detail: { code: 'package.file.undeclared' } })
    } finally { await zipped.package.close(); await unpacked.package.close(); await fs.chmod(folder, 0o755) }
    await expect(zipped.package.readFile('README.md')).rejects.toMatchObject({ detail: { code: 'package.file.closed' } })
  })
  it('refuses symbolic links and hardlinks in folders', async () => {
    const fixture = await buildPlugin(); const folder = await unpack(fixture.entries)
    await fs.symlink('README.md', path.join(folder, 'link'))
    expect(code(await readPackage({ kind: 'folder', dir: folder }))).toBe('package.entry.symlink')
    await fs.unlink(path.join(folder, 'link')); await fs.link(path.join(folder, 'README.md'), path.join(folder, 'hardlink'))
    expect(code(await readPackage({ kind: 'folder', dir: folder }))).toBe('package.entry.symlink')
    await fs.unlink(path.join(folder, 'hardlink'))
    await fs.symlink(folder, path.join(dir, 'root-link'))
    expect(code(await readPackage({ kind: 'folder', dir: path.join(dir, 'root-link') }))).toBe('package.entry.symlink')
  })
  it('detects folder content changes after verification', async () => {
    const fixture = await buildPlugin(); const folder = await unpack(fixture.entries)
    const result = await readPackage({ kind: 'folder', dir: folder }); expect(result.ok).toBe(true)
    if (!result.ok) return
    try { await fs.writeFile(path.join(folder, 'README.md'), 'x'); await expect(result.package.readFile('README.md')).rejects.toMatchObject({ detail: { code: 'package.hash.mismatch' } }) }
    finally { await result.package.close() }
  })
  it('requires a root manifest and passes manifest error codes through', async () => {
    expect(code(await readBytes(zipSync([])))).toBe('package.manifest.missing')
    expect(code(await readBytes(zipSync([{ name: 'plugin.json', data: '{}' }])))).toMatch(/^package\.manifest\./)
    expect(code(await readBytes(zipSync([{ name: 'plugin.json', data: Buffer.from([0xff]) }])))).toBe('package.manifest.encoding')
    const fixture = await buildPlugin()
    fixture.entries[0].data = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fixture.entries[0].data)])
    expect((await readBytes(zipSync(fixture.entries))).ok).toBe(true)
  })
  it.each([
    ['tampered hash', { tamperFile: 'README.md' }, 'package.hash.mismatch'],
    ['undeclared', { manifest: { files: {} } }, 'package.file.undeclared'],
    ['missing', { manifest: { files: { absent: `sha256:${'a'.repeat(64)}` } } }, 'package.file.missing'],
  ])('refuses %s', async (_name, options, expected) => {
    const fixture = await buildPlugin(options); expect(code(await readBytes(zipSync(fixture.entries)))).toBe(expected)
  })
  it('checks PNG magic and refuses SVG', async () => {
    for (const [name, data, expected] of [['icon.png', 'bad', 'package.file.icon'], ['icon.svg', '<svg/>', 'package.file.svg']]) {
      const fixture = await buildPlugin({ files: { [name]: data } }); expect(code(await readBytes(zipSync(fixture.entries)))).toBe(expected)
    }
    const fixture = await buildPlugin({ files: { 'icon.png': Buffer.from('89504e470d0a1a0a', 'hex') } })
    expect((await readBytes(zipSync(fixture.entries))).ok).toBe(true)
  })
  it.each(['js', 'mjs', 'cjs', 'sh', 'bat', 'cmd', 'exe', 'dll', 'so', 'dylib', 'ps1', 'py', 'jar', 'app', 'com', 'scr'])('level 0 refuses .%s', async extension => {
    const fixture = await buildPlugin({ files: { [`run.${extension}`]: 'never executed' } })
    expect(code(await readBytes(zipSync(fixture.entries)))).toBe('package.file.executable')
  })
  it('recognizes code without executing it and requires declared main', async () => {
    const fixture = await buildPlugin({ files: { 'main.js': 'throw new Error("never execute")' }, manifest: { main: 'main.js' } })
    const result = await readBytes(zipSync(fixture.entries)); expect(result.ok && result.package.hasCode).toBe(true)
    const missing = await buildPlugin({ manifest: { main: 'main.js' } })
    expect(code(await readBytes(zipSync(missing.entries)))).toBe('package.file.missing')
  })
  it('verifies Ed25519, exact manifest bytes, fingerprints and publisher key', async () => {
    const keys = generateKeyPairSync('ed25519')
    for (const [options, expected] of [
      [{ signWith: keys }, 'accepted'], [{ signWith: keys, tamperManifest: true }, 'package.signature.invalid'],
      [{ signWith: keys, wrongKey: generateKeyPairSync('ed25519') }, 'package.signature.key-mismatch'],
      [{ signWith: keys, tamperFile: 'README.md' }, 'package.hash.mismatch'],
    ] as const) {
      const fixture = await buildPlugin(options); const result = await readBytes(zipSync(fixture.entries)); expect(code(result)).toBe(expected)
      if (result.ok) expect(result.package.signature).toMatchObject({ signed: true, fingerprint: fingerprintOf(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)) })
    }
    const fixture = await buildPlugin()
    for (const data of ['garbage', 'null', '{}', JSON.stringify({ alg: 'rsa', key: 'x', sig: 'x' })])
      expect(code(await readBytes(zipSync([...fixture.entries, { name: 'SIGNATURE', data }])))).toBe('package.signature.invalid')
    const signed = await buildPlugin({ signWith: keys })
    signed.entries[0].data = JSON.stringify({ ...signed.manifest, publisher: minimalManifest().publisher })
    expect(code(await readBytes(zipSync(signed.entries)))).toBe('package.signature.key-mismatch')
  })
  it('labels trust purely using SignerStore fingerprints and origin', async () => {
    const fingerprint = 'a'.repeat(64), storeFile = path.join(dir, 'signers.json')
    await fs.writeFile(storeFile, JSON.stringify({ [fingerprint]: { trustedAt: '2026-10-10' } }))
    const store = new SignerStore(storeFile)
    const trusted: SignatureState = { signed: true, key: `ed25519:${'b'.repeat(64)}`, fingerprint }
    for (const [signature, origin, expected] of [
      [{ signed: false }, 'catalog', 'catalog'], [trusted, 'catalog', 'catalog'], [trusted, 'file', 'signed-trusted'],
      [{ ...trusted, fingerprint: 'c'.repeat(64) }, 'repository', 'signed-unknown'],
      [{ signed: false }, 'repository', 'repository'], [{ signed: false }, 'file', 'unsigned'], [{ signed: false }, 'folder', 'unsigned'],
    ] as const) expect(trustLabel(signature, store, { kind: origin })).toBe(expected)
    expect(await fs.readFile(storeFile, 'utf8')).toBe(JSON.stringify({ [fingerprint]: { trustedAt: '2026-10-10' } }))
  })
  it('options only tighten every exported limit', async () => {
    for (const [name, max] of Object.entries(PACKAGE_LIMITS)) {
      expect(code(await readBytes(zipSync([]), { limits: { [name]: max + 1 } }))).toBe('package.limit.options')
      expect(code(await readBytes(zipSync([]), { limits: { [name]: NaN } }))).toBe('package.limit.options')
    }
    const fixture = await buildPlugin({ files: { 'nested/file.txt': 'hello' } })
    for (const [limits, expected] of [
      [{ files: 1 }, 'package.limit.files'], [{ totalBytes: 1 }, 'package.limit.size'], [{ fileBytes: 1 }, 'package.limit.size'],
      [{ manifestBytes: 1 }, 'package.limit.size'], [{ nameLength: 4 }, 'package.limit.name'], [{ pathLength: 5 }, 'package.limit.name'],
    ] as const) expect(code(await readBytes(zipSync(fixture.entries), { limits }))).toBe(expected)
    expect(code(await readBytes(zipSync([{ name: 'a/b/c.txt' }]), { limits: { depth: 1 } }))).toBe('package.limit.depth')
    expect(code(await readBytes(await zipBuffer([{ name: 'ratio.txt', data: 'abcdef'.repeat(50) }]), { limits: { ratio: 1 } }))).toBe('package.limit.ratio')
    expect(code(await readBytes(zipSync([{ name: `${'x'.repeat(256)}.txt` }])))).toBe('package.limit.name')
    expect(code(await readBytes(zipSync([{ name: `${'a/'.repeat(17)}x` }])))).toBe('package.limit.depth')
  })
  it('counts actual inflation and aborts a lying compressed entry within one block', async () => {
    const data = Buffer.alloc(2 * 1024 ** 2)
    const manifest = { ...minimalManifest(), files: { 'bomb.txt': `sha256:${createHash('sha256').update(data).digest('hex')}` } }
    const bomb = await pluginBomb(1024)
    // Put the lying entry first so the metadata helper changes it, then supply a valid manifest.
    const compressed = pluginZipMetadata(await zipBuffer([{ name: 'bomb.txt', data }, { name: 'plugin.json', data: JSON.stringify(manifest), store: true }]), { size: 1024 })
    expect(bomb.length).toBeLessThan(10000)
    let inflated = 0
    const result = await readBytes(compressed, { limits: { fileBytes: 64 * 1024 }, onBytes: bytes => { inflated += bytes } })
    expect(code(result)).toBe('package.limit.size')
    expect(inflated).toBeLessThanOrEqual(64 * 1024 + 65536 + Buffer.byteLength(JSON.stringify(manifest)))
    let ratioBytes = 0
    expect(code(await readBytes(compressed, { onBytes: bytes => { ratioBytes += bytes } }))).toBe('package.limit.ratio')
    expect(ratioBytes).toBeLessThanOrEqual(2100 * 100 + 65536 + Buffer.byteLength(JSON.stringify(manifest)))
  })
  it('enforces declared bomb and 5000-entry time budgets without inflation', async () => {
    for (const [bytes, budget, expected] of [[await pluginBomb(), 150, 'package.limit.size'], [pluginManyEntries(), 100, 'package.limit.files']] as const) {
      await fs.writeFile(file, bytes); let inflated = 0
      const start = performance.now(); const result = await readPackage({ kind: 'zip', file }, { onBytes: n => { inflated += n } })
      const elapsed = performance.now() - start
      expect(code(result)).toBe(expected); expect(elapsed).toBeLessThan(budget); expect(inflated).toBe(0)
      process.stdout.write(`package budget ${expected}: ${elapsed.toFixed(2)} ms, ${inflated} inflated bytes\n`)
    }
  })
  it('verifies 5 MiB / 200 files under 400 ms and 40 MiB heap growth', async () => {
    const files = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`file-${i}.txt`, randomBytes(5 * 1024 ** 2 / 200 | 0)]))
    await buildPlugin({ file, files })
    const heap = process.memoryUsage().heapUsed, start = performance.now()
    const result = await readPackage({ kind: 'zip', file })
    const elapsed = performance.now() - start, growth = process.memoryUsage().heapUsed - heap
    try { expect(result.ok).toBe(true); expect(elapsed).toBeLessThan(400); expect(growth).toBeLessThan(40 * 1024 ** 2) }
    finally { if (result.ok) await result.package.close() }
    process.stdout.write(`package budget 5 MiB / 200 files: ${elapsed.toFixed(2)} ms, ${(growth / 1024 ** 2).toFixed(2)} MiB heap growth\n`)
  })
})
