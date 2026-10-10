// @vitest-environment happy-dom
import { Profiler } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { settingsRegistry, type SettingInput } from '@core/settings/registry.ts'
import { settingFor } from '@/state/setting.ts'
import { I18nProvider } from '@/i18n/context.tsx'
import { translator } from '@/i18n/index.ts'
import { filterSettings, indexSettings, SettingsView } from './SettingsView.tsx'
const removals: Array<() => void> = []
function contribute(inputs: SettingInput[]) { const remove = settingsRegistry.contribute(inputs); removals.push(remove); return remove }
const row = (id: string) => document.querySelector(`[data-setting="${id}"]`) as HTMLElement
const search = (query: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
function page() { return render(<I18nProvider language="en"><SettingsView theme="auto" setTheme={() => {}} /></I18nProvider>) }
beforeEach(() => { for (const d of settingsRegistry.all()) settingFor(d).reset() })
afterEach(() => { cleanup(); removals.splice(0).forEach(remove => remove()); vi.unstubAllGlobals() })

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
it('filters 500 settings below 10 ms (median of 20)', () => {
  contribute(Array.from({ length: 500 }, (_, i) => ({ id: `bench:item${i}`, type: 'boolean', default: false, category: 'bench', label: 'settings.wordWrap', description: 'settings.wordWrapHint' })))
  const entries = indexSettings(settingsRegistry.all().filter(d => d.id.startsWith('bench:')), translator('en'))
  const times: number[] = []
  for (let i = 0; i < 20; i++) {
    const start = performance.now(); const result = filterSettings(entries, '', false, {})
    times.push(performance.now() - start); expect(result).toHaveLength(500)
  }
  times.sort((a, b) => a - b); const median = (times[9] + times[10]) / 2
  console.info(`Settings filter median: ${median.toFixed(3)} ms`)
  expect(median).toBeLessThan(10)
})

it('renders 18 + 500 below 200 ms with controls bounded to the viewport', () => {
  contribute(Array.from({ length: 500 }, (_, i) => ({ id: `bench:item${i}`, type: 'boolean', default: false, category: 'bench', label: 'settings.wordWrap', description: 'settings.wordWrapHint' })))
  let duration = 0
  render(<Profiler id="settings" onRender={(_id, _phase, actualDuration) => { duration = actualDuration }}><I18nProvider language="en"><SettingsView theme="auto" setTheme={() => {}} /></I18nProvider></Profiler>)
  console.info(`Settings render 518: ${duration.toFixed(3)} ms`)
  expect(document.querySelectorAll('[data-setting]')).toHaveLength(518)
  expect(document.querySelectorAll('[data-setting] input').length).toBeLessThan(70)
  expect(duration).toBeLessThan(200)
})

it('commits typed input before the deferred list changes', () => {
  const commits: Array<{ query: string; rows: number }> = []
  render(<Profiler id="typing" onRender={() => {
    commits.push({ query: (document.querySelector('input[type=search]') as HTMLInputElement).value, rows: document.querySelectorAll('[data-setting]').length })
  }}><I18nProvider language="en"><SettingsView theme="auto" setTheme={() => {}} /></I18nProvider></Profiler>)
  search('minified')
  expect(commits.some(commit => commit.query === 'minified' && commit.rows === 18)).toBe(true)
  expect(commits.at(-1)).toEqual({ query: 'minified', rows: 1 })
})
