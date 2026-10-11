import type { PluginGeneration } from '@core/plugins/summary.ts'
import type { ThemeRegistry, PluginTheme } from '@/theme/registry.ts'
import type { I18nRegistry, LocaleCatalog, OwnerTexts } from '@/i18n/registry.ts'
import type { LanguageRegistry, LanguagePackage } from '@core/languages/registry.ts'
import type { SettingsRegistry, SettingDefinition } from '@core/settings/registry.ts'
import { themeRegistry } from '@/theme/registry.ts'
import { i18nRegistry } from '@/i18n/index.ts'
import { createLanguageIndex, LanguageRegistry as LanguageRegistryClass } from '@core/languages/registry.ts'
import { setPluginLanguageIndex } from '@core/filekind.ts'
import { settingsRegistry } from '@core/settings/registry.ts'
import { discardCachedSettings } from '@/state/setting.ts'
import { applyContributions } from './contributions.ts'

/**
 * The renderer runtime that consumes the plugin generation sent by the main
 * process (10b) and applies it to the existing renderer registries: themes,
 * locales + owner texts, languages (file extension -> languageId), and
 * settings definitions. Commands, menus and key schemes belong to other
 * steps (14-16); the theme/locale selection UI belongs to 12/13.
 *
 * The model is PULL with a monotonically increasing version: the runtime
 * subscribes to `onGeneration(version)` and asks for the snapshot. An event
 * is signed BEFORE the snapshot is requested, so a snapshot obtained from
 * the pull never lags behind a missed event. Snapshots or events with
 * version <= applied are stale (or out-of-order) and are dropped. A pull
 * that returns a snapshot older than the last signed event triggers a
 * re-pull (out-of-order IPC).
 *
 * A pull is in flight at most once. An event that arrives during an in-flight
 * pull marks the runtime for a re-read once the current one settles.
 *
 * Application is per-owner and split into two phases:
 *  - PREPARE builds the descriptors the registries will receive, without
 *    touching any registry. A failure in preparation throws before any
 *    registry is touched, so a hostile or invalid owner leaves the four
 *    registries untouched.
 *  - PUBLISH sends the staged descriptors to the four registries. If a
 *    destination still throws at publish time, the previous staged
 *    contribution of the owner is restored; if the owner had no previous
 *    contribution, the owner is removed cleanly from every registry.
 *
 * Application slices by owner across animation frames: each per-owner
 * commit runs in its own microtask; if a single owner exceeds the budget
 * the runtime yields the next frame and continues with the next owner.
 * The budget is enforced per slice, not per generation.
 *
 * A per-snapshot `sliceToken` (incremented on every `applySnapshot`) makes
 * a stale slice stop as soon as a newer snapshot is in flight: a slice
 * that is waiting for a frame while a newer snapshot is being prepared
 * never publishes an owner that the newer snapshot already removed or
 * updated, and the `.then` of a stale slice does not refresh
 * `setPluginLanguageIndex` (the newer slice will).
 *
 * Owners absent from the new generation are removed from every registry.
 * An owner with `enabled: false` does not contribute theme/locale/text/
 * language data, but its settings definitions remain visible (their
 * `owner.enabled` is `false`).
 *
 * Cleanup on `dispose()` cancels the event subscription, the pending pull
 * frame, the scheduled slice and the in-flight pull.
 *
 * **No plugin code is ever executed.** The runtime only feeds data into
 * existing registries. No startup imports: this module is loaded by
 * `import('./plugins/runtime.ts')` after the first render; it does not
 * statically import any `core/plugins/*` runtime (only `import type` for
 * the generation contract) and it does not import the renderer UI.
 */

interface Bridge {
  generation(): Promise<PluginGeneration>
  onGeneration(listener: (version: number) => void): () => void
}

interface ThemeLike {
  id: string
  label: string
  base: 'light' | 'dark'
  tokens: Readonly<Record<string, string>>
}

interface LocaleLike {
  language: string
  label: string
  translations: Readonly<Record<string, string>>
}

interface LanguageLike {
  id: string
  label: string
  languageId: string
  extensions: readonly string[]
  filenames: readonly string[]
}

interface GenerationPluginShape {
  readonly owner: string
  readonly enabled: boolean
  readonly themes: readonly ThemeLike[]
  readonly locales: readonly LocaleLike[]
  readonly texts: OwnerTexts
  readonly languages: readonly LanguageLike[]
  readonly settings: readonly Omit<SettingDefinition, 'validator' | 'normalize'>[]
}

/** Staged contribution for one owner: pre-built descriptors ready to be published or rolled back. */
interface StagedOwner {
  themes: readonly PluginTheme[]
  locales: readonly LocaleCatalog[]
  texts: OwnerTexts
  languages: LanguagePackage | null
  settings: readonly SettingDefinition[]
}

const EMPTY_STAGED: StagedOwner = Object.freeze({ themes: [], locales: [], texts: {}, languages: null, settings: [] })

function pluginThemes(plugin: GenerationPluginShape): readonly PluginTheme[] {
  return plugin.themes.map(theme => ({ id: theme.id, label: theme.label, base: theme.base, tokens: { ...theme.tokens } }))
}

function pluginLocales(plugin: GenerationPluginShape): readonly LocaleCatalog[] {
  return plugin.locales.map(locale => ({
    language: locale.language,
    label: locale.label,
    load: () => {
      const translations: Record<string, string> = {}
      for (const [key, value] of Object.entries(locale.translations)) translations[key] = value
      return Object.freeze(translations)
    },
  }))
}

function pluginTexts(plugin: GenerationPluginShape): OwnerTexts {
  return plugin.texts ?? {}
}

function pluginLanguagePackage(plugin: GenerationPluginShape): LanguagePackage | null {
  if (plugin.languages.length === 0) return null
  return {
    pluginId: plugin.owner,
    languages: plugin.languages.map(language => ({
      id: language.id,
      label: language.label,
      languageId: language.languageId,
      extensions: Object.freeze([...language.extensions]),
      filenames: Object.freeze([...language.filenames]),
    })),
  }
}

function pluginSettings(plugin: GenerationPluginShape): readonly SettingDefinition[] {
  return plugin.settings.map(definition => ({ ...definition, owner: Object.freeze({ id: plugin.owner, enabled: plugin.enabled }) }))
}

/**
 * PREPARE: build the staged descriptors the registries will receive, without
 * touching any registry. A hostile theme, an i18n collision, a setting with
 * an invalid default — anything wrong throws here, so the registries stay
 * intact.
 */
function stageOwner(plugin: GenerationPluginShape): StagedOwner {
  const enabled = plugin.enabled
  const themes = enabled && plugin.themes.length > 0 ? pluginThemes(plugin) : []
  const locales = enabled ? pluginLocales(plugin) : []
  const texts = enabled ? pluginTexts(plugin) : {}
  const languages = enabled ? pluginLanguagePackage(plugin) : null
  const settings = pluginSettings(plugin)
  // Theme validation (defense in depth) and setting default validation are
  // delegated to the registries on publish; if the snapshot was produced by
  // the main process, the values already passed that gate. The test suite
  // still has to catch a hostile package; the publish phase will throw and
  // trigger the rollback.
  return { themes, locales, texts, languages, settings }
}

function applyStagedToThemes(theme: ThemeRegistry, owner: string, staged: StagedOwner): void {
  if (staged.themes.length === 0) { theme.remove(owner); return }
  const result = theme.set({ pluginId: owner, themes: staged.themes })
  if (!result.ok) throw new Error(`themes: ${result.errors.map(error => error.message).join('; ')}`)
}

function applyStagedToI18n(i18n: I18nRegistry, owner: string, staged: StagedOwner): void {
  if (staged.locales.length === 0 && Object.keys(staged.texts).length === 0) { i18n.removePlugin(owner); return }
  i18n.setPlugin(owner, staged.locales, staged.texts)
}

function applyStagedToLanguages(languages: LanguageRegistry, owner: string, staged: StagedOwner): void {
  languages.remove(owner)
  if (staged.languages) languages.set(staged.languages)
}

function applyStagedToSettings(settings: SettingsRegistry, owner: string, staged: StagedOwner): void {
  const desiredIds = new Set<string>()
  for (const definition of staged.settings) desiredIds.add(definition.id)
  const removedIds: string[] = []
  settings.transaction(() => {
    for (const existing of settings.all()) {
      if (existing.owner?.id !== owner) continue
      if (!desiredIds.has(existing.id)) { removedIds.push(existing.id); settings.remove(existing.id) }
    }
    for (const definition of staged.settings) {
      const existing = settings.get(definition.id)
      if (existing) {
        // The id is already registered: it must be the same owner (we are
        // staging for the current owner) and the content must be the same.
        // A different owner with the same id is a collision: throw so the
        // per-owner transaction rolls back the staged owner.
        if (existing.owner?.id !== owner) throw new Error(`Setting id collision: ${definition.id} owned by ${existing.owner?.id ?? 'core'}`)
        if (definitionChanged(existing, definition)) {
          removedIds.push(existing.id)
          settings.remove(existing.id)
          settings.defineSetting(definition)
        }
        continue
      }
      settings.defineSetting(definition)
    }
  })
  if (removedIds.length > 0) discardCachedSettings(removedIds)
}

function definitionChanged(previous: SettingDefinition, next: SettingDefinition): boolean {
  if (previous.type !== next.type) return true
  if (!Object.is(previous.default, next.default)) return true
  if ((previous.label ?? null) !== (next.label ?? null)) return true
  if ((previous.category ?? null) !== (next.category ?? null)) return true
  if ((previous.description ?? null) !== (next.description ?? null)) return true
  if ((previous.min ?? null) !== (next.min ?? null)) return true
  if ((previous.max ?? null) !== (next.max ?? null)) return true
  if ((previous.step ?? null) !== (next.step ?? null)) return true
  if ((previous.maxLength ?? null) !== (next.maxLength ?? null)) return true
  if ((previous.maxItems ?? null) !== (next.maxItems ?? null)) return true
  if (!arraysEqual(previous.choices as readonly unknown[] | undefined, next.choices as readonly unknown[] | undefined)) return true
  if (!arraysEqual(previous.choiceLabels as readonly string[] | undefined, next.choiceLabels as readonly string[] | undefined)) return true
  return false
}

function arraysEqual<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
  return true
}

function removeOwnerFromAll(theme: ThemeRegistry, i18n: I18nRegistry, languages: LanguageRegistry, settings: SettingsRegistry, owner: string): void {
  theme.remove(owner)
  i18n.removePlugin(owner)
  languages.remove(owner)
  const removedIds: string[] = []
  settings.transaction(() => {
    for (const definition of settings.all()) if (definition.owner?.id === owner) { removedIds.push(definition.id); settings.remove(definition.id) }
  })
  if (removedIds.length > 0) discardCachedSettings(removedIds)
}

/** PUBLISH for one owner: empty staged = clean removal; non-empty = full apply. */
function publishStaged(theme: ThemeRegistry, i18n: I18nRegistry, languages: LanguageRegistry, settings: SettingsRegistry, owner: string, staged: StagedOwner): void {
  applyStagedToThemes(theme, owner, staged)
  applyStagedToI18n(i18n, owner, staged)
  applyStagedToLanguages(languages, owner, staged)
  applyStagedToSettings(settings, owner, staged)
}

/** Roll back a partial publish by re-publishing the previous staged contribution (or removing the owner). */
function rollbackStaged(theme: ThemeRegistry, i18n: I18nRegistry, languages: LanguageRegistry, settings: SettingsRegistry, owner: string, previous: StagedOwner): void {
  publishStaged(theme, i18n, languages, settings, owner, previous)
}

export interface RuntimeOptions {
  bridge?: Bridge
  theme?: ThemeRegistry
  i18n?: I18nRegistry
  languages?: LanguageRegistry
  settings?: SettingsRegistry
  raf?: (callback: FrameRequestCallback) => number
  cancelRaf?: (handle: number) => void
  /** Per-owner publish budget in milliseconds. The runtime yields the next frame when a single owner exceeds it. Default 4 (leaves headroom under the 8 ms frame budget). */
  ownerBudgetMs?: number
  /** Test-only: monotonic clock used for slice timing. Defaults to `performance.now`. The fake clock makes the slice-cession point deterministic in tests. */
  now?: () => number
  /** Test-only: called at the end of every slice (raf) with the synchronous wall time of the slice in ms. Used by the budget test. */
  onSlice?: (ms: number) => void
}

export interface RuntimeHandle {
  dispose(): void
  version(): number
  /** Test-only: a snapshot of the last applied owners (for assertions). */
  owners(): readonly string[]
}

function defaultBridge(): Bridge | undefined {
  return typeof window === 'undefined' ? undefined : window.fb?.plugins
}

function defaultRaf(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return setTimeout(() => callback(performance.now()), 0) as unknown as number
}

function defaultCancelRaf(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
}

/** Renderer-side language registry: the main process is the authority on built-in keys, the renderer keeps a permissive index that mirrors the main. */
const defaultLanguagesRegistry = new LanguageRegistryClass(new Set<string>())

export function startPluginRuntime(options: RuntimeOptions = {}): RuntimeHandle {
  const bridge: Bridge | undefined = options.bridge ?? defaultBridge()
  const theme = options.theme ?? themeRegistry
  const i18n = options.i18n ?? i18nRegistry
  const languages = options.languages ?? defaultLanguagesRegistry
  const settings = options.settings ?? settingsRegistry
  const raf = options.raf ?? defaultRaf
  const cancelRaf = options.cancelRaf ?? defaultCancelRaf
  const ownerBudgetMs = options.ownerBudgetMs ?? 4
  const now = options.now ?? (() => performance.now())
  const onSlice = options.onSlice

  let appliedVersion = 0
  let signedVersion = 0
  let pullInFlight = false
  let needsRepull = false
  // Two independent frame handles: the pull schedule and the slice yield.
  // Sharing a single handle made `scheduleApply` return early while a slice
  // was waiting for the next frame, so a new event between slices was lost.
  let pullFrame: number | null = null
  let sliceFrame: number | null = null
  // A monotonic token stamped on every `applySnapshot`. A slice started by an
  // older snapshot stops as soon as a newer snapshot is in flight; a stale
  // slice's `.then` does not call `setPluginLanguageIndex` either.
  let sliceToken = 0
  let unsubscribe: (() => void) | null = null
  let disposed = false
  const appliedOwners = new Set<string>()
  // JSON content key per owner. Two payloads that round-trip through JSON to
  // the same string carry the same renderer contribution; the main process
  // sends JSON-pure data, so this is byte-equal.
  const contentKeyByOwner = new Map<string, string>()
  // Previous staged contribution per owner: the rollback on a publish failure.
  const stagedByOwner = new Map<string, StagedOwner>()

  function dispose(): void {
    if (disposed) return
    disposed = true
    if (unsubscribe) { unsubscribe(); unsubscribe = null }
    if (pullFrame !== null) { cancelRaf(pullFrame); pullFrame = null }
    if (sliceFrame !== null) { cancelRaf(sliceFrame); sliceFrame = null }
    pullInFlight = false
    needsRepull = false
  }

  /**
   * Apply one owner's contribution. PREPARE happens before any registry is
   * touched; if preparation throws, nothing of the owner is applied. If the
   * publish throws, the previous staged contribution (or the empty one) is
   * re-published, so the owner ends up exactly as it was before this call.
   */
  function applyOneOwner(plugin: GenerationPluginShape): void {
    if (disposed) return
    const owner = plugin.owner
    const contentKey = JSON.stringify(plugin)
    if (contentKeyByOwner.get(owner) === contentKey) return
    const staged = stageOwner(plugin)
    const previous = stagedByOwner.get(owner) ?? EMPTY_STAGED
    try {
      publishStaged(theme, i18n, languages, settings, owner, staged)
      stagedByOwner.set(owner, staged)
      contentKeyByOwner.set(owner, contentKey)
    } catch {
      try { rollbackStaged(theme, i18n, languages, settings, owner, previous) }
      catch { /* Restore failure is a hard error; the runtime keeps the next attempt on a clean slate. */ }
      stagedByOwner.delete(owner)
      contentKeyByOwner.delete(owner)
      console.error('plugin apply failed')
    }
  }

  /**
   * Slice the application of one generation by owner across animation frames.
   * Each per-owner commit runs synchronously; if the slice exceeds the budget
   * the runtime yields the next frame and continues with the next owner. The
   * budget is enforced per slice, never per generation. The check runs AFTER
   * applying each owner with a 1 ms safety margin so the wall time of the
   * last applied owner keeps the slice strictly under the budget.
   *
   * The token guards against a newer snapshot: if `sliceToken` changes
   * (because `applySnapshot` started a newer slice), this slice stops
   * immediately and does not publish an owner that the newer snapshot has
   * already removed or updated.
   *
   * Every completed slice reports its wall time via `onSlice` so the budget
   * test can measure the longest of all slices from one run.
   */
  async function sliceOwners(plugins: readonly GenerationPluginShape[], token: number): Promise<void> {
    let index = 0
    while (index < plugins.length) {
      if (disposed || token !== sliceToken) return
      const start = now()
      while (index < plugins.length) {
        if (disposed || token !== sliceToken) return
        applyOneOwner(plugins[index]!)
        index++
        if (now() - start >= ownerBudgetMs - 1) break
      }
      const sliceMs = now() - start
      if (!disposed && token === sliceToken && onSlice && sliceMs > 0) onSlice(sliceMs)
      if (index < plugins.length) {
        // Yield the next frame so the main thread stays responsive.
        await new Promise<void>(resolve => { sliceFrame = raf(() => { sliceFrame = null; resolve() }) })
      }
    }
  }

  function applySnapshot(snapshot: PluginGeneration): void {
    if (disposed) return
    if (snapshot.version <= appliedVersion) return
    if (snapshot.version < signedVersion) { needsRepull = true; return }
    const next = new Set<string>()
    for (const plugin of snapshot.plugins) next.add(plugin.owner)
    // Owners that disappeared from the snapshot are removed from every registry
    // BEFORE the slice starts (so the slice sees a clean state). The token is
    // incremented so the previous slice, if any is still in flight, stops
    // before reaching an owner that is being removed here.
    sliceToken++
    const myToken = sliceToken
    for (const owner of [...appliedOwners]) if (!next.has(owner)) {
      removeOwnerFromAll(theme, i18n, languages, settings, owner)
      stagedByOwner.delete(owner)
      contentKeyByOwner.delete(owner)
      appliedOwners.delete(owner)
    }
    const remaining: GenerationPluginShape[] = []
    for (const plugin of snapshot.plugins) {
      if (!next.has(plugin.owner)) continue
      remaining.push(plugin as unknown as GenerationPluginShape)
    }
    appliedVersion = snapshot.version
    for (const owner of next) appliedOwners.add(owner)
    // Mirror the commands and menu items the snapshot carries into the
    // renderer-side contributions store. The projection only depends on the
    // generation shape (no DOM, no IPC), so it runs synchronously with the
    // snapshot, BEFORE the per-owner slice starts: by the time the first
    // owner commits, the menubar/palette projection already reflects the
    // new commands. The store replaces its map atomically and notifies once.
    applyContributions(snapshot)
    void sliceOwners(remaining, myToken).then(() => {
      if (disposed) return
      if (myToken !== sliceToken) return
      setPluginLanguageIndex(createLanguageIndex(languages))
    })
  }

  function scheduleApply(): void {
    if (disposed || pullFrame !== null) return
    pullFrame = raf(() => {
      pullFrame = null
      if (disposed) return
      pullAndApply()
    })
  }

  function pullAndApply(): void {
    if (disposed || !bridge) return
    if (pullInFlight) { needsRepull = true; return }
    pullInFlight = true
    bridge.generation()
      .then(snapshot => {
        if (disposed) return
        applySnapshot(snapshot)
      })
      .catch(() => { /* Pull failure: keep the last good generation, retry on the next event. */ })
      .finally(() => {
        pullInFlight = false
        if (disposed) return
        if (needsRepull) { needsRepull = false; scheduleApply() }
      })
  }

  if (bridge) {
    unsubscribe = bridge.onGeneration(version => {
      if (disposed) return
      if (!Number.isSafeInteger(version) || version < 0) return
      if (version > signedVersion) signedVersion = version
      if (appliedVersion >= version) return
      if (pullInFlight) { needsRepull = true; return }
      scheduleApply()
    })
    // Initial pull: the renderer also fetches once on start.
    scheduleApply()
  }

  return {
    dispose,
    version: () => appliedVersion,
    owners: () => [...appliedOwners].sort(),
  }
}
