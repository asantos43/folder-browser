import crypto from 'node:crypto'
import type { Archive } from '../archive/reader.ts'

/** The signed manifest of FORMAT.md section 12: who signed it, and whether the manifest is what they signed. */
export type SignatureInfo =
  | { state: 'unsigned' }
  | {
      state: 'valid'
      algorithm: Algorithm
      /** The public key, in base64, as the file has it. */
      publicKey: string
      /** The SHA-256 of the public key: what identifies the signer. */
      fingerprint: string
      /** The fingerprint as people read it: the first 128 bits, in groups of four (`3F2A-91C0-…`). */
      fingerprintShort: string
    }
  | { state: 'invalid'; reason: 'unreadable' | 'unsupported' | 'manifest-mismatch' | 'bad-signature' }

export type Algorithm = 'Ed25519' | 'ECDSA-P256-SHA256'

/** `signature.json` is the one entry besides `mimetype` and `manifest.json` that the manifest does not list. */
export const SIGNATURE_ENTRY = 'signature.json'

const SPKI_PREFIX: Record<Algorithm, Buffer> = {
  Ed25519: Buffer.from('302a300506032b6570032100', 'hex'),
  'ECDSA-P256-SHA256': Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
}
const KEY_BYTES: Record<Algorithm, number> = { Ed25519: 32, 'ECDSA-P256-SHA256': 65 }
const SIGNATURE_BYTES = 64

/** The SHA-256 of a public key, in lowercase hex. */
export const fingerprintOf = (publicKey: Buffer): string => crypto.createHash('sha256').update(publicKey).digest('hex')

/** `56475aa7-5463-474c-0285-df5dbf2b-…`: the first 128 bits, in groups of four hex digits, upper case. */
export const shortFingerprint = (fingerprint: string): string =>
  (fingerprint
    .slice(0, 32)
    .toUpperCase()
    .match(/.{4}/g) ?? []
  ).join('-')

const isBase64 = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(v)

/**
 * Checks the signature of a file (FORMAT.md section 12). Nothing is read but `manifest.json` and `signature.json`, so it is as fast
 * as opening the file. A file with no `signature.json` is `unsigned`, which is not an error: every file written before 1.1 is.
 */
export async function verifySignature(archive: Archive): Promise<SignatureInfo> {
  if (!archive.get(SIGNATURE_ENTRY)) return { state: 'unsigned' }
  if ((archive.get(SIGNATURE_ENTRY)?.size ?? 0) > 16 * 1024) return { state: 'invalid', reason: 'unreadable' }
  let record: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse((await archive.read(SIGNATURE_ENTRY)).toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { state: 'invalid', reason: 'unreadable' }
    record = parsed as Record<string, unknown>
  } catch {
    return { state: 'invalid', reason: 'unreadable' }
  }
  const algorithm = record.algorithm
  if (algorithm !== 'Ed25519' && algorithm !== 'ECDSA-P256-SHA256') return { state: 'invalid', reason: 'unsupported' }
  if (record.signed !== 'manifest.json' || !isBase64(record.public_key) || !isBase64(record.signature) || typeof record.manifest_sha256 !== 'string') return { state: 'invalid', reason: 'unreadable' }
  const publicKey = Buffer.from(record.public_key, 'base64')
  const signature = Buffer.from(record.signature, 'base64')
  if (publicKey.length !== KEY_BYTES[algorithm] || signature.length !== SIGNATURE_BYTES) return { state: 'invalid', reason: 'unreadable' }

  const manifest = await archive.read('manifest.json')
  // The hash says which manifest was signed; a different manifest is one edited after signing.
  if (crypto.createHash('sha256').update(manifest).digest('hex') !== record.manifest_sha256.toLowerCase()) return { state: 'invalid', reason: 'manifest-mismatch' }
  let ok = false
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX[algorithm], publicKey]), format: 'der', type: 'spki' })
    ok = algorithm === 'Ed25519' ? crypto.verify(null, manifest, key, signature) : crypto.verify('sha256', manifest, { key, dsaEncoding: 'ieee-p1363' }, signature)
  } catch {
    // a key that is not a point of the curve, for example
    return { state: 'invalid', reason: 'unreadable' }
  }
  if (!ok) return { state: 'invalid', reason: 'bad-signature' }
  const fingerprint = fingerprintOf(publicKey)
  return { state: 'valid', algorithm, publicKey: record.public_key, fingerprint, fingerprintShort: shortFingerprint(fingerprint) }
}
