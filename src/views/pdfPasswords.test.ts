import { beforeEach, describe, expect, it } from 'vitest'
import { clearPdfPasswords, forgetPdfPassword, getPdfPassword, pdfPasswordKey, rememberPdfPassword } from './pdfPasswords.ts'

describe('pdfPasswordKey', () => {
  it('returns the same key for the same id, size and bytes', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5])
    const b = new Uint8Array([1, 2, 3, 4, 5])
    expect(pdfPasswordKey('snap:path', a)).toBe(pdfPasswordKey('snap:path', b))
  })

  it('changes when the id changes', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5])
    expect(pdfPasswordKey('snap:a', a)).not.toBe(pdfPasswordKey('snap:b', a))
  })

  it('changes when the size changes', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5])
    const b = new Uint8Array([1, 2, 3, 4, 5, 6])
    expect(pdfPasswordKey('snap:a', a)).not.toBe(pdfPasswordKey('snap:a', b))
  })

  it('changes when a byte at the start changes', () => {
    const a = new Uint8Array(8192).fill(0xaa)
    const b = new Uint8Array(8192).fill(0xaa)
    b[0] = 0xab
    expect(pdfPasswordKey('snap:a', a)).not.toBe(pdfPasswordKey('snap:a', b))
  })

  it('changes when a byte at the end changes', () => {
    const a = new Uint8Array(8192).fill(0xaa)
    const b = new Uint8Array(8192).fill(0xaa)
    b[8191] = 0xab
    expect(pdfPasswordKey('snap:a', a)).not.toBe(pdfPasswordKey('snap:a', b))
  })

  it('does not change when a byte in the middle (outside the sampled ranges) changes', () => {
    const a = new Uint8Array(16384).fill(0xaa)
    const b = new Uint8Array(16384).fill(0xaa)
    b[8000] = 0xab
    expect(pdfPasswordKey('snap:a', a)).toBe(pdfPasswordKey('snap:a', b))
  })

  it('hashes the whole file when it is smaller than 8 KiB', () => {
    const a = new Uint8Array(2000).fill(0xaa)
    const b = new Uint8Array(2000).fill(0xaa)
    b[1999] = 0xab
    expect(pdfPasswordKey('snap:a', a)).not.toBe(pdfPasswordKey('snap:a', b))
  })

  it('is a string of the right shape', () => {
    const key = pdfPasswordKey('snap:a/b', new Uint8Array([1, 2, 3]))
    expect(key).toMatch(/^snap:a\/b\|3\|[0-9a-f]{16}$/)
  })
})

describe('the password map', () => {
  beforeEach(() => clearPdfPasswords())

  it('returns undefined for a key it does not know', () => {
    expect(getPdfPassword('k')).toBeUndefined()
  })

  it('remembers and reads a password', () => {
    rememberPdfPassword('k', 'secret')
    expect(getPdfPassword('k')).toBe('secret')
  })

  it('forgets a password', () => {
    rememberPdfPassword('k', 'secret')
    forgetPdfPassword('k')
    expect(getPdfPassword('k')).toBeUndefined()
  })

  it('forgetting a key that is not there is a no-op', () => {
    expect(() => forgetPdfPassword('nope')).not.toThrow()
  })

  it('clears every password', () => {
    rememberPdfPassword('a', '1')
    rememberPdfPassword('b', '2')
    clearPdfPasswords()
    expect(getPdfPassword('a')).toBeUndefined()
    expect(getPdfPassword('b')).toBeUndefined()
  })

  it('ignores an empty password, leaving any prior entry in place', () => {
    rememberPdfPassword('k', 'first')
    rememberPdfPassword('k', '')
    expect(getPdfPassword('k')).toBe('first')
  })

  it('keeps the 32 most recent: the 33rd distinct key evicts the oldest', () => {
    for (let i = 0; i < 32; i++) rememberPdfPassword(`k${i}`, `p${i}`)
    rememberPdfPassword('k32', 'p32')
    expect(getPdfPassword('k0')).toBeUndefined()
    expect(getPdfPassword('k32')).toBe('p32')
  })

  it('reading an entry renews it (LRU): the entry that was read survives, the next oldest goes', () => {
    for (let i = 0; i < 32; i++) rememberPdfPassword(`k${i}`, `p${i}`)
    expect(getPdfPassword('k0')).toBe('p0')
    rememberPdfPassword('k32', 'p32')
    expect(getPdfPassword('k0')).toBe('p0')
    expect(getPdfPassword('k1')).toBeUndefined()
  })

  it('updating an existing key keeps the map at the same size and moves the key to the most recent', () => {
    for (let i = 0; i < 32; i++) rememberPdfPassword(`k${i}`, `p${i}`)
    rememberPdfPassword('k0', 'updated')
    rememberPdfPassword('k32', 'p32')
    expect(getPdfPassword('k0')).toBe('updated')
    expect(getPdfPassword('k1')).toBeUndefined()
  })
})

describe('pdfPasswordKey performance: a large file is read like a small one', () => {
  it('hashes a 100 MB file in less than 20 ms (only reads 8 KiB); falls back to 20 MB if the allocation is slow', () => {
    const HUNDRED_MB = 100 * 1024 * 1024
    const TWENTY_MB = 20 * 1024 * 1024
    const allocStart = performance.now()
    let bytes = new Uint8Array(HUNDRED_MB)
    let size = HUNDRED_MB
    if (performance.now() - allocStart >= 100) {
      bytes = new Uint8Array(TWENTY_MB)
      size = TWENTY_MB
    }
    bytes.fill(0)
    const start = performance.now()
    const key = pdfPasswordKey('snap:big', bytes)
    const took = performance.now() - start
    expect(took).toBeLessThan(20)
    expect(key.startsWith(`snap:big|${size}|`)).toBe(true)
  })
})
