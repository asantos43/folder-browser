/**
 * Language associations registered by plugins: a `(key -> languageId)` index
 * keyed by file extension (`.py`) or by whole filename (`Makefile`).
 *
 * **No plugin code runs here.** The registry consumes the compiled payloads
 * already produced by `core/plugins/compile.ts`; it never reads source files,
 * never scans the disk and never parses the bytes of a file the user opens.
 *
 * **Built-in protection.** Languages registered by the host (the ones in
 * `core/filekind.ts:LANGUAGES` and the table of `effectiveType`) and the
 * extensions the host already classifies as text (`builtinExtensions`) are
 * protected: a plugin cannot replace them. The compiled loader already refuses
 * a plugin extension that overlaps a built-in at install time, so the registry
 * is the runtime side of that guarantee.
 *
 * **Order.** Inside one package, the first language that declared a key wins;
 * across packages, the activation order is the order of `set`, and the second
 * registrant is dropped (the host emits a warning and the plugin keeps its
 * contribution list — nothing is removed; the rule is the same one the
 * compile step applies: duplicates stay in the list, the editor picks the
 * first). Removing a package drops only its own entries; built-ins are
 * untouched.
 *
 * **Special types are not promoted.** The registry is consulted only by
 * `filekind.ts`; types that the host classifies as binary, document, ZIP or
 * snapshot (`viewKind` already says so) are answered by the host without
 * touching the plugin data. Adding a new language never turns a binary file
 * into a text tab.
 */
// The registry works on a structural subset of what `core/plugins/compile.ts`
// produces (`CompiledLanguage`). The test under `core/plugins/compile.test.ts`
// walks every production module to keep the compile module out of the startup
// path, so the registry does not import from `compile.ts`. At runtime, the
// compiled payload matches the `LanguageEntry` shape here.

/**
 * Lowercase key in the form `extensionKey(name)` returns it: the extension
 * without a leading dot, or the whole basename when the file has none. The
 * manifest's `extensions` carry a leading dot (`.foo`); we strip it so the
 * index matches `extensionKey` (e.g. `script.foo` → `foo`). Empty keys and
 * the bare `.`/`..` are refused; separators and upper-case are normalised.
 */
function normaliseKey(raw: string): string | null {
  if (typeof raw !== 'string') return null
  let text = raw.trim().toLowerCase()
  if (text === '' || /[/\\]/.test(text)) return null
  if (text.startsWith('.')) text = text.slice(1)
  if (text === '' || text === '.' || text === '..') return null
  return text
}

/** Structural subset of a compiled language — no install-time module is imported here. */
export interface LanguageEntry {
  readonly id: string
  readonly label: string
  readonly languageId: string
  readonly extensions: readonly string[]
  readonly filenames: readonly string[]
}

/** Structural subset of a package — the registry only sees what it needs. */
export interface LanguagePackage {
  pluginId: string
  languages: readonly LanguageEntry[]
}

/** What the host reports back when a set is partial. The host decides what to do with it. */
export interface LanguageWarning {
  owner: string
  code: 'language.duplicate' | 'language.builtin' | 'language.invalid' | 'language.id-overlap'
  key: string
  message: string
}

/** Plug into `filekind.ts`. */
export interface LanguageIndex {
  /** Look up a language by the key the file's extension/name produces. */
  get(key: string): string | undefined
  /** Number of plugin-owned keys currently indexed. */
  size(): number
  /** All keys in insertion order, owner first, then the next owner: debug only. */
  debugEntries(): readonly { owner: string; key: string; languageId: string }[]
}

/**
 * Owned language catalog. A `set` replaces the owner's previous package; a
 * `remove` drops only this owner. Built-ins are passed in once and never
 * touch the plugin side: the host's `languageOf` and `effectiveType` answer
 * first, and only when they do not have a result the plugin index is read.
 */
export class LanguageRegistry {
  private packages = new Map<string, LanguageEntry[]>()
  private warnings: LanguageWarning[] = []
  private index: Map<string, { owner: string; languageId: string }> = new Map()
  private keys: string[] = []

  /** Insertion order so warnings and conflicts are reproducible between runs. */
  private order: string[] = []

  private readonly builtinKeys: ReadonlySet<string>

  constructor(builtinKeys: ReadonlySet<string>) { this.builtinKeys = builtinKeys }
  private batching = false
  transaction(operation: () => void): void {
    if (this.batching) throw new Error('Nested language transaction')
    const packages = new Map(this.packages), index = new Map(this.index), warnings = [...this.warnings], keys = [...this.keys], order = [...this.order]
    this.batching = true
    try { operation() } catch (error) {
      this.packages = packages; this.index = index; this.warnings = warnings; this.keys = keys; this.order = order
      throw error
    } finally { this.batching = false }
  }

  /** Validate with the same index rules, without changing this live registry. */
  validate(value: LanguagePackage): void {
    const staged = new LanguageRegistry(this.builtinKeys)
    for (const [pluginId, languages] of this.packages) if (pluginId !== value.pluginId) staged.set({ pluginId, languages })
    staged.warnings = []
    staged.set(value)
    if (staged.warnings.some(warning => warning.owner === value.pluginId && warning.code !== 'language.duplicate')) throw new Error('Invalid plugin language association')
    if (value.languages.some(entry => [...entry.extensions, ...entry.filenames].some(raw => {
      const key = normaliseKey(raw)
      return key !== null && this.index.has(key) && this.index.get(key)?.owner !== value.pluginId
    }))) throw new Error('Language association owned by another plugin')
  }

  /**
   * Install or replace one package's languages. The host decides when to call
   * this (install, update, enable); the registry is idempotent within the
   * same owner. The given `entries` are detached copies; the registry never
   * mutates the input.
   */
  set(value: LanguagePackage): void {
    const previous = this.packages.get(value.pluginId)
    if (previous) this.removeKeys(value.pluginId, previous)
    const entries: LanguageEntry[] = []
    const seenForOwner = new Set<string>()
    for (const entry of value.languages ?? []) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.languageId !== 'string' || !entry.languageId) {
        this.warnings.push({ owner: value.pluginId, code: 'language.invalid', key: '', message: 'language entry is missing an id or languageId' })
        continue
      }
      const detached: LanguageEntry = {
        id: entry.id, label: entry.label, languageId: entry.languageId,
        extensions: Object.freeze([...entry.extensions ?? []]),
        filenames: Object.freeze([...entry.filenames ?? []]),
      }
      const seenKeysForEntry = new Set<string>()
      let indexed = 0
      for (const raw of [...(entry.extensions ?? []), ...(entry.filenames ?? [])]) {
        const key = normaliseKey(raw)
        if (key === null) {
          this.warnings.push({ owner: value.pluginId, code: 'language.invalid', key: String(raw), message: 'extension or filename is empty, contains a separator, or is "." or ".."' })
          continue
        }
        if (seenKeysForEntry.has(key)) {
          this.warnings.push({ owner: value.pluginId, code: 'language.duplicate', key, message: `the key "${key}" is declared twice in the same language; the first occurrence wins and every occurrence stays in the compiled list` })
          continue
        }
        seenKeysForEntry.add(key)
        if (this.builtinKeys.has(key)) {
          this.warnings.push({ owner: value.pluginId, code: 'language.builtin', key, message: `the key "${key}" is already handled by the host; it cannot be taken by a plugin` })
          continue
        }
        if (seenForOwner.has(key)) {
          this.warnings.push({ owner: value.pluginId, code: 'language.duplicate', key, message: `the key "${key}" is declared by another language of this package; the first language that declared it wins` })
          continue
        }
        const current = this.index.get(key)
        if (current && current.owner !== value.pluginId) {
          this.warnings.push({ owner: value.pluginId, code: 'language.duplicate', key, message: `the key "${key}" is already taken by package "${current.owner}"; the first package wins, the second's entry is kept in the list but not indexed` })
          continue
        }
        if (!current) this.order.push(key)
        this.index.set(key, { owner: value.pluginId, languageId: entry.languageId })
        seenForOwner.add(key)
        this.keys.push(key)
        indexed++
      }
      if (indexed > 0 || (entry.extensions?.length === 0 && entry.filenames?.length === 0)) entries.push(detached)
    }
    this.packages.set(value.pluginId, entries)
  }

  /** Drop only this owner's contributions. Unknown owners are harmless. */
  remove(pluginId: string): void {
    const previous = this.packages.get(pluginId)
    if (!previous) return
    this.removeKeys(pluginId, previous)
    this.packages.delete(pluginId)
  }

  /** Look up by lowercase key. */
  lookup(key: string): string | undefined {
    const text = key.toLowerCase()
    return this.index.get(text)?.languageId
  }

  /** Number of plugin-owned keys currently indexed. */
  size(): number { return this.index.size }

  /** All warnings collected since construction, in the order they were emitted. */
  drainWarnings(): LanguageWarning[] {
    const out = this.warnings
    this.warnings = []
    return out
  }

  /** Test-only view: every key with its owner. The order matches insertion. */
  debugEntries(): readonly { owner: string; key: string; languageId: string }[] {
    return this.order.map(key => {
      const entry = this.index.get(key)!
      return { owner: entry.owner, key, languageId: entry.languageId }
    })
  }

  private removeKeys(pluginId: string, entries: readonly LanguageEntry[]): void {
    for (const entry of entries) for (const raw of [...entry.extensions, ...entry.filenames]) {
      const key = normaliseKey(raw)
      if (key === null) continue
      const current = this.index.get(key)
      if (current?.owner !== pluginId) continue
      this.index.delete(key)
      const idx = this.order.indexOf(key)
      if (idx >= 0) this.order.splice(idx, 1)
    }
  }
}

/**
 * The runtime view the host reads: the built-in `LANGUAGES`/`effectiveType`
 * answer first (the host already returns the right value); the registry is
 * consulted only for keys the host does not know.
 */
export function createLanguageIndex(registry: LanguageRegistry, owner: string = ''): LanguageIndex {
  return {
    get(key) { return owner === '' ? registry.lookup(key) : undefined },
    size() { return registry.size() },
    debugEntries() { return registry.debugEntries() },
  }
}
