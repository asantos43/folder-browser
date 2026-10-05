// Signing for the tests: a writer's side of FORMAT.md section 12, in Node's crypto. Synthetic keys, like every fixture.
import crypto from 'node:crypto'
import { writeZip } from '../core/archive/writer.ts'
import type { Algorithm } from '../core/validate/signature.ts'
import { manifestFor, WSNP_TYPE, type FixtureFile, type WsnpOptions } from './build.ts'

export interface Signer {
  algorithm: Algorithm
  /** The raw public key: 32 bytes for Ed25519, the 65-byte uncompressed point for ECDSA P-256. */
  publicKey: Buffer
  sign(bytes: Buffer): Buffer
}

const ED25519_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex')

/** An Ed25519 key, from a 32-byte seed (random when none is given). */
export function ed25519Signer(seed: Buffer = crypto.randomBytes(32)): Signer {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, seed]), format: 'der', type: 'pkcs8' })
  const publicKey = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32)
  return { algorithm: 'Ed25519', publicKey: Buffer.from(publicKey), sign: (bytes) => crypto.sign(null, bytes, privateKey) }
}

export function ecdsaSigner(): Signer {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const point = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65)
  return { algorithm: 'ECDSA-P256-SHA256', publicKey: Buffer.from(point), sign: (bytes) => crypto.sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' }) }
}

export const fingerprintHex = (signer: Signer): string => crypto.createHash('sha256').update(signer.publicKey).digest('hex')

/** The text of `signature.json` for these manifest bytes. */
export function signatureJson(signer: Signer, manifest: Buffer, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    signature_version: '1.0',
    algorithm: signer.algorithm,
    public_key: signer.publicKey.toString('base64'),
    signed: 'manifest.json',
    manifest_sha256: crypto.createHash('sha256').update(manifest).digest('hex'),
    signature: signer.sign(manifest).toString('base64'),
    ...overrides,
  })
}

export interface SignedOptions extends WsnpOptions {
  /** Edit the manifest after it was signed: what someone does who unzips the file. */
  editAfterSigning?: (manifest: Record<string, unknown>) => void
  /** Also put the new manifest's SHA-256 in `signature.json`, as a careful editor would (the signature itself then fails). */
  fixHash?: boolean
  /** Replace or add fields of `signature.json`. */
  signature?: Record<string, unknown>
}

/** Writes a .wsnp of format 1.1 signed by `signer`, optionally edited after signing. */
export async function writeSignedWsnp(path: string, files: FixtureFile[], signer: Signer, options: SignedOptions = {}): Promise<void> {
  const manifest = manifestFor(files, { ...options, manifest: { format_version: '1.1', ...options.manifest } })
  const signed = Buffer.from(JSON.stringify(manifest, null, 2))
  let stored = signed
  if (options.editAfterSigning) {
    const edited = JSON.parse(signed.toString('utf8')) as Record<string, unknown>
    options.editAfterSigning(edited)
    stored = Buffer.from(JSON.stringify(edited, null, 2))
  }
  const overrides = { ...(options.fixHash ? { manifest_sha256: crypto.createHash('sha256').update(stored).digest('hex') } : {}), ...options.signature }
  await writeZip(path, [
    { name: 'mimetype', data: WSNP_TYPE },
    { name: 'manifest.json', data: stored, compress: true },
    { name: 'signature.json', data: signatureJson(signer, signed, overrides), compress: true },
    ...files.map((f) => ({ name: f.path, data: typeof f.data === 'string' ? Buffer.from(f.data) : f.data, compress: false })),
  ])
}
