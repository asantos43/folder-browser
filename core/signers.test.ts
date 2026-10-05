import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SignerStore } from './signers.ts'

let dir: string
beforeAll(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-signers-'))))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

describe('SignerStore', () => {
  it('trusts nobody at first, and whom the user says afterwards, by name if they give one', () => {
    const store = new SignerStore(path.join(dir, 'a.json'))
    expect(store.isTrusted(A)).toBe(false)
    expect(store.trust(A, '  PageKeep on this computer  ')).toBe(true)
    expect(store.isTrusted(A)).toBe(true)
    expect(store.list()[A].name).toBe('PageKeep on this computer')
    expect(store.isTrusted(B)).toBe(false)
  })
  it('is kept between runs, and a key can be forgotten', () => {
    const file = path.join(dir, 'b', 'signers.json')
    new SignerStore(file).trust(A, 'Mine')
    const again = new SignerStore(file)
    expect(again.list()[A]).toMatchObject({ name: 'Mine' })
    again.forget(A)
    expect(new SignerStore(file).isTrusted(A)).toBe(false)
  })
  it('keeps the date it was first trusted when it is renamed', () => {
    const store = new SignerStore(path.join(dir, 'c.json'))
    store.trust(A)
    const first = store.list()[A].trustedAt
    store.trust(A, 'Named later')
    expect(store.list()[A]).toMatchObject({ trustedAt: first, name: 'Named later' })
  })
  it('refuses what is not a fingerprint, and starts empty from a missing or damaged file', () => {
    const store = new SignerStore(path.join(dir, 'd.json'))
    for (const bad of ['', 'abc', 'g'.repeat(64), A.toUpperCase(), `${A}0`]) expect(store.trust(bad), bad).toBe(false)
    expect(Object.keys(store.list())).toEqual([])
    const damaged = path.join(dir, 'damaged.json')
    fs.writeFileSync(damaged, '{not json')
    expect(Object.keys(new SignerStore(damaged).list())).toEqual([])
    const odd = path.join(dir, 'odd.json')
    fs.writeFileSync(odd, JSON.stringify({ [A]: { trustedAt: 'x', name: 3 }, nope: { trustedAt: 'x' }, [B]: 'bad' }))
    expect(Object.keys(new SignerStore(odd).list())).toEqual([A])
  })
})
