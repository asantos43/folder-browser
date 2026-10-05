import fs from 'node:fs'
import path from 'node:path'

export interface Signer {
  /** What the user calls the key ("PageKeep on this computer"); optional. */
  name?: string
  trustedAt: string
}

const FINGERPRINT = /^[0-9a-f]{64}$/

/**
 * The signers the user trusts, by the SHA-256 fingerprint of their public key: trust on first use, told by the user (docs/MANIFEST-SIGNING.md).
 * One small JSON file in the user's own profile. A signature proves the manifest was not edited; this list says whose key it is.
 */
export class SignerStore {
  private signers: Record<string, Signer> = {}
  private readonly file: string

  constructor(file: string) {
    this.file = file
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        for (const [fingerprint, value] of Object.entries(raw as Record<string, unknown>)) {
          const entry = value as { name?: unknown; trustedAt?: unknown } | null
          if (FINGERPRINT.test(fingerprint) && typeof entry?.trustedAt === 'string') this.signers[fingerprint] = { trustedAt: entry.trustedAt, ...(typeof entry.name === 'string' ? { name: entry.name } : {}) }
        }
      }
    } catch {
      // no list yet, or one that cannot be read: nobody is trusted yet
    }
  }

  list(): Record<string, Signer> {
    return { ...this.signers }
  }

  isTrusted(fingerprint: string): boolean {
    return fingerprint in this.signers
  }

  /** Trusts a key (or renames one already trusted). Anything that is not a SHA-256 fingerprint is refused. */
  trust(fingerprint: string, name?: string): boolean {
    if (!FINGERPRINT.test(fingerprint)) return false
    const clean = name?.trim().slice(0, 80)
    this.signers[fingerprint] = { trustedAt: this.signers[fingerprint]?.trustedAt ?? new Date().toISOString(), ...(clean ? { name: clean } : {}) }
    this.save()
    return true
  }

  forget(fingerprint: string): void {
    delete this.signers[fingerprint]
    this.save()
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.signers))
    } catch {
      // a list that cannot be saved lasts until the app closes
    }
  }
}
