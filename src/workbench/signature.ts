import type { SignatureInfo } from '@core/validate/signature.ts'
import type { Translate } from '@/i18n/index.ts'

export type Signers = Record<string, { name?: string }>

export interface SignatureView {
  /** `unsigned` is a quiet notice, `new` asks the user to decide, `invalid` holds the snapshot back. */
  level: 'trusted' | 'new' | 'unsigned' | 'invalid'
  icon: string
  /** One or two words, for the status bar. */
  short: string
  /** The sentence for the metadata view. */
  text: string
}

/** What a signature means to the user: who signed, whether the viewer has been told to trust them, and whether the manifest is intact. */
export function describeSignature(t: Translate, info: SignatureInfo, signers: Signers): SignatureView {
  if (info.state === 'unsigned') return { level: 'unsigned', icon: 'unverified', short: t('status.unsigned'), text: t('metadata.unsigned') }
  if (info.state === 'invalid') return { level: 'invalid', icon: 'error', short: t('status.invalid'), text: t(`signature.invalid.${info.reason}`) }
  const trusted = signers[info.fingerprint]
  if (!trusted) return { level: 'new', icon: 'shield', short: t('signature.shortNew'), text: t('signature.signedNew', { fingerprint: info.fingerprintShort }) }
  return {
    level: 'trusted',
    icon: 'verified',
    short: t('signature.shortTrusted'),
    text: trusted.name ? t('signature.signedKnown', { name: trusted.name, fingerprint: info.fingerprintShort }) : t('signature.signedTrusted', { fingerprint: info.fingerprintShort }),
  }
}
