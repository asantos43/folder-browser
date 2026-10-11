// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import '@core/settings/builtin.ts'
import { settingsRegistry } from '@core/settings/registry.ts'
import { settingFor } from '@/state/setting.ts'
import { themeRegistry } from './registry.ts'
import { reconcileSavedTheme, useSavedTheme } from './savedTheme.ts'

const owner = 'acme.sample'
const id = `${owner}:fixture`
const saved = `${owner}:${id}`
const pack = { pluginId: owner, themes: [{ id, label: 'Fixture', base: 'dark' as const, tokens: {} }] }
const setting = settingFor(settingsRegistry.get('appearance.themePlugin')!)

beforeEach(() => {
  themeRegistry.set(pack)
  setting.set(saved)
  document.documentElement.dataset.theme = 'light'
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  themeRegistry.reset()
  themeRegistry.remove(owner)
  setting.set('')
})

it('applies the saved compiled id at startup without Settings mounted', () => {
  renderHook(useSavedTheme)
  expect(document.documentElement.dataset.themePlugin).toBe(id)
  expect(document.documentElement.dataset.theme).toBe('light')
})

it('applies a late first generation and reapplies when the owner returns', () => {
  themeRegistry.remove(owner)
  renderHook(useSavedTheme)
  expect(themeRegistry.activeSelection()).toBeNull()
  act(() => { themeRegistry.set(pack) })
  expect(document.documentElement.dataset.themePlugin).toBe(id)
  act(() => { themeRegistry.remove(owner) })
  expect(document.documentElement.dataset.themePlugin).toBeUndefined()
  expect(setting.get()).toBe(saved)
  act(() => { themeRegistry.set(pack) })
  expect(document.documentElement.dataset.themePlugin).toBe(id)
})

it('does not apply an absent theme or write its saved preference', () => {
  themeRegistry.set({ pluginId: owner, themes: [] })
  const apply = vi.spyOn(themeRegistry, 'apply')
  const write = vi.spyOn(setting, 'set')
  renderHook(useSavedTheme)
  expect(apply).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  expect(setting.get()).toBe(saved)
})

it('clears an active plugin on an empty preference while preserving the base', () => {
  renderHook(useSavedTheme)
  act(() => setting.set(''))
  expect(themeRegistry.activeSelection()).toBeNull()
  expect(document.documentElement.dataset.themePlugin).toBeUndefined()
  expect(document.documentElement.dataset.theme).toBe('light')
})

it('does not reset when only the base theme is active', () => {
  const reset = vi.spyOn(themeRegistry, 'reset')
  reconcileSavedTheme('', themeRegistry)
  expect(reset).not.toHaveBeenCalled()
})

it.each([saved, ''])('preserves a running preview for saved value %j', value => {
  themeRegistry.preview(owner, id)
  setting.set(value)
  renderHook(useSavedTheme)
  act(() => { themeRegistry.set(pack) })
  expect(themeRegistry.previewSelection()).toEqual({ pluginId: owner, themeId: id })
  expect(themeRegistry.activeSelection()).toBeNull()
  expect(document.documentElement.dataset.themePluginPreview).toBe(id)
})

it('is idempotent across settings and registry changes', () => {
  const apply = vi.spyOn(themeRegistry, 'apply')
  renderHook(useSavedTheme)
  act(() => setting.set(saved))
  act(() => { themeRegistry.set(pack) })
  expect(apply).toHaveBeenCalledTimes(1)
})

it('bounds reconciliation to one keyed lookup without enumerating themes', () => {
  const lookup = vi.spyOn(themeRegistry, 'hasTheme')
  const owners = vi.spyOn(themeRegistry, 'owners')
  const themes = vi.spyOn(themeRegistry, 'themesOf')
  for (let n = 0; n < 100; n++) reconcileSavedTheme(`${owner}:${owner}:missing`, themeRegistry)
  expect(lookup).toHaveBeenCalledTimes(100)
  expect(owners).not.toHaveBeenCalled()
  expect(themes).not.toHaveBeenCalled()
})

it('unsubscribes both sources when the app bridge unmounts', () => {
  const { unmount } = renderHook(useSavedTheme)
  unmount()
  themeRegistry.reset()
  themeRegistry.set(pack)
  setting.set(saved)
  expect(themeRegistry.activeSelection()).toBeNull()
})
