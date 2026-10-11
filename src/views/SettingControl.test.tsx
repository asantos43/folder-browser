// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { builtinSettings } from '@core/settings/builtin.ts'
import type { SettingDefinition } from '@core/settings/registry.ts'
import { I18nProvider } from '@/i18n/context.tsx'
import { i18nRegistry } from '@/i18n/index.ts'
import { SettingControl } from './SettingControl.tsx'

const definition = builtinSettings.find(setting => setting.id === 'system.language')!
afterEach(async () => {
  cleanup()
  i18nRegistry.removePlugin('locale-control')
  i18nRegistry.select('en')
  await Promise.resolve()
})
const page = (value: string, set = vi.fn()) => render(<I18nProvider language="en"><SettingControl definition={definition} value={value} label="Language" set={set} /></I18nProvider>)

it('lists auto and native catalog names and persists only the user selection', async () => {
  const set = vi.fn()
  page('auto', set)
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Automatic (follow the system)', 'English', 'Português (Brasil)'])
  await act(async () => { i18nRegistry.setPlugin('locale-control', [{ language: 'fr', label: 'Français', load: () => ({}) }]) })
  expect(screen.getByRole('option', { name: 'Français' })).toBeTruthy()
  expect(set).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr' } })
  expect(set).toHaveBeenCalledExactlyOnceWith('fr')
  await act(async () => { i18nRegistry.setPlugin('locale-control', [{ language: 'fr', label: 'Français mis à jour', load: () => ({}) }]) })
  expect(screen.getByRole('option', { name: 'Français mis à jour' })).toBeTruthy()
})

it('renders unknown saved preferences safely, warns and restores removed options without writes', async () => {
  const set = vi.fn()
  page('fr', set)
  const select = screen.getByRole('combobox') as HTMLSelectElement
  expect(select.value).toBe('fr')
  expect((screen.getByRole('option', { name: 'fr — Unavailable' }) as HTMLOptionElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toContain('your preference is kept')
  await act(async () => { i18nRegistry.setPlugin('locale-control', [{ language: 'fr', label: 'Français', load: () => ({}) }]) })
  expect(select.value).toBe('fr')
  expect(screen.queryByRole('status')).toBeNull()
  await act(async () => { i18nRegistry.removePlugin('locale-control') })
  expect(select.value).toBe('fr')
  expect(screen.getByRole('status')).toBeTruthy()
  expect(set).not.toHaveBeenCalled()
})

it('keeps the choices of other settings unchanged', () => {
  const other = builtinSettings.find(setting => setting.id === 'files.svgView')!, set = vi.fn()
  render(<I18nProvider language="en"><SettingControl definition={other} value="image" label="SVG" set={set} /></I18nProvider>)
  expect(screen.getAllByRole('option')).toHaveLength(2)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'code' } })
  expect(set).toHaveBeenCalledExactlyOnceWith('code')
})

it('scopes choice labels to the owner, falls back for missing/empty text and preserves disabled values', async () => {
  i18nRegistry.setPlugin('locale-control', [], { first: { en: 'First', 'pt-BR': 'Primeira' }, empty: { en: '' } })
  const d: SettingDefinition = { id: 'locale-control:choice', type: 'choice', default: 'a', category: 'plugins', label: 'Choice', choices: ['a', 'b', 'c'], choiceLabels: ['first', 'Literal', 'empty'], owner: { id: 'locale-control', enabled: false } }
  const set = vi.fn()
  const view = render(<I18nProvider language="pt-BR"><SettingControl definition={d} value="b" label="Choice" set={set} /></I18nProvider>)
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Primeira', 'Literal', 'empty'])
  const select = screen.getByRole('combobox') as HTMLSelectElement
  expect(select.matches(':disabled')).toBe(true)
  expect(select.value).toBe('b')
  fireEvent.change(select, { target: { value: 'a' } })
  expect(set).not.toHaveBeenCalled()
  view.rerender(<I18nProvider language="en"><SettingControl definition={{ ...d, owner: { id: 'locale-control', enabled: true } }} value="b" label="Choice" set={set} /></I18nProvider>)
  expect(select.matches(':disabled')).toBe(false)
  expect(screen.getByRole('option', { name: 'First' })).toBeTruthy()
  await act(async () => { i18nRegistry.removePlugin('locale-control') })
  expect(screen.getByRole('option', { name: 'first' })).toBeTruthy()
})

it.each([
  ['boolean', true], ['number', 7], ['string', 'saved'], ['colour', '#123456'], ['list', ['saved', 'lines']],
] as const)('disables %s controls without changing the saved value', (type, value) => {
  const set = vi.fn()
  const d: SettingDefinition = { id: `disabled:${type}`, type, default: value, category: 'plugins', label: 'Saved', owner: { id: 'disabled', enabled: false } }
  const { container } = render(<I18nProvider language="en"><SettingControl definition={d} value={value} label="Saved" set={set} /></I18nProvider>)
  const input = container.querySelector('input, textarea') as HTMLInputElement
  expect(input.disabled).toBe(true)
  if (type === 'boolean') expect(input.checked).toBe(true)
  else expect(input.value).toBe(Array.isArray(value) ? value.join('\n') : String(value))
  fireEvent.change(input, { target: { value: type === 'number' ? '8' : 'changed' } })
  expect(set).not.toHaveBeenCalled()
})
