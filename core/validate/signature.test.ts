import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleFiles } from '../../fixtures/build.ts'
import { ecdsaSigner, ed25519Signer, fingerprintHex, signatureJson, writeSignedWsnp, type SignedOptions, type Signer } from '../../fixtures/sign.ts'
import { writeZip } from '../archive/writer.ts'
import { openWsnp } from './index.ts'
import { shortFingerprint, verifySignature, type SignatureInfo } from './signature.ts'

let dir: string
beforeAll(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-sign-'))))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

let n = 0
/** Writes a file with `signer` and the `options`, opens it, and says what its signature is. */
async function check(signer: Signer, options: SignedOptions = {}): Promise<SignatureInfo> {
  const file = path.join(dir, `s${n++}.wsnp`)
  await writeSignedWsnp(file, sampleFiles(), signer, options)
  const result = await openWsnp(file)
  if (!result.ok) throw new Error(`did not open: ${JSON.stringify(result.issues)}`)
  try {
    return await verifySignature(result.archive)
  } finally {
    await result.archive.close()
  }
}

describe('the known answer of FORMAT.md section 12', () => {
  // An Ed25519 key from the seed 00 01 … 1f signs these manifest bytes. Ed25519 is deterministic, so a writer can check its own code against this.
  const seed = Buffer.from(Array.from({ length: 32 }, (_, i) => i))
  const manifest = Buffer.from('{"format":"wsnp","format_version":"1.1","title":"Known answer"}\n')
  it('gives the same key, hash, signature and fingerprint in every implementation', () => {
    const signer = ed25519Signer(seed)
    expect(signer.publicKey.toString('base64')).toBe('A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=')
    const record = JSON.parse(signatureJson(signer, manifest)) as Record<string, string>
    expect(record.manifest_sha256).toBe('5d7ad4fd156257bf10d2772ee5a6c2f41e7cb835e0732c3d3fc0f7e765db9c60')
    expect(record.signature).toBe('wVPgpLe7+q5VYI58HQ2USJbELBdfrPo1hkQzauk0lzTLLo5V0jL/2fumEDdo+rjgdFKAf6SM5Bei8Tx7VY33AA==')
    expect(fingerprintHex(signer)).toBe('56475aa75463474c0285df5dbf2bcab73da651358839e9b77481b2eab107708c')
    expect(shortFingerprint(fingerprintHex(signer))).toBe('5647-5AA7-5463-474C-0285-DF5D-BF2B-CAB7')
  })
})

describe('verifySignature', () => {
  it('says a file with no signature.json is unsigned, which is not an error', async () => {
    const file = path.join(dir, 'unsigned.wsnp')
    const { writeSampleWsnp } = await import('../../fixtures/build.ts')
    await writeSampleWsnp(file)
    const result = await openWsnp(file)
    if (!result.ok) throw new Error('did not open')
    expect(await verifySignature(result.archive)).toEqual({ state: 'unsigned' })
    await result.archive.close()
  })
  it('accepts a signature that checks, and says who signed: the algorithm, the key and its fingerprint', async () => {
    const signer = ed25519Signer()
    const info = await check(signer)
    expect(info).toMatchObject({ state: 'valid', algorithm: 'Ed25519', publicKey: signer.publicKey.toString('base64'), fingerprint: fingerprintHex(signer) })
    expect(info.state === 'valid' && info.fingerprintShort).toMatch(/^([0-9A-F]{4}-){7}[0-9A-F]{4}$/)
  })
  it('accepts ECDSA P-256 as well', async () => {
    const signer = ecdsaSigner()
    expect(await check(signer)).toMatchObject({ state: 'valid', algorithm: 'ECDSA-P256-SHA256', fingerprint: fingerprintHex(signer) })
  })
  it('opens a signed file although signature.json is not in the manifest (the one entry besides mimetype and manifest.json that is not listed)', async () => {
    const file = path.join(dir, 'signed-open.wsnp')
    await writeSignedWsnp(file, sampleFiles(), ed25519Signer())
    const result = await openWsnp(file)
    expect(result.ok).toBe(true)
    if (result.ok) await result.archive.close()
  })

  it('catches the manifest being edited after signing (its hash is no longer the one signed)', async () => {
    expect(await check(ed25519Signer(), { editAfterSigning: (m) => (m.title = 'Edited title') })).toEqual({ state: 'invalid', reason: 'manifest-mismatch' })
    expect(await check(ecdsaSigner(), { editAfterSigning: (m) => ((m.source as { url: string }).url = 'https://elsewhere.example/') })).toEqual({ state: 'invalid', reason: 'manifest-mismatch' })
  })
  it('catches an editor who also puts the new hash in signature.json: the signature itself fails', async () => {
    expect(await check(ed25519Signer(), { editAfterSigning: (m) => (m.created = '2020-01-01T00:00:00.000Z'), fixHash: true })).toEqual({ state: 'invalid', reason: 'bad-signature' })
    expect(await check(ecdsaSigner(), { editAfterSigning: (m) => (m.title = 'x'), fixHash: true })).toEqual({ state: 'invalid', reason: 'bad-signature' })
  })
  it('catches a signature that is not the manifest\'s: another key\'s signature under this key, or one byte changed', async () => {
    const a = ed25519Signer()
    const b = ed25519Signer()
    expect(await check(a, { signature: { public_key: b.publicKey.toString('base64') } })).toEqual({ state: 'invalid', reason: 'bad-signature' })
    const flipped = Buffer.from(JSON.parse(signatureJson(a, Buffer.from('x'))).signature as string, 'base64')
    flipped[0] ^= 1
    expect(await check(a, { signature: { signature: flipped.toString('base64') } })).toEqual({ state: 'invalid', reason: 'bad-signature' })
  })
  it('shows a file someone else re-signed after editing as valid with another fingerprint: that is what the viewer tells apart', async () => {
    const theirs = ed25519Signer()
    const mine = ed25519Signer()
    const edited = await check(theirs, { editAfterSigning: (m) => (m.title = 'Edited'), fixHash: false })
    expect(edited.state).toBe('invalid')
    // Edited and signed again by another key: it verifies, and the signer is not the original one.
    const info = await check(mine)
    expect(info.state === 'valid' && info.fingerprint).toBe(fingerprintHex(mine))
    expect(info.state === 'valid' && info.fingerprint).not.toBe(fingerprintHex(theirs))
  })

  it('says a signature it cannot use is invalid, not unsigned: an unknown algorithm, garbage, the wrong sizes', async () => {
    const signer = ed25519Signer()
    expect(await check(signer, { signature: { algorithm: 'RSA-PSS' } })).toEqual({ state: 'invalid', reason: 'unsupported' })
    expect(await check(signer, { signature: { signed: 'index.html' } })).toEqual({ state: 'invalid', reason: 'unreadable' })
    expect(await check(signer, { signature: { public_key: Buffer.alloc(31).toString('base64') } })).toEqual({ state: 'invalid', reason: 'unreadable' })
    expect(await check(signer, { signature: { signature: Buffer.alloc(10).toString('base64') } })).toEqual({ state: 'invalid', reason: 'unreadable' })
    expect(await check(signer, { signature: { public_key: 'not base64!' } })).toEqual({ state: 'invalid', reason: 'unreadable' })
    const file = path.join(dir, 'garbage.wsnp')
    const base = path.join(dir, 'garbage-base.wsnp')
    await writeSignedWsnp(base, sampleFiles(), signer)
    const { openArchive } = await import('../archive/reader.ts')
    const archive = await openArchive(base)
    const entries = await Promise.all(archive.entries.map(async (e) => ({ name: e.name, data: e.name === 'signature.json' ? Buffer.from('{not json') : await archive.read(e.name) })))
    await archive.close()
    await writeZip(file, entries)
    const result = await openWsnp(file)
    if (!result.ok) throw new Error('did not open')
    expect(await verifySignature(result.archive)).toEqual({ state: 'invalid', reason: 'unreadable' })
    await result.archive.close()
  })
  it('does not take an ECDSA key that is not a point of the curve', async () => {
    const signer = ecdsaSigner()
    const bad = Buffer.alloc(65, 4)
    expect(await check(signer, { signature: { public_key: bad.toString('base64') } })).toMatchObject({ state: 'invalid' })
  })
})

describe('shortFingerprint', () => {
  it('is the first 128 bits, upper case, in groups of four', () => {
    expect(shortFingerprint('0123456789abcdef0123456789abcdef' + 'f'.repeat(32))).toBe('0123-4567-89AB-CDEF-0123-4567-89AB-CDEF')
  })
})
