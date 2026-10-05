import { describe, expect, it } from 'vitest'
import { translator } from '@/i18n/index.ts'
import { describeSignature } from './signature.ts'

const t = translator('en')
const FP = 'cd'.repeat(32)
const valid = { state: 'valid', algorithm: 'Ed25519', publicKey: 'AAAA', fingerprint: FP, fingerprintShort: 'CDCD-CDCD-CDCD-CDCD-CDCD-CDCD-CDCD-CDCD' } as const

describe('describeSignature', () => {
  it('says unsigned quietly: a notice, not an error', () => {
    expect(describeSignature(t, { state: 'unsigned' }, {})).toMatchObject({ level: 'unsigned', short: 'Not signed' })
  })
  it('says a key it does not know is new, and one the user trusts is trusted, by name when it has one', () => {
    expect(describeSignature(t, valid, {})).toMatchObject({ level: 'new', short: 'Signed (new key)' })
    expect(describeSignature(t, valid, { [FP]: {} })).toMatchObject({ level: 'trusted', short: 'Signed' })
    expect(describeSignature(t, valid, { [FP]: { name: 'Mine' } }).text).toContain('Signed by Mine (CDCD-')
    expect(describeSignature(t, valid, { [FP]: {} }).text).toContain('Signed by a key you trust')
  })
  it('does not trust a key because another is trusted', () => {
    expect(describeSignature(t, valid, { ['ef'.repeat(32)]: { name: 'Someone else' } }).level).toBe('new')
  })
  it('says why a signature does not check, in words for each reason', () => {
    for (const reason of ['manifest-mismatch', 'bad-signature', 'unreadable', 'unsupported'] as const) {
      const view = describeSignature(t, { state: 'invalid', reason }, {})
      expect(view.level).toBe('invalid')
      expect(view.text.length).toBeGreaterThan(20)
    }
    expect(describeSignature(t, { state: 'invalid', reason: 'manifest-mismatch' }, {}).text).toContain('edited after it was signed')
  })
  it('speaks Portuguese too', () => {
    expect(describeSignature(translator('pt-BR'), valid, {}).short).toBe('Assinado (chave nova)')
    expect(describeSignature(translator('pt-BR'), { state: 'unsigned' }, {}).short).toBe('Sem assinatura')
  })
})
