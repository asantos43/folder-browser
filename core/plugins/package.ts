import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { Readable } from 'node:stream'
import yauzl from 'yauzl'
import { safeRelative, decodeName } from '../zip.ts'
import { fingerprintOf } from '../validate/signature.ts'
import type { SignerStore } from '../signers.ts'
import { parseManifest, type PluginManifest } from './manifest.ts'

export interface PackageLimits {
  totalBytes: number; files: number; fileBytes: number; manifestBytes: number; ratio: number
  nameLength: number; pathLength: number; depth: number
}
export const PACKAGE_LIMITS: Readonly<PackageLimits> = Object.freeze({ totalBytes: 50 * 1024 ** 2, files: 2000,
  fileBytes: 16 * 1024 ** 2, manifestBytes: 256 * 1024, ratio: 100,
  nameLength: 255, pathLength: 1024, depth: 16 })
export type PackageSource = { kind: 'folder'; dir: string } | { kind: 'zip'; file: string }
export type PackageOrigin = { kind: 'file' | 'folder' | 'repository' | 'catalog' }
export type SignatureState = { signed: false } | { signed: true; key: string; fingerprint: string }
export type TrustLabel = 'catalog' | 'signed-trusted' | 'signed-unknown' | 'repository' | 'unsigned'
export interface PackageOptions {
  limits?: Partial<PackageLimits>
  origin?: PackageOrigin
  signerStore?: Pick<SignerStore, 'isTrusted'>
  /** Observes actual inflated bytes, including the block that triggers refusal. */
  onBytes?: (bytes: number) => void
}
export interface PackageError { code: string; path?: string; message: string }
export interface PackageFile { path: string; size: number; sha256: string }
export interface PluginPackage {
  readonly manifestBytes: Buffer; readonly signatureBytes?: Buffer
  manifest: PluginManifest; files: readonly PackageFile[]; totalBytes: number
  signature: SignatureState; trust: TrustLabel; hasCode: boolean
  readFile(path: string): Promise<Buffer>
  openStream(path: string): Promise<Readable>
  close(): Promise<void>
}
export type PackageResult = { ok: true; package: PluginPackage } | { ok: false; errors: PackageError[] }

export function trustLabel(signature: SignatureState, signerStore: Pick<SignerStore, 'isTrusted'> | undefined, origin: PackageOrigin): TrustLabel {
  if (origin.kind === 'catalog') return 'catalog'
  if (signature.signed) return signerStore?.isTrusted(signature.fingerprint) ? 'signed-trusted' : 'signed-unknown'
  return origin.kind === 'repository' ? 'repository' : 'unsigned'
}
class Refused extends Error {
  readonly detail: PackageError
  constructor(detail: PackageError) { super(detail.message); this.detail = detail }
}
function refuse(code: string, name?: string): never {
  throw new Refused({ code: `package.${code}`, ...(name === undefined ? {} : { path: name }), message: `${name ?? 'Package'}: ${code}` })
}
interface Entry { name: string; size: number; compressed: number; directory: boolean; open(): Promise<Readable> }
const script = /\.(js|mjs|cjs|sh|bat|cmd|exe|dll|so|dylib|ps1|py|jar|app|com|scr)$/i

/** Install-time only: no extraction, writes, Electron or execution. */
export async function readPackage(source: PackageSource, options: PackageOptions = {}): Promise<PackageResult> {
  let zip: yauzl.ZipFile | undefined
  let closed = false
  const active = new Set<Readable>()
  const close = async () => { closed = true; for (const stream of active) stream.destroy(); zip?.close() }
  try {
    const limits = { ...PACKAGE_LIMITS }
    for (const key of Object.keys(PACKAGE_LIMITS) as (keyof typeof PACKAGE_LIMITS)[]) {
      const value = options.limits?.[key]
      if (value !== undefined) {
        if (!Number.isFinite(value) || value <= 0 || value > PACKAGE_LIMITS[key]) refuse('limit.options', key)
        limits[key] = value
      }
    }
    const entries = new Map<string, Entry>(), folded = new Set<string>(), spellings = new Map<string, string>()
    let declaredTotal = 0, compressedTotal = 0
    const checkName = (name: string, directory = false) => {
      const bare = directory ? name.slice(0, -1) : name
      const controls = [...name].some(ch => { const code = ch.charCodeAt(0); return code < 32 || code >= 127 && code <= 159 })
      if (safeRelative(name) !== bare || controls) refuse('entry.unsafe-name', name)
      const parts = bare.split('/')
      if (bare.length > limits.pathLength || parts.some(p => p.length > limits.nameLength)) refuse('limit.name', name)
      if (parts.length - (directory ? 0 : 1) > limits.depth) refuse('limit.depth', name)
    }
    const add = (entry: Entry) => {
      checkName(entry.name, entry.directory)
      const bare = entry.name.replace(/\/$/, ''), canonical = bare.normalize('NFC').toLowerCase()
      if (folded.has(canonical)) refuse('entry.duplicate', entry.name)
      const parts = bare.split('/')
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join('/'), normalized = prefix.normalize('NFC').toLowerCase()
        const existing = spellings.get(normalized)
        if (existing !== undefined && existing !== prefix) refuse('entry.duplicate', entry.name)
        spellings.set(normalized, prefix)
      }
      folded.add(canonical)
      if (entries.size >= limits.files) refuse('limit.files')
      if (!entry.directory) {
        const max = entry.name === 'plugin.json' ? limits.manifestBytes : limits.fileBytes
        if (entry.size > max) refuse('limit.size', entry.name)
        if (source.kind === 'zip' && entry.size > entry.compressed * limits.ratio) refuse('limit.ratio', entry.name)
        declaredTotal += entry.size; compressedTotal += entry.compressed
        if (declaredTotal > limits.totalBytes) refuse('limit.size')
      }
      entries.set(entry.name, entry)
    }
    if (source.kind === 'zip') {
      if ((await fs.stat(source.file)).size > limits.totalBytes) refuse('limit.size')
      zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(source.file,
        { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: false },
        (error, opened) => error || !opened ? reject(error) : resolve(opened)))
      const opened = zip
      if (opened.entryCount > limits.files) refuse('limit.files')
      // Retain an error listener for late I/O errors after the directory has been read.
      await new Promise<void>((resolve, reject) => {
        opened.on('error', reject)
        opened.on('end', resolve)
        opened.on('entry', (raw: yauzl.Entry) => {
          try {
            const name = decodeName(raw.fileName as unknown as Buffer, raw.generalPurposeBitFlag)
            const mode = (raw.externalFileAttributes >>> 16) & 0o170000
            if (mode === 0o120000 || raw.extraFields.some(f => f.id === 0x000d && f.data.length > 12)) refuse('entry.symlink', name)
            if (mode !== 0 && mode !== 0o100000 && mode !== 0o040000) refuse('entry.type', name)
            if (mode === 0o040000 && !name.endsWith('/')) refuse('entry.type', name)
            if (raw.isEncrypted()) refuse('entry.encrypted', name)
            if (raw.compressionMethod !== 0 && raw.compressionMethod !== 8) refuse('entry.method', name)
            add({ name, size: raw.uncompressedSize, compressed: raw.compressedSize, directory: name.endsWith('/'),
              open: () => new Promise((res, rej) => opened.openReadStream(raw, (err, stream) => err || !stream ? rej(err) : res(stream))) })
            opened.readEntry()
          } catch (error) { reject(error) }
        })
        opened.readEntry()
      })
    } else {
      if ((await fs.lstat(source.dir)).isSymbolicLink()) refuse('entry.symlink')
      const root = await fs.realpath(source.dir)
      const walk = async (relative: string): Promise<void> => {
        const directory = await fs.opendir(path.join(root, relative))
        for await (const child of directory) {
          const name = relative ? `${relative}/${child.name}` : child.name
          const target = path.join(root, name), stat = await fs.lstat(target)
          if (stat.isSymbolicLink() || stat.nlink > 1 && stat.isFile()) refuse('entry.symlink', name)
          if (!stat.isFile() && !stat.isDirectory()) refuse('entry.type', name)
          add({ name: stat.isDirectory() ? `${name}/` : name, size: stat.isDirectory() ? 0 : stat.size,
            compressed: stat.size, directory: stat.isDirectory(), open: async () => {
              const actual = await fs.realpath(target)
              if (!actual.startsWith(`${root}${path.sep}`)) refuse('entry.unsafe-name', name)
              const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
              const current = await handle.stat()
              if (!current.isFile() || current.nlink > 1 || current.ino !== stat.ino || current.dev !== stat.dev) {
                await handle.close(); refuse('entry.symlink', name)
              }
              return handle.createReadStream()
            } })
          if (stat.isDirectory()) await walk(name)
        }
      }
      await walk('')
    }
    for (const entry of entries.values()) {
      const parts = entry.name.split('/')
      for (let i = 1; i < parts.length; i++) if (entries.has(parts.slice(0, i).join('/'))) refuse('entry.duplicate', entry.name)
    }
    if (source.kind === 'zip' && declaredTotal > compressedTotal * limits.ratio) refuse('limit.ratio')
    let totalBytes = 0
    const consume = async (entry: Entry, keep: boolean): Promise<{ bytes: Buffer; size: number; sha256: string }> => {
      const chunks: Buffer[] = [], hash = createHash('sha256')
      const stream = await entry.open(); active.add(stream)
      let size = 0
      try {
        for await (const chunk of stream) {
          const bytes = chunk as Buffer
          size += bytes.length; totalBytes += bytes.length; options.onBytes?.(bytes.length)
          if (size > (entry.name === 'plugin.json' ? limits.manifestBytes : limits.fileBytes) || totalBytes > limits.totalBytes) refuse('limit.size', entry.name)
          if (source.kind === 'zip' && size > entry.compressed * limits.ratio) refuse('limit.ratio', entry.name)
          hash.update(bytes); if (keep) chunks.push(bytes)
        }
        if (size !== entry.size) refuse('entry.size', entry.name)
        return { bytes: keep ? Buffer.concat(chunks) : Buffer.alloc(0), size, sha256: `sha256:${hash.digest('hex')}` }
      } finally { stream.destroy(); active.delete(stream) }
    }
    const manifestEntry = entries.get('plugin.json')
    if (!manifestEntry || manifestEntry.directory) refuse('manifest.missing')
    const manifestBytes = (await consume(manifestEntry, true)).bytes
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes) } catch { refuse('manifest.encoding', 'plugin.json') }
    const parsed = parseManifest(text)
    if (!parsed.ok) { await close(); return { ok: false, errors: parsed.errors.map(e => ({ ...e, code: `package.${e.code}` })) } }
    const manifest = parsed.manifest
    if (manifest.main && !Object.hasOwn(manifest.files, manifest.main)) refuse('file.missing', manifest.main)
    const files: PackageFile[] = []
    for (const name of Object.keys(manifest.files)) {
      checkName(name)
      if (name === 'plugin.json' || name === 'SIGNATURE') refuse('file.reserved', name)
      const entry = entries.get(name)
      if (!entry || entry.directory) refuse('file.missing', name)
    }
    for (const entry of entries.values()) {
      if (entry.directory || entry.name === 'plugin.json' || entry.name === 'SIGNATURE') continue
      if (!Object.hasOwn(manifest.files, entry.name)) refuse('file.undeclared', entry.name)
      if (!manifest.hasCode && script.test(entry.name)) refuse('file.executable', entry.name)
      if (/\.svg$/i.test(entry.name)) refuse('file.svg', entry.name)
      const data = await consume(entry, entry.name === 'icon.png')
      if (data.sha256 !== manifest.files[entry.name].toLowerCase()) refuse('hash.mismatch', entry.name)
      if (entry.name === 'icon.png' && !data.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) refuse('file.icon', entry.name)
      files.push(Object.freeze({ path: entry.name, size: data.size, sha256: data.sha256 }))
    }
    let signatureBytes: Buffer | undefined
    let signature: SignatureState = { signed: false }
    const signed = entries.get('SIGNATURE')
    if (signed) {
      if (signed.size > 4 * 1024) refuse('signature.invalid', 'SIGNATURE')
      const data = await consume(signed, true)
      signatureBytes = data.bytes
      let record: { alg?: unknown; key?: unknown; sig?: unknown }
      try { record = JSON.parse(data.bytes.toString('utf8')) } catch { refuse('signature.invalid', 'SIGNATURE') }
      if (!record || record.alg !== 'ed25519' || typeof record.key !== 'string' || !/^ed25519:[0-9a-fA-F]{64}$/.test(record.key) || typeof record.sig !== 'string' || !/^[0-9a-fA-F]{128}$/.test(record.sig)) refuse('signature.invalid', 'SIGNATURE')
      if (manifest.publisher.key !== record.key) refuse('signature.key-mismatch', 'SIGNATURE')
      const raw = Buffer.from(record.key.slice(8), 'hex')
      const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' })
      if (!verify(null, manifestBytes, key, Buffer.from(record.sig, 'hex'))) refuse('signature.invalid', 'SIGNATURE')
      signature = { signed: true, key: record.key, fingerprint: fingerprintOf(raw) }
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    const verified = new Map(files.map(f => [f.path, f]))
    const openStream = async (name: string): Promise<Readable> => {
      if (closed) refuse('file.closed', name)
      const expected = verified.get(name), entry = entries.get(name)
      if (!expected || !entry) refuse('file.undeclared', name)
      const sourceStream = await entry.open(); active.add(sourceStream)
      const result = Readable.from((async function* () {
        let size = 0; const hash = createHash('sha256')
        try {
          for await (const chunk of sourceStream) {
            const bytes = chunk as Buffer; size += bytes.length
            if (size > expected.size || size > limits.fileBytes) refuse('limit.size', name)
            hash.update(bytes); yield bytes
          }
          if (size !== expected.size || `sha256:${hash.digest('hex')}` !== expected.sha256) refuse('hash.mismatch', name)
        } finally { sourceStream.destroy(); active.delete(sourceStream) }
      })())
      active.add(result); result.once('close', () => { sourceStream.destroy(); active.delete(sourceStream); active.delete(result) })
      return result
    }
    return { ok: true, package: Object.defineProperties({ manifest, manifestBytes, ...(signatureBytes ? { signatureBytes } : {}), files: Object.freeze(files), totalBytes, signature,
      trust: trustLabel(signature, options.signerStore, source.kind === 'folder' && options.origin?.kind === 'catalog' ? { kind: 'folder' } : options.origin ?? { kind: source.kind === 'zip' ? 'file' : 'folder' }),
      hasCode: manifest.hasCode, openStream, close,
      async readFile(name: string) { const chunks: Buffer[] = []; for await (const chunk of await openStream(name)) chunks.push(chunk as Buffer); return Buffer.concat(chunks) } },
      { manifestBytes: { writable: false }, ...(signatureBytes ? { signatureBytes: { writable: false } } : {}) }) }
  } catch (error) {
    await close()
    return { ok: false, errors: [error instanceof Refused ? error.detail : { code: 'package.entry.invalid', message: error instanceof Error ? error.message : 'Cannot read package' }] }
  }
}
