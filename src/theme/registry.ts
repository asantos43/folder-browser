import { themePreview, themeToCss } from '@core/themeCss.ts'

/**
 * Structural subset of `PluginTheme` — no install-time module is imported here.
 * The compile test walks every production module to keep `core/plugins/compile.ts`
 * out of the start-up path; the registry consumes the values through this shape
 * and the renderer never imports the compiler.
 */
export interface PluginTheme {
  readonly id: string
  readonly label: string
  readonly base: 'light' | 'dark'
  readonly tokens: Readonly<Record<string, string>>
}

/**
 * Plugin themes are stored by owner and inserted on the renderer side as CSS
 * rules that override tokens of `src/theme/tokens.css`. The host feeds the
 * compiled themes (already validated by `compile.ts`); the registry keeps a
 * second barrier (re-validating values at apply time) and exposes the verbs
 * the UI needs: `apply`, `preview`, `cancel`, `reset`, `remove`, `set`.
 *
 * **What lives where.** `tokens.css` stays the only place where colours are
 * declared; a plugin only sets some of those tokens and only when one of its
 * themes is active. The active theme adds `data-theme-plugin="<id>"` and
 * `data-theme-base="<light|dark>"` on `<html>`; the preview adds
 * `data-theme-plugin-preview="<id>"` and the same `data-theme-base`. Both
 * selectors reference the plugin theme id (escaped in `@core/themeCss.ts`), so a
 * hostile id with a `"`, a `\\`, LF, CR, FF, DEL or a C1 control cannot leak
 * into a new selector.
 *
 * **The base is independent.** `data-theme=light|dark` is the user's choice
 * (`applyTheme` in `theme.ts`) and stays; titlebar and CodeMirror read tokens
 * from the base, so the registry keeps the titlebar at the base colours
 * (snapshot before any plugin attribute is set) and never alters the values of
 * `--vscode-titleBar-*`. Inactive themes inject no `<style>` element; with one
 * active and one preview there are exactly two.
 */

// Defense-in-depth mirrors the regexes in `compile.ts:colourValue`: the
// compiler already refuses hostile values, the registry adds a second barrier
// so a future change to the compile rules cannot turn the renderer into an
// attacker.
const FORBIDDEN_VALUE = /(?:\burl\s*\(|[{};\\/*]|\bvar\s*\(|\bexpression\b|@import\b|<|\bstyle\s*=)/i
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u2028\u2029]/u

/** The DOM hooks the registry needs. Injected so tests run without Electron. */
export interface ThemeDOM {
  readonly document: Document
  readonly createElement: (tag: string) => HTMLElement
  getComputedStyle(el: Element): { getPropertyValue(prop: string): string }
  setTitleBar?: (colors: { color: string; symbolColor: string }) => void
}

const hasDOM = typeof document !== 'undefined' && typeof getComputedStyle === 'function'
const defaultDOM: ThemeDOM | undefined = hasDOM
  ? {
      document,
      createElement: tag => document.createElement(tag),
      getComputedStyle: el => getComputedStyle(el),
      setTitleBar: window.fb?.setTitleBar?.bind(window.fb),
    }
  : undefined

export interface ThemeError { pluginId: string; themeId: string; message: string }

/** A structural subset of `CompiledPlugin.themes[]` that the host feeds in. */
export interface PluginThemePackage {
  pluginId: string
  themes: readonly PluginTheme[]
}

/** The current selection the UI shows. */
export interface ActiveSelection {
  readonly pluginId: string
  readonly themeId: string
}

function validateTokens(theme: PluginTheme): string | null {
  for (const [name, value] of Object.entries(theme.tokens)) {
    if (typeof value !== 'string') return `token "${name}" is not a string`
    // eslint-disable-next-line no-control-regex
    if (CONTROL_CHARS.test(value)) return `token "${name}" contains a control or line separator`
    if (value === 'transparent') continue
    if (FORBIDDEN_VALUE.test(value)) return `token "${name}" is not a plain colour`
  }
  return null
}

/** Detect-and-validate the theme id even though `escapeAttr` already keeps it safe: the registry refuses ids with controls so a debug tool can rely on the DOM attribute. */
function validateThemeId(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0) return 'theme id is empty'
  if (id.length > 200) return 'theme id is too long'
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f-\x9f"\\]/.test(id)) return 'theme id contains a forbidden byte'
  return null
}

/**
 * Owned registry of plugin themes. The renderer keeps one instance; the host
 * calls `set` with each plugin's compiled themes (one per package), `remove`
 * to drop a package, and `apply` / `preview` / `cancel` / `reset` to drive
 * the user's choice.
 */
export class ThemeRegistry {
  private readonly packages = new Map<string, PluginTheme[]>()
  private readonly themeIndex = new Map<string, Map<string, PluginTheme>>()
  private readonly listeners = new Set<() => void>()
  private active: ActiveSelection | null = null
  // Note: the field name has to differ from `preview()` (the method); assigning
  // to `this.previewState` would shadow the prototype method on the instance and
  // break subsequent calls.
  private previewState: ActiveSelection | null = null
  private activeStyleEl: HTMLStyleElement | null = null
  private previewStyleEl: HTMLStyleElement | null = null
  /** Base titlebar colours, captured before the first plugin attribute is set so cancel/reset restore them. */
  private titleBarSnapshot: { color: string; symbolColor: string } | null = null

  private readonly dom: ThemeDOM | undefined

  constructor(dom: ThemeDOM | undefined = defaultDOM) {
    this.dom = dom
  }

  /**
   * Install or replace one package's themes. The compile step already
   * validated the values; this re-validates them as a second barrier and
   * returns any error. If the active or preview selection belongs to this
   * owner, the DOM is re-rendered (a token changed) or cleared (the theme
   * went away) so no `<style>` element is left referencing a theme that no
   * longer exists.
   */
  set(value: PluginThemePackage): { ok: boolean; errors: ThemeError[] } {
    const errors: ThemeError[] = []
    const accepted: PluginTheme[] = []
    for (const theme of value.themes) {
      const idError = validateThemeId(theme.id)
      if (idError !== null) {
        errors.push({ pluginId: value.pluginId, themeId: String(theme.id), message: idError })
        continue
      }
      const tokenError = validateTokens(theme)
      if (tokenError !== null) {
        errors.push({ pluginId: value.pluginId, themeId: theme.id, message: tokenError })
        continue
      }
      accepted.push(theme)
    }
    if (errors.length) return { ok: false, errors }
    this.packages.set(value.pluginId, accepted)
    const index = new Map<string, PluginTheme>()
    for (const theme of accepted) if (!index.has(theme.id)) index.set(theme.id, theme)
    this.themeIndex.set(value.pluginId, index)
    if (this.active?.pluginId === value.pluginId) {
      const stillThere = accepted.find(t => t.id === this.active!.themeId)
      if (stillThere) this.renderActive()
      else this.clearActive()
    }
    if (this.previewState?.pluginId === value.pluginId) {
      const stillThere = accepted.find(t => t.id === this.previewState!.themeId)
      if (stillThere) this.renderPreview()
      else this.clearPreview()
    }
    for (const listener of this.listeners) listener()
    return { ok: true, errors: [] }
  }

  /** Drop one owner. If the active or preview selection belonged to it, the base is restored. */
  remove(pluginId: string): void {
    if (!this.packages.has(pluginId)) return
    this.packages.delete(pluginId)
    this.themeIndex.delete(pluginId)
    if (this.active?.pluginId === pluginId) this.clearActive()
    if (this.previewState?.pluginId === pluginId) this.clearPreview()
    for (const listener of this.listeners) listener()
  }

  /** Observe successful package changes, including an owner returning after disable. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Constant-time lookup without enumerating a package's themes. */
  hasTheme(pluginId: string, themeId: string): boolean {
    return this.themeIndex.get(pluginId)?.has(themeId) ?? false
  }

  /** Apply a plugin theme. Replaces any preview. The base data-theme is left as it is. */
  apply(pluginId: string, themeId: string): { ok: boolean; error?: string } {
    const theme = this.findTheme(pluginId, themeId)
    if (!theme) return { ok: false, error: `theme "${themeId}" not found in package "${pluginId}"` }
    if (this.previewState) this.clearPreview()
    this.active = { pluginId, themeId }
    this.renderActive()
    return { ok: true }
  }

  /** Show a preview; the saved choice is untouched. Adding a preview clears an earlier one. */
  preview(pluginId: string, themeId: string): { ok: boolean; error?: string } {
    const theme = this.findTheme(pluginId, themeId)
    if (!theme) return { ok: false, error: `theme "${themeId}" not found in package "${pluginId}"` }
    this.previewState = { pluginId, themeId }
    this.renderPreview()
    return { ok: true }
  }

  /** Cancel a preview. The active theme (if any) stays. */
  cancel(): void {
    if (this.previewState) this.clearPreview()
  }

  /** Forget both the active theme and any preview; the base alone remains. */
  reset(): void {
    if (this.previewState) this.clearPreview()
    if (this.active) this.clearActive()
  }

  /** The current saved choice, if any. */
  activeSelection(): ActiveSelection | null {
    return this.active ? { pluginId: this.active.pluginId, themeId: this.active.themeId } : null
  }

  /** The current preview, if any. */
  previewSelection(): ActiveSelection | null {
    return this.previewState ? { pluginId: this.previewState.pluginId, themeId: this.previewState.themeId } : null
  }

  /** Themes registered by one owner, in the order the host set them. */
  themesOf(pluginId: string): readonly PluginTheme[] {
    return this.packages.get(pluginId) ?? []
  }

  /** Owners in the order they were registered. */
  owners(): readonly string[] {
    return [...this.packages.keys()]
  }

  /** Total number of themes across all owners. */
  totalThemes(): number {
    let total = 0
    for (const themes of this.packages.values()) total += themes.length
    return total
  }

  private findTheme(pluginId: string, themeId: string): PluginTheme | undefined {
    return this.themeIndex.get(pluginId)?.get(themeId)
  }

  private renderActive(): void {
    if (!this.active || !this.dom) return
    const theme = this.findTheme(this.active.pluginId, this.active.themeId)
    if (!theme) return
    const html = this.dom.document.documentElement

    // First time a plugin theme is applied in this session: capture the base
    // titlebar colours and the current data-theme so cancel/reset can put them
    // back. The snapshot is the values before any plugin attribute is set.
    if (this.titleBarSnapshot === null) {
      const style = this.dom.getComputedStyle(html)
      this.titleBarSnapshot = {
        color: style.getPropertyValue('--vscode-titleBar-activeBackground').trim(),
        symbolColor: style.getPropertyValue('--vscode-titleBar-activeForeground').trim(),
      }
    }

    html.setAttribute('data-theme-plugin', theme.id)
    html.setAttribute('data-theme-base', theme.base)

    if (!this.activeStyleEl) {
      const el = this.dom.createElement('style')
      el.setAttribute('data-theme-plugin-source', theme.id)
      this.dom.document.head.appendChild(el)
      this.activeStyleEl = el as HTMLStyleElement
    }
    this.activeStyleEl.textContent = themeToCss(theme)

    // The plugin rule may have overridden --vscode-titleBar-*: restore the
    // base colours so the titlebar matches the user's choice, not the plugin.
    if (this.titleBarSnapshot.color && this.titleBarSnapshot.symbolColor) {
      this.dom.setTitleBar?.({ color: this.titleBarSnapshot.color, symbolColor: this.titleBarSnapshot.symbolColor })
    }
  }

  private clearActive(): void {
    if (!this.dom) {
      this.active = null
      this.titleBarSnapshot = null
      return
    }
    const html = this.dom.document.documentElement
    html.removeAttribute('data-theme-plugin')
    html.removeAttribute('data-theme-base')
    if (this.activeStyleEl?.parentNode) this.activeStyleEl.parentNode.removeChild(this.activeStyleEl)
    this.activeStyleEl = null
    // Recompute the titlebar from the base now that the plugin rule is gone.
    if (this.titleBarSnapshot) {
      const style = this.dom.getComputedStyle(html)
      const color = style.getPropertyValue('--vscode-titleBar-activeBackground').trim()
      const symbolColor = style.getPropertyValue('--vscode-titleBar-activeForeground').trim()
      if (color && symbolColor) this.dom.setTitleBar?.({ color, symbolColor })
    }
    this.titleBarSnapshot = null
    this.active = null
  }

  private renderPreview(): void {
    if (!this.previewState || !this.dom) return
    const theme = this.findTheme(this.previewState.pluginId, this.previewState.themeId)
    if (!theme) return
    const html = this.dom.document.documentElement
    html.setAttribute('data-theme-plugin-preview', theme.id)
    html.setAttribute('data-theme-base', theme.base)
    if (!this.previewStyleEl) {
      const el = this.dom.createElement('style')
      el.setAttribute('data-theme-plugin-preview-source', theme.id)
      this.dom.document.head.appendChild(el)
      this.previewStyleEl = el as HTMLStyleElement
    }
    this.previewStyleEl.textContent = themePreview(theme)
  }

  private clearPreview(): void {
    if (!this.dom) {
      this.previewState = null
      return
    }
    const html = this.dom.document.documentElement
    html.removeAttribute('data-theme-plugin-preview')
    // data-theme-base is shared with the active theme; only remove it when there is no active.
    if (!this.active) html.removeAttribute('data-theme-base')
    if (this.previewStyleEl?.parentNode) this.previewStyleEl.parentNode.removeChild(this.previewStyleEl)
    this.previewStyleEl = null
    this.previewState = null
  }
}

/** The single theme registry the renderer reads through. Tests inject their own. */
export const themeRegistry = new ThemeRegistry(defaultDOM)
