// @vitest-environment happy-dom
import { Profiler } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { settingsRegistry, type SettingInput } from '@core/settings/registry.ts'
import { settingFor } from '@/state/setting.ts'
import { I18nProvider } from '@/i18n/context.tsx'
import { i18nRegistry, translator } from '@/i18n/index.ts'
import { filterSettings, indexSettings, SettingsView } from './SettingsView.tsx'
const removals: Array<() => void> = []
function contribute(inputs: SettingInput[]) { const remove = settingsRegistry.contribute(inputs); removals.push(remove); return remove }
const row = (id: string) => document.querySelector(`[data-setting="${id}"]`) as HTMLElement
const search = (query: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
function page() { return render(<I18nProvider language="en"><SettingsView theme="auto" setTheme={() => {}} /></I18nProvider>) }
beforeEach(() => { for (const d of settingsRegistry.all()) settingFor(d).reset() })
afterEach(() => { cleanup(); removals.splice(0).forEach(remove => remove()); i18nRegistry.removePlugin('owned'); i18nRegistry.select('en'); vi.unstubAllGlobals() })

it('search matches a description independently of label or keywords', () => {
  page(); search('minified'); expect(row('editor.formatSource')).toBeTruthy()
})
it('normalizes accented labels independently of descriptions and keywords', () => {
  contribute([{ id: 'accent:label', type: 'boolean', default: false, category: 'test', label: 'settings.portuguese' }])
  page(); search('PORTUGUES'); expect(row('accent:label')).toBeTruthy()
})
it('searches a declared keyword absent from the label and description', () => {
  contribute([{ id: 'keyword:entry', type: 'boolean', default: false, category: 'test', label: 'settings.wordWrap', keywords: ['settings.portuguese'] }])
  page(); search('português'); expect(row('keyword:entry')).toBeTruthy()
})
it('reset row clears the modified mark and cancels its override', () => {
  page(); act(() => settingFor(settingsRegistry.get('files.showHidden')!).set(true))
  expect(within(row('files.showHidden')).getByText('Modified')).toBeTruthy()
  fireEvent.click(within(row('files.showHidden')).getByRole('button', { name: /^Reset$/ }))
  expect(within(row('files.showHidden')).queryByText('Modified')).toBeNull()
  expect(settingFor(settingsRegistry.get('files.showHidden')!).get()).toBe(false)
})
it('only modified hides defaults after a real store change', () => {
  page(); act(() => settingFor(settingsRegistry.get('files.showHidden')!).set(true))
  fireEvent.click(screen.getByRole('switch', { name: 'Show Only Modified' }))
  expect(document.querySelectorAll('[data-setting]')).toHaveLength(1)
  expect(row('files.showHidden')).toBeTruthy()
})
it('reset section clears both visible and hidden modifications', () => {
  page()
  act(() => {
    settingFor(settingsRegistry.get('files.showHidden')!).set(true)
    settingFor(settingsRegistry.get('files.sortDescending')!).set(true)
    settingFor(settingsRegistry.get('editor.wordWrap')!).set(true)
  })
  search('hidden')
  fireEvent.click(within(screen.getByRole('region', { name: 'Files' })).getByRole('button', { name: 'Reset section' }))
  expect(settingFor(settingsRegistry.get('files.showHidden')!).get()).toBe(false)
  expect(settingFor(settingsRegistry.get('files.sortDescending')!).get()).toBe(false)
  expect(settingFor(settingsRegistry.get('editor.wordWrap')!).get()).toBe(true)
})
it('restart note comes from the declared flag', () => {
  contribute([{ id: 'note:flag', type: 'boolean', default: false, category: 'test', label: 'settings.wordWrap', restart: true }])
  page(); expect(within(row('note:flag')).getByText('Restart required')).toBeTruthy()
})
it('mounts rows entering the viewport and releases rows leaving it, but retains focused controls', () => {
  let callback!: IntersectionObserverCallback
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IntersectionObserverCallback) { callback = cb }
    observe = observe
    disconnect = disconnect
  })
  contribute(Array.from({ length: 500 }, (_, i) => ({ id: `viewport:item${i}`, type: 'boolean', default: false, category: 'test', label: 'settings.wordWrap' })))
  page(); expect(observe).toHaveBeenCalledTimes(500)
  expect(within(row('viewport:item499')).queryByRole('checkbox')).toBeNull()
  const enter = (id: string, isIntersecting: boolean) => act(() => {
    const target = row(id)
    const rect = target.getBoundingClientRect()
    callback([{ target, isIntersecting, boundingClientRect: rect, intersectionRect: rect, intersectionRatio: isIntersecting ? 1 : 0, rootBounds: null, time: performance.now() }], {} as IntersectionObserver)
  })
  enter('viewport:item499', true)
  const input = within(row('viewport:item499')).getByRole('checkbox')
  input.focus(); enter('viewport:item499', false)
  expect(within(row('viewport:item499')).getByRole('checkbox')).toBe(input)
  input.blur(); enter('viewport:item499', false)
  expect(within(row('viewport:item499')).queryByRole('checkbox')).toBeNull()
  cleanup(); expect(disconnect).toHaveBeenCalled()
})
it('filters 500 settings below 10 ms (median of 7)', () => {
  contribute(Array.from({ length: 500 }, (_, i) => ({ id: `bench:item${i}`, type: 'boolean', default: false, category: 'bench', label: 'settings.wordWrap', description: 'settings.wordWrapHint' })))
  const entries = indexSettings(settingsRegistry.all().filter(d => d.id.startsWith('bench:')), translator('en'))
  const times: number[] = []
  for (let i = 0; i < 7; i++) {
    const start = performance.now(); const result = filterSettings(entries, '', false, {})
    times.push(performance.now() - start); expect(result).toHaveLength(500)
  }
  times.sort((a, b) => a - b); const median = times[3]
  console.info(`Settings filter median: ${median.toFixed(3)} ms`)
  expect(median).toBeLessThan(10)
})

it('searches owner translations and keeps disabled rows modified and resettable', () => {
  i18nRegistry.setPlugin('owned', [], { label: { en: 'Owner label', 'pt-BR': 'Rótulo próprio' }, description: { en: 'Owner description', 'pt-BR': 'Descrição própria' }, choice: { en: 'Translated choice', 'pt-BR': 'Opção própria' } })
  contribute([{ id: 'owned:value', type: 'choice', default: 'a', choices: ['a', 'b'], choiceLabels: ['choice', 'Raw choice'], category: 'plugins', label: 'label', description: 'description', owner: { id: 'owned', enabled: false } }])
  const d = settingsRegistry.get('owned:value')!
  settingFor(d).set('b')
  render(<I18nProvider language="pt-BR"><SettingsView theme="auto" setTheme={() => {}} /></I18nProvider>)
  search('OPCAO PROPRIA')
  const element = row(d.id)
  expect(element.getAttribute('aria-disabled')).toBe('true')
  expect(element.className).toContain('opacity-50')
  expect(within(element).getByText('Rótulo próprio')).toBeTruthy()
  expect(within(element).getByText('Descrição própria')).toBeTruthy()
  expect(within(element).getByText(/O plugin owned está desabilitado/)).toBeTruthy()
  expect((within(element).getByRole('combobox') as HTMLSelectElement).value).toBe('b')
  fireEvent.click(screen.getByRole('switch', { name: 'Mostrar só modificados' }))
  expect(row(d.id)).toBeTruthy()
  fireEvent.click(within(row(d.id)).getByRole('button', { name: /^Restaurar$/ }))
  expect(settingFor(d).get()).toBe('a')
  expect(row(d.id)).toBeNull()
})

it('uses literal manifest text for missing/empty translations and never borrows app keys', () => {
  i18nRegistry.setPlugin('owned', [], { literal: { en: '' } })
  contribute([{ id: 'owned:literal', type: 'string', default: 'saved', category: 'plugins', label: 'literal', description: 'settings.wordWrap', owner: { id: 'owned', enabled: true } }])
  page()
  expect(within(row('owned:literal')).getByRole('heading', { name: 'literal' })).toBeTruthy()
  expect(within(row('owned:literal')).getByText('settings.wordWrap')).toBeTruthy()
  expect(within(row('owned:literal')).queryByText('Word Wrap')).toBeNull()
})

it('renders 20 + 500 below 200 ms with controls bounded to the viewport', () => {
  contribute(Array.from({ length: 500 }, (_, i) => ({ id: `bench:item${i}`, type: 'boolean', default: false, category: 'bench', label: 'settings.wordWrap', description: 'settings.wordWrapHint' })))
  let duration = 0
  render(<Profiler id="settings" onRender={(_id, _phase, actualDuration) => { duration = actualDuration }}><I18nProvider language="en"><SettingsView theme="auto" setTheme={() => {}} /></I18nProvider></Profiler>)
  console.info(`Settings render 520: ${duration.toFixed(3)} ms`)
  expect(document.querySelectorAll('[data-setting]')).toHaveLength(520)
  expect(document.querySelectorAll('[data-setting] input').length).toBeLessThan(70)
  expect(duration).toBeLessThan(200)
})

it('commits typed input before the deferred list changes', () => {
  const commits: Array<{ query: string; rows: number }> = []
  render(<Profiler id="typing" onRender={() => {
    commits.push({ query: (document.querySelector('input[type=search]') as HTMLInputElement).value, rows: document.querySelectorAll('[data-setting]').length })
  }}><I18nProvider language="en"><SettingsView theme="auto" setTheme={() => {}} /></I18nProvider></Profiler>)
  search('minified')
  expect(commits.some(commit => commit.query === 'minified' && commit.rows === 20)).toBe(true)
  expect(commits.at(-1)).toEqual({ query: 'minified', rows: 1 })
})
