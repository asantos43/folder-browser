// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { themeRegistry, type PluginTheme } from '@/theme/registry.ts'
import { ThemePicker } from './ThemePicker.tsx'

const ROUNDS = 5

function theme(overrides: Partial<PluginTheme> & { tokens?: Record<string, string> } = {}): PluginTheme {
  return {
    id: overrides.id ?? 'midnight',
    label: overrides.label ?? 'Midnight',
    base: overrides.base ?? 'dark',
    tokens: overrides.tokens ?? { 'vscode-editor-background': '#1c1c1c' },
  }
}

function pack(pluginId: string, themes: readonly PluginTheme[]): { pluginId: string; themes: readonly PluginTheme[] } {
  return { pluginId, themes }
}

/** Radios returned by `getByRole('radio', ...)` are typed `HTMLElement`; `.value` / `.checked` need a cast. */
function radios(container: HTMLElement): HTMLInputElement[] {
  return within(container).getAllByRole('radio') as HTMLInputElement[]
}

/** A picker as a controlled component: tests can rerender it with a new `value` to simulate the saved setting changing. */
function picker(value: string, onSet = vi.fn()): { set: ReturnType<typeof vi.fn>; rerender: (next: string) => void; unmount: () => void } {
  const result = render(<I18nProvider language="en"><ThemePicker value={value} set={onSet} /></I18nProvider>)
  return {
    set: onSet,
    rerender: (next: string) => result.rerender(<I18nProvider language="en"><ThemePicker value={next} set={onSet} /></I18nProvider>),
    unmount: () => result.unmount(),
  }
}

function registryCleanup(): void {
  for (const owner of [...themeRegistry.owners()]) themeRegistry.remove(owner)
  themeRegistry.reset()
  const html = document.documentElement
  html.removeAttribute('data-theme-base')
  html.removeAttribute('data-theme-plugin')
  html.removeAttribute('data-theme-plugin-preview')
  for (const style of [...document.head.querySelectorAll('style[data-theme-plugin-source], style[data-theme-plugin-preview-source]')]) style.remove()
}

beforeEach(registryCleanup)
afterEach(() => { cleanup(); registryCleanup() })

it('lists the default option and every plugin theme grouped by owner', () => {
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight' }), theme({ id: 'noon', label: 'Noon', base: 'light' })]))
  themeRegistry.set(pack('pluginB', [theme({ id: 'forest', label: 'Forest', base: 'dark' })]))
  picker('')
  const radiogroup = screen.getByRole('radiogroup')
  const inputs = radios(radiogroup)
  expect(inputs.map(input => input.value)).toEqual(['__none__', 'pluginA:midnight', 'pluginA:noon', 'pluginB:forest'])
  expect(within(radiogroup).getByText('Default (theme only)')).toBeTruthy()
  expect(within(radiogroup).getAllByText(/^From pluginA$/)).toHaveLength(2)
  expect(within(radiogroup).getByText('From pluginB')).toBeTruthy()
})

it('applies a plugin theme on confirm, persists the id and activates it through the registry', () => {
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight' })]))
  const onSet = vi.fn()
  const view = picker('', onSet)
  fireEvent.click(screen.getByRole('radio', { name: /Midnight/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(onSet).toHaveBeenCalledWith('pluginA:midnight')
  expect(themeRegistry.activeSelection()).toEqual({ pluginId: 'pluginA', themeId: 'midnight' })
  expect(document.documentElement.getAttribute('data-theme-plugin')).toBe('midnight')
  // Simulate the parent re-rendering with the new saved value: the picker now reflects the choice.
  view.rerender('pluginA:midnight')
  expect((screen.getByRole('radio', { name: /Midnight/ }) as HTMLInputElement).checked).toBe(true)
})

it('shows a live preview while a choice is pending but does not persist until confirmed', () => {
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight' }), theme({ id: 'noon', label: 'Noon' })]))
  const onSet = vi.fn()
  picker('', onSet)
  fireEvent.click(screen.getByRole('radio', { name: /Noon/ }))
  expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBe('noon')
  expect(document.documentElement.getAttribute('data-theme-plugin')).toBeNull()
  expect(themeRegistry.activeSelection()).toBeNull()
  expect(onSet).not.toHaveBeenCalled()
})

it('cancels a preview and leaves the saved active choice intact', () => {
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight' }), theme({ id: 'noon', label: 'Noon' })]))
  // Bring the active in sync with the saved value (the host does this; the picker does not apply on mount).
  themeRegistry.apply('pluginA', 'midnight')
  const view = picker('pluginA:midnight', vi.fn())
  view.rerender('pluginA:midnight')
  fireEvent.click(screen.getByRole('radio', { name: /Noon/ }))
  expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBe('noon')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }))
  expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBeNull()
  expect(themeRegistry.activeSelection()).toEqual({ pluginId: 'pluginA', themeId: 'midnight' })
  expect((screen.getByRole('radio', { name: /Midnight/ }) as HTMLInputElement).checked).toBe(true)
})

it('cancels the preview when the panel unmounts (closing the screen)', () => {
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight' }), theme({ id: 'noon', label: 'Noon' })]))
  themeRegistry.apply('pluginA', 'midnight')
  const view = picker('pluginA:midnight', vi.fn())
  fireEvent.click(screen.getByRole('radio', { name: /Noon/ }))
  expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBe('noon')
  view.unmount()
  expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBeNull()
  expect(themeRegistry.previewSelection()).toBeNull()
  // The active plugin theme is left as-is; the registry does not auto-apply.
  expect(themeRegistry.activeSelection()).toEqual({ pluginId: 'pluginA', themeId: 'midnight' })
})

it('restores the default (no plugin override) and clears the saved id', () => {
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight' })]))
  themeRegistry.apply('pluginA', 'midnight')
  const onSet = vi.fn()
  const view = picker('pluginA:midnight', onSet)
  view.rerender('pluginA:midnight')
  fireEvent.click(screen.getByRole('button', { name: 'Restore default' }))
  expect(onSet).toHaveBeenCalledWith('')
  expect(themeRegistry.activeSelection()).toBeNull()
  expect(document.documentElement.hasAttribute('data-theme-plugin')).toBe(false)
  view.rerender('')
  expect((screen.getByRole('radio', { name: /Default/ }) as HTMLInputElement).checked).toBe(true)
})

it('disables confirm when the pending preview matches the saved choice (keyboard nav into the saved item)', () => {
  // Clicking an already-checked radio is a native no-op (in JSDOM and browsers), so we
  // exercise the keyboard path that calls `select` directly with Dawn → Noon → Midnight.
  themeRegistry.set(pack('pluginA', [
    theme({ id: 'midnight', label: 'Midnight' }),
    theme({ id: 'noon', label: 'Noon' }),
    theme({ id: 'dawn', label: 'Dawn' }),
  ]))
  const view = picker('pluginA:midnight', vi.fn())
  view.rerender('pluginA:midnight')
  const radiogroup = screen.getByRole('radiogroup')
  // First click Noon directly so preview = Noon (confirm enabled).
  fireEvent.click(screen.getByRole('radio', { name: /Noon/ }))
  expect(themeRegistry.previewSelection()).toEqual({ pluginId: 'pluginA', themeId: 'noon' })
  expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(false)
  // Keyboard from Dawn (inputs[3]) → ArrowUp to Noon, ArrowUp to Midnight (the saved).
  const dawn = screen.getByRole('radio', { name: /Dawn/ }) as HTMLInputElement
  dawn.focus()
  fireEvent.keyDown(radiogroup, { key: 'ArrowUp' })
  expect(themeRegistry.previewSelection()).toEqual({ pluginId: 'pluginA', themeId: 'noon' })
  fireEvent.keyDown(radiogroup, { key: 'ArrowUp' })
  expect(themeRegistry.previewSelection()).toEqual({ pluginId: 'pluginA', themeId: 'midnight' })
  // The saved theme is now the preview: no real change → Confirm is disabled.
  expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(true)
})

it('disables confirm, cancel and restore until a preview or saved plugin theme exists', () => {
  picker('')
  expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: 'Cancel preview' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: 'Restore default' }).hasAttribute('disabled')).toBe(true)
})

it('survives a plugin being removed while its theme is being previewed (DOM falls back, picker still works)', () => {
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight' })]))
  picker('', vi.fn())
  fireEvent.click(screen.getByRole('radio', { name: /Midnight/ }))
  expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBe('midnight')
  themeRegistry.remove('pluginA')
  expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }))
  expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBeNull()
  expect(themeRegistry.previewSelection()).toBeNull()
})

it('survives a plugin being updated while its theme is being previewed (the new tokens win on confirm)', () => {
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight', tokens: { 'vscode-editor-background': '#111111' } })]))
  picker('', vi.fn())
  fireEvent.click(screen.getByRole('radio', { name: /Midnight/ }))
  const previewStyleBefore = document.head.querySelector('style[data-theme-plugin-preview-source="midnight"]')
  expect(previewStyleBefore?.textContent ?? '').toContain('#111111')
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight', tokens: { 'vscode-editor-background': '#222222' } })]))
  const previewStyleAfter = document.head.querySelector('style[data-theme-plugin-preview-source="midnight"]')
  expect(previewStyleAfter?.textContent ?? '').toContain('#222222')
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(document.documentElement.getAttribute('data-theme-plugin')).toBe('midnight')
  expect(document.head.querySelector('style[data-theme-plugin-source="midnight"]')?.textContent ?? '').toContain('#222222')
})

it('shows the saved theme as an unavailable choice when its plugin is not registered, falling back without clearing the id', () => {
  // Save references the plugin/theme but the registry has no theme for it.
  const view = picker('pluginA:midnight', vi.fn())
  view.rerender('pluginA:midnight')
  const radiogroup = screen.getByRole('radiogroup')
  const unavailableInput = radiogroup.querySelector('input[type="radio"][value="__unavailable__:pluginA:midnight"]') as HTMLInputElement | null
  expect(unavailableInput).toBeTruthy()
  expect(unavailableInput?.disabled).toBe(true)
  expect(screen.getByText(/Saved theme unavailable/)).toBeTruthy()
  // Restore asks the parent to persist the empty id; the unavailable warning stays
  // until the parent propagates the new value through the render tree.
  themeRegistry.remove('pluginA')
  fireEvent.click(screen.getByRole('button', { name: 'Restore default' }))
  view.rerender('')
  expect(screen.queryByText(/Saved theme unavailable/)).toBeNull()
})

it('keeps keyboard navigation (arrows, Home, End) inside the radiogroup and triggers the same preview as a click', () => {
  themeRegistry.set(pack('pluginA', [theme({ id: 'midnight', label: 'Midnight' }), theme({ id: 'noon', label: 'Noon' }), theme({ id: 'dawn', label: 'Dawn' })]))
  picker('')
  const radiogroup = screen.getByRole('radiogroup')
  const inputs = radios(radiogroup)
  expect(inputs.length).toBeGreaterThan(2)
  // Layout: [0]=Default (None), [1]=Midnight, [2]=Noon, [3]=Dawn.
  inputs[0]?.focus()
  // ArrowDown once: 0 → 1 (Midnight).
  fireEvent.keyDown(radiogroup, { key: 'ArrowDown' })
  expect(themeRegistry.previewSelection()).toEqual({ pluginId: 'pluginA', themeId: 'midnight' })
  // End jumps to the last item (Dawn).
  fireEvent.keyDown(radiogroup, { key: 'End' })
  expect(themeRegistry.previewSelection()).toEqual({ pluginId: 'pluginA', themeId: 'dawn' })
  // Home from Dawn → index 0 (Default): the picker calls `themeRegistry.reset()` and the
  // registry's previewSelection becomes null; focus moves to the Default radio.
  fireEvent.keyDown(radiogroup, { key: 'Home' })
  expect(document.activeElement).toBe(inputs[0])
  expect(themeRegistry.previewSelection()).toBeNull()
  // ArrowUp wraps from index 0 to the last item (Dawn).
  fireEvent.keyDown(radiogroup, { key: 'ArrowUp' })
  expect(themeRegistry.previewSelection()).toEqual({ pluginId: 'pluginA', themeId: 'dawn' })
  // ArrowUp from Dawn → Noon (skip 0 because None was just visited and reset cleared preview;
  // the next click moves to the previous unchecked item).
  fireEvent.keyDown(radiogroup, { key: 'ArrowUp' })
  expect(themeRegistry.previewSelection()).toEqual({ pluginId: 'pluginA', themeId: 'noon' })
})

describe(`budgets (median of ${ROUNDS} rounds, happy-dom)`, () => {
  it('opens the picker with 100 choices (1 default + 99 themes) under 100 ms', () => {
    const themes: PluginTheme[] = []
    for (let i = 0; i < 99; i++) themes.push(theme({ id: `${i}`, label: `Theme ${i}` }))
    themeRegistry.set(pack('plugin', themes))
    const samples: number[] = []
    for (let run = 0; run < ROUNDS; run++) {
      cleanup()
      const start = performance.now()
      render(<I18nProvider language="en"><ThemePicker value="" set={vi.fn()} /></I18nProvider>)
      samples.push(performance.now() - start)
    }
    expect(screen.getAllByRole('radio')).toHaveLength(100)
    const sorted = [...samples].sort((a, b) => a - b)
    const middle = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    process.stdout.write(`theme-picker open of 100 choices median of ${ROUNDS}=${middle.toFixed(3)} ms; samples=${samples.map(s => s.toFixed(3)).join(', ')}\n`)
    expect(middle).toBeLessThan(100)
  })

  it('keeps themeRegistry.preview under 5 ms with 99 themes registered (median of rounds)', () => {
    const themes: PluginTheme[] = []
    const owners: string[] = []
    for (let i = 0; i < 99; i++) {
      owners.push(`plugin${i}`)
      themes.push(theme({ id: `${i}`, label: `Theme ${i}`, tokens: { 'vscode-foreground': `#${i.toString(16).padStart(6, '0')}` } }))
    }
    themeRegistry.set(pack('plugin', themes))
    const samples: number[] = []
    for (let run = 0; run < ROUNDS; run++) {
      const target = run % owners.length
      const start = performance.now()
      themeRegistry.preview('plugin', `${target}`)
      themeRegistry.cancel()
      samples.push(performance.now() - start)
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const middle = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    process.stdout.write(`theme-picker preview under 99 themes median of ${ROUNDS}=${middle.toFixed(3)} ms; samples=${samples.map(s => s.toFixed(3)).join(', ')}\n`)
    expect(middle).toBeLessThan(5)
  })
})
