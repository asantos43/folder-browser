// Files the viewer must refuse or flag, for the end-to-end tests. All synthetic.
import fs from 'node:fs'
import { zipBuffer, zipSync } from './zip.ts'
import { writeZip } from '../core/archive/writer.ts'
import { manifestFor, richFiles, WSNP_TYPE, writeRichWsnp } from './build.ts'

const zipOf = (path: string, mimetype: string, manifest: unknown, files: { path: string; data: Buffer | string }[] = []) =>
  writeZip(path, [{ name: 'mimetype', data: mimetype }, { name: 'manifest.json', data: JSON.stringify(manifest) }, ...files.map((f) => ({ name: f.path, data: f.data }))])

export const writeNotAZip = (path: string) => fs.promises.writeFile(path, 'This is only text, not a ZIP file, and it is long enough to be scanned.')
export const writeApplication = (path: string) => zipOf(path, 'application/vnd.wsnp.x+zip', { format: 'wsnpx' })
export const writeProtected = (path: string) =>
  writeZip(path, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'encryption.json', data: '{"encryption_version":"1.0"}' }, { name: '_wsnp/encrypted', data: Buffer.alloc(64, 7) }])
export async function writeNewer(path: string) {
  const files = richFiles()
  await zipOf(path, WSNP_TYPE, { ...manifestFor(files), format_version: '2.0' }, files)
}
/** Opens, but one stylesheet was changed after it was saved (the same size, so only the SHA-256 tells). */
export async function writeTampered(path: string) {
  const files = richFiles()
  const manifest = manifestFor(files, { title: 'Tampered page' })
  const changed = files.map((f) => (f.path === 'assets/styles/site.css' ? { ...f, data: String(f.data).replace('rgb(0,128,128)', 'rgb(0,128,127)') } : f))
  await zipOf(path, WSNP_TYPE, manifest, changed)
}
export { writeRichWsnp }

/** The manifest of a good file with one hash changed: what someone gets by unzipping, editing the manifest and zipping again. */
export async function writeManifestEdited(path: string) {
  const files = richFiles()
  const manifest = manifestFor(files, { title: 'Edited manifest' }) as { files: { path: string; sha256: string }[] }
  const entry = manifest.files.find((f) => f.path === 'index.html')!
  entry.sha256 = '0'.repeat(64)
  await zipOf(path, WSNP_TYPE, manifest, files)
}

/** The manifest says a file is bigger than it is: the ZIP directory and the manifest disagree, so the file does not even open. */
export async function writeManifestSizeEdited(path: string) {
  const files = richFiles()
  const manifest = manifestFor(files) as { files: { path: string; bytes: number }[] }
  manifest.files.find((f) => f.path === 'index.html')!.bytes += 10
  await zipOf(path, WSNP_TYPE, manifest, files)
}

/** Package-only corpus. Raw stored ZIPs preserve names the writer rightly refuses. */
export function hostilePluginNames() {
  return ['../x', '/absolute', 'a\\b', 'a\0b', 'a\nb', '', 'a//b', 'CON', 'NUL.txt', 'AUX', 'PRN', 'COM1.exe', 'LPT9', 'trailing.', 'trailing ', 'C:/x']
    .map(name => ({ name, bytes: zipSync([{ name, data: 'x' }]), code: 'package.entry.unsafe-name' }))
}
/** Change central-directory metadata without trusting a writer's safety checks. */
export function pluginZipMetadata(bytes: Buffer, changes: { size?: number; symlink?: boolean; encrypted?: boolean; hardlink?: boolean }) {
  const out = Buffer.from(bytes)
  const end = out.length - 22, at = out.readUInt32LE(end + 16)
  if (changes.size !== undefined) out.writeUInt32LE(changes.size, at + 24)
  if (changes.symlink) out.writeUInt32LE((0o120777 << 16) >>> 0, at + 38)
  if (changes.encrypted) out.writeUInt16LE(out.readUInt16LE(at + 8) | 1, at + 8)
  if (changes.hardlink) {
    const nameEnd = at + 46 + out.readUInt16LE(at + 28)
    const extraLength = out.readUInt16LE(at + 30)
    const extra = Buffer.alloc(17)
    extra.writeUInt16LE(0x000d, 0); extra.writeUInt16LE(13, 2); extra[16] = 120
    const expanded = Buffer.concat([out.subarray(0, nameEnd), extra, out.subarray(nameEnd)])
    expanded.writeUInt16LE(extraLength + extra.length, at + 30)
    expanded.writeUInt32LE(out.readUInt32LE(end + 12) + extra.length, expanded.length - 10)
    return expanded
  }
  return out
}
export async function pluginBomb(declaredSize = 1 << 30) {
  // The real expansion is deliberately bounded in the fixture; metadata claims 1 GiB.
  return pluginZipMetadata(await zipBuffer([{ name: 'bomb.txt', data: Buffer.alloc(2 * 1024 ** 2) }]), { size: declaredSize })
}
export const pluginManyEntries = () => zipSync(Array.from({ length: 5000 }, (_, i) => ({ name: `empty-${i}` })))
