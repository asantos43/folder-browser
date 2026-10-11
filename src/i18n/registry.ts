/** Renderer-local structural contracts: no plugin runtime is imported at startup. */
export interface LocaleCatalog {
  readonly language: string
  readonly label: string
  readonly load: () => Readonly<Record<string, string>>
}
export type OwnerTexts = Readonly<Record<string, Readonly<{ en?: string; 'pt-BR'?: string }>>>

const encoder = new TextEncoder()
// Same text boundary as the install-time compiler; TAB and bidi marks are literal text.
// eslint-disable-next-line no-control-regex
const controls = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u2028\u2029]/u
function checked(text: string): string {
  if (typeof text !== 'string' || controls.test(text) || encoder.encode(text).length > 2048) {
    throw new Error('Invalid locale text: controls or more than 2 KiB UTF-8')
  }
  return text
}

/** Only the selected locale is materialised. Selection survives removal/update. */
export class I18nRegistry {
  private owners = new Map<string, { locales: readonly LocaleCatalog[]; texts: OwnerTexts }>()
  private tags = new Map<string, LocaleCatalog>()
  private active = new Map<string, string>()
  private preference = 'en'
  private effective = 'en'
  private listeners = new Set<() => void>()
  private revision = 0
  private pending = false

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  version = (): number => this.revision
  private changed(): void {
    this.revision++
    if (this.pending) return
    this.pending = true
    queueMicrotask(() => {
      this.pending = false
      for (const listener of this.listeners) {
        try { listener() } catch { /* An observer cannot prevent publication to others. */ }
      }
    })
  }

  private readonly core: Readonly<Record<string, Readonly<Record<string, string>>>>

  constructor(core: Readonly<Record<string, Readonly<Record<string, string>>>>) {
    this.core = core
  }

  get selection(): Readonly<{ requested: string; effective: string; unavailable: boolean }> {
    return { requested: this.preference, effective: this.effective, unavailable: this.preference !== this.effective }
  }

  listLanguages(): readonly { language: string; label: string }[] {
    return [...this.tags.values()].map(({ language, label }) => ({ language, label }))
  }

  listAvailableLanguages(): readonly { language: string; label: string }[] {
    return [
      ...Object.keys(this.core).map(language => ({ language, label: language === 'en' ? 'English' : language === 'pt-BR' ? 'Português (Brasil)' : language })),
      ...this.listLanguages(),
    ]
  }

  /** Replacement is atomic; collisions refuse activation, including built-in tags. */
  setPlugin(owner: string, locales: readonly LocaleCatalog[], texts: OwnerTexts = {}): void {
    if (!/^[a-z][a-z0-9._-]*$/i.test(owner)) throw new Error('Invalid locale owner')
    const tags = new Set<string>()
    for (const locale of locales) {
      if (Intl.getCanonicalLocales(locale.language)[0] !== locale.language || Object.hasOwn(this.core, locale.language)
        || tags.has(locale.language) || [...this.owners].some(([id, entry]) => id !== owner && entry.locales.some(l => l.language === locale.language))) {
        throw new Error('Locale tag collision or invalid tag')
      }
      tags.add(locale.language)
    }
    const copy: Record<string, { en?: string; 'pt-BR'?: string }> = Object.create(null)
    const occupied = new Set<string>()
    for (const [id, other] of this.owners) if (id !== owner) {
      for (const key of Object.keys(other.texts)) occupied.add(`${id}.${key}`)
    }
    if (Object.keys(texts).length > 3000) throw new Error('Too many plugin text keys')
    for (const [key, entry] of Object.entries(texts)) {
      if (!/^[a-z][a-zA-Z0-9._-]{0,255}$/.test(key)) throw new Error('Invalid plugin text key')
      if (Object.hasOwn(this.core.en, `${owner}.${key}`)) throw new Error('Built-in text collision')
      if (occupied.has(`${owner}.${key}`)) throw new Error('Plugin text scope collision')
      copy[key] = { ...(entry.en !== undefined ? { en: checked(entry.en) } : {}),
        ...(entry['pt-BR'] !== undefined ? { 'pt-BR': checked(entry['pt-BR']) } : {}) }
    }
    const previous = this.owners.get(owner)
    this.owners.set(owner, { locales: locales.map(l => ({ ...l })), texts: copy })
    try { this.rebuild() } catch (error) {
      if (previous) this.owners.set(owner, previous)
      else this.owners.delete(owner)
      throw error
    }
    this.changed()
  }

  removePlugin(owner: string): void {
    if (!this.owners.delete(owner)) return
    this.rebuild()
    this.changed()
  }

  select(language: string): void {
    if (language === this.preference) return
    const previous = this.preference
    this.preference = language
    try { this.rebuild() } catch (error) { this.preference = previous; throw error }
    this.changed()
  }

  /** Core-only resolver: security callers never consult third-party locales. */
  coreText(key: string, language = this.preference): string {
    const catalog = Object.hasOwn(this.core, language) ? this.core[language] : undefined
    return (catalog && Object.hasOwn(catalog, key) ? catalog[key] : undefined)
      ?? (Object.hasOwn(this.core.en, key) ? this.core.en[key] : undefined) ?? key
  }

  resolve(key: string): string {
    if (Object.hasOwn(this.core.en, key)) return this.active.get(key) ?? this.coreText(key)
    return this.active.get(key) ?? key
  }

  private rebuild(): void {
    const tags = new Map<string, LocaleCatalog>()
    for (const entry of this.owners.values()) for (const locale of entry.locales) tags.set(locale.language, locale)
    const locale = tags.get(this.preference)
    const active = new Map<string, string>()
    if (locale) {
      const translations = locale.load()
      if (Object.keys(translations).length > 3000) throw new Error('Too many locale keys')
      for (const [key, text] of Object.entries(translations)) {
        const value = checked(text)
        if (Object.hasOwn(this.core.en, key)) active.set(key, value)
      }
    }
    for (const [owner, entry] of this.owners) for (const [key, text] of Object.entries(entry.texts)) {
      const value = (this.preference === 'pt-BR' ? text['pt-BR'] : this.preference === 'en' ? text.en : undefined) ?? text.en
      const scoped = `${owner}.${key}`
      if (value !== undefined && !Object.hasOwn(this.core.en, scoped)) active.set(scoped, value)
    }
    this.tags = tags
    this.active = active
    this.effective = locale || Object.hasOwn(this.core, this.preference) ? this.preference : 'en'
  }
}
