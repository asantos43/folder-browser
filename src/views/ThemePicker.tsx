import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { themeRegistry, type PluginTheme } from '@/theme/registry.ts'

type Selection = { pluginId: string; themeId: string }

interface Choice {
  key: string
  pluginId: '' | string
  themeId: '' | string
  label: string
  ownerLabel: string
  base: 'light' | 'dark' | null
  available: boolean
  selected: boolean
}

const NONE_KEY = '__none__'
const RADIO_NAME = 'themePicker'
const control = 'h-[26px] rounded-sm border border-group-border bg-editor px-2 text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus'

/**
 * Settings panel control for the saved plugin theme. Lists every theme the
 * host fed into `themeRegistry` ("Default (theme only)" first, then plugin
 * themes grouped by their owner). A click or arrow key previews the choice
 * live; **Confirm** persists the choice (and calls `themeRegistry.apply`),
 * **Cancel** keeps the saved choice (and clears the preview), **Restore**
 * reverts to no plugin override.
 *
 * The saved value is just the id (`<plugin>:<theme>` or `''`) — when the
 * previously saved theme is no longer registered, it is shown once at the
 * top as an unavailable choice with an explicit warning; the saved value
 * stays put (reset only on user action), and the renderer falls back to the
 * built-in look until the user picks another theme or restores. Theme updates
 * during preview never leave a `<style>` referencing a theme that is gone:
 * the registry re-renders or clears its element on `set/remove` automatically.
 *
 * Zero IO per choice. Opening the panel walks the registry once and builds
 * the choice list; switching selection runs `themeRegistry.preview` on the
 * renderer only (one DOM write per switch).
 */
export function ThemePicker({ value, set }: { value: unknown; set: (value: string) => void }) {
  const { t } = useI18n()
  const saved = readSelection(value)
  const [preview, setPreview] = useState<Selection | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Closing the panel (unmount) cancels any active preview; the saved choice
  // is left intact so the next open starts from the same place. The registry
  // already cleared the preview when the saved plugin disappeared, so this is
  // a safe no-op in that case.
  useEffect(() => () => { themeRegistry.cancel() }, [])

  const choices = useMemo(() => buildChoices(t, saved), [t, saved])
  const hasPreview = preview !== null
  // A change worth keeping: a preview exists and it differs from the saved one
  // (or there was no saved value at all).
  const changed = hasPreview && !sameSelection(saved, preview)
  const canRestore = saved !== null && (saved.pluginId !== '' || saved.themeId !== '')
  const listboxId = 'theme-picker-listbox'

  const select = (choice: Choice): void => {
    if (!choice.available) return
    const next: Selection = { pluginId: choice.pluginId, themeId: choice.themeId }
    // "Default (theme only)" — preview by clearing any plugin overlay so the
    // user sees the base without confirming.
    if (next.pluginId === '' && next.themeId === '') {
      themeRegistry.reset()
    } else {
      themeRegistry.preview(next.pluginId, next.themeId)
    }
    setPreview(next)
  }

  const confirm = (): void => {
    if (!hasPreview) return
    const sel = preview!
    if (sel.pluginId === '' && sel.themeId === '') {
      themeRegistry.reset()
      set('')
      setPreview(null)
      return
    }
    const result = themeRegistry.apply(sel.pluginId, sel.themeId)
    if (!result.ok) return
    set(`${sel.pluginId}:${sel.themeId}`)
    setPreview(null)
  }

  const cancel = (): void => {
    themeRegistry.cancel()
    setPreview(null)
  }

  const restore = (): void => {
    themeRegistry.reset()
    set('')
    setPreview(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End' && event.key !== 'Enter' && event.key !== ' ') return
    const container = listRef.current
    if (!container) return
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    const index = inputs.findIndex(input => input === document.activeElement)
    let next = index
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % inputs.length
    else if (event.key === 'ArrowUp') next = index < 0 ? inputs.length - 1 : (index - 1 + inputs.length) % inputs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = inputs.length - 1
    if (next < 0 || next >= inputs.length) return
    event.preventDefault()
    const target = inputs[next]
    target?.focus()
    // Move focus AND preview. Calling `.click()` would skip when the target is already
    // checked (the native radio click is a no-op), so go straight through `select`.
    if (target) {
      const choice = choices.find(c => c.key === target.value)
      if (choice) select(choice)
    }
  }

  return <fieldset className="m-0 border-0 p-0">
    <legend className="m-0 text-[12px] text-fg-muted">{t('settings.themePluginHint')}</legend>
    <div ref={listRef} role="radiogroup" id={listboxId} onKeyDown={onKeyDown} className="mt-2 flex max-h-[280px] flex-col gap-1 overflow-auto rounded-sm border border-group-border bg-editor p-2">
      {choices.length === 0 ? <p className="m-0 text-[12px] text-fg-muted">{t('settings.themePluginNone')}</p> : null}
      {choices.map((choice) => {
        const id = `${listboxId}-${choice.key}`
        return <label key={choice.key} htmlFor={id} className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-[13px] outline-none focus-within:bg-selection ${choice.selected ? 'bg-selection font-bold' : 'hover:bg-selection'}`}>
          <input id={id} type="radio" name={RADIO_NAME} checked={choice.selected} aria-checked={choice.selected} disabled={!choice.available} value={choice.key} onChange={() => select(choice)} className="h-[14px] w-[14px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40" />
          <span className="flex flex-col">
            <span>{choice.label}</span>
            <span className="text-[11px] text-fg-muted">{choice.ownerLabel}</span>
            {!choice.available ? <span role="note" className="text-[11px] text-warn">{t('settings.themePluginUnavailable')}</span> : null}
          </span>
        </label>
      })}
    </div>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className={control} onClick={confirm} disabled={!changed}>{t('settings.themePluginConfirm')}</button>
      <button type="button" className={control} onClick={cancel} disabled={!hasPreview}>{t('settings.themePluginCancel')}</button>
      <button type="button" className={control} onClick={restore} disabled={!canRestore}>{t('settings.themePluginRestore')}</button>
    </div>
  </fieldset>
}

/** Render the list once per saved id change (and once per language). */
function buildChoices(t: (key: string, params?: Record<string, string | number>) => string, saved: Selection | null): readonly Choice[] {
  const list: Choice[] = []
  // 1) No plugin override (the "default" choice).
  list.push({
    key: NONE_KEY,
    pluginId: '',
    themeId: '',
    label: t('settings.themePluginBuiltin'),
    ownerLabel: t('settings.themePluginBuiltinHint'),
    base: null,
    available: true,
    selected: saved !== null && saved.pluginId === '' && saved.themeId === '',
  })
  const seen = new Set<string>()
  // 2) Plugin themes, grouped by owner.
  for (const pluginId of themeRegistry.owners()) {
    const themes = themeRegistry.themesOf(pluginId)
    if (themes.length === 0) continue
    for (const theme of themes) {
      const choice = themeToChoice(t, pluginId, theme, saved)
      list.push(choice)
      seen.add(themeKey(pluginId, theme.id))
    }
  }
  // 3) Saved selection whose theme is no longer registered: rendered once,
  //    flagged unavailable, and never auto-removed (reset is by user action).
  if (saved !== null && saved.pluginId !== '' && saved.themeId !== '' && !seen.has(themeKey(saved.pluginId, saved.themeId))) {
    list.push({
      key: `__unavailable__:${saved.pluginId}:${saved.themeId}`,
      pluginId: saved.pluginId,
      themeId: saved.themeId,
      label: saved.themeId,
      ownerLabel: t('settings.themePluginOwner', { owner: saved.pluginId }),
      base: null,
      available: false,
      selected: true,
    })
  }
  return list
}

function themeToChoice(t: (key: string, params?: Record<string, string | number>) => string, pluginId: string, theme: PluginTheme, saved: Selection | null): Choice {
  return {
    key: themeKey(pluginId, theme.id),
    pluginId,
    themeId: theme.id,
    label: theme.label,
    ownerLabel: t('settings.themePluginOwner', { owner: pluginId }),
    base: theme.base,
    available: true,
    selected: saved !== null && saved.pluginId === pluginId && saved.themeId === theme.id,
  }
}

function themeKey(pluginId: string, themeId: string): string { return `${pluginId}:${themeId}` }

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return a.pluginId === b.pluginId && a.themeId === b.themeId
}

function readSelection(value: unknown): Selection | null {
  if (typeof value !== 'string') return null
  if (value === '') return { pluginId: '', themeId: '' }
  const index = value.indexOf(':')
  if (index < 0) return null
  const pluginId = value.slice(0, index)
  const themeId = value.slice(index + 1)
  if (pluginId === '' || themeId === '') return null
  return { pluginId, themeId }
}
