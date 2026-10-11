/**
 * CSS serializers for plugin themes: a compiled theme becomes a CSS rule that
 * targets `html[data-theme-plugin="..."][data-theme-base="..."]`, and the preview
 * uses a separate selector so the UI can remove it without touching the saved
 * choice. The id is escaped for an attribute selector (every byte with any
 * meaning becomes `\HEX `), and the values are inserted between the braces
 * exactly as `compile.ts` validated them.
 *
 * **Pure functions, no state, no plugin imports.** The module lives at the root
 * of `core/` (not under `core/plugins/`) because the renderer imports it; the
 * startup guard treats every `plugins/...` import as the plugin host, which the
 * registry is not. The module is shared by the install-time compiler and by the
 * renderer's registry; it only knows the structural shape of a theme
 * (`id`, `base`, `tokens`).
 */

export interface PluginThemeForCss {
  readonly id: string
  readonly base: 'light' | 'dark'
  readonly tokens: Readonly<Record<string, string>>
}

/** Escape a value used inside a CSS attribute selector: every byte that has any meaning becomes `\HEX `. */
// eslint-disable-next-line no-control-regex
export function escapeAttr(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f-\x9f"\\]/g, char => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')} `)
}

/** A theme's tokens become CSS variables inside a `[data-theme-plugin="<id>"]` rule. */
export function themeToCss(theme: PluginThemeForCss): string {
  const id = escapeAttr(theme.id)
  const properties = Object.entries(theme.tokens).map(([token, colour]) => `  --${token}: ${colour};`).join('\n')
  return `html[data-theme-plugin="${id}"][data-theme-base="${theme.base}"] {\n${properties}\n}`
}

/** A preview marks the rule with `data-theme-plugin-preview` so the UI can remove it without losing the user's choice. */
export function themePreview(theme: PluginThemeForCss): string {
  const id = escapeAttr(theme.id)
  const properties = Object.entries(theme.tokens).map(([token, colour]) => `  --${token}: ${colour};`).join('\n')
  return `html[data-theme-plugin-preview="${id}"][data-theme-base="${theme.base}"] {\n${properties}\n}`
}