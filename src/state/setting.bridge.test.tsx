// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FbApi } from '@core/api.ts'
import { writeFileSync } from 'node:fs'

let values: Record<string, unknown>
let changed: (ids: readonly string[]) => void
let settings: FbApi['settings']
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  localStorage.clear()
  localStorage.setItem('fb:settings-migrated', 'true')
  values = {}
  settings = {
    all: vi.fn(() => ({ ...values })), notices: () => [], set: vi.fn(), reset: vi.fn(),
    onChanged: vi.fn((cb) => { changed = cb; return () => {} }),
  }
  window.fb = { settings } as FbApi
})
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  delete window.fb
})

it('reads the initial bridge once and validates invalid values', async () => {
  values = { 'editor.wordWrap': true, 'files.showHidden': 'invalid' }
  localStorage.setItem('fb:wordWrap', 'false')
  const { wordWrap, showHidden } = await import('./setting.ts')
  expect(wordWrap.get()).toBe(true)
  expect(showHidden.get()).toBe(false)
  expect(settings.all).toHaveBeenCalledTimes(1)
})

it('reset uses the bridge and cancels an older queued value so it cannot resurrect the modification', async () => {
  const { wordWrap } = await import('./setting.ts')
  wordWrap.set(true)
  wordWrap.set(true)
  wordWrap.reset()
  expect(wordWrap.get()).toBe(false)
  expect(settings.reset).toHaveBeenCalledExactlyOnceWith(['editor.wordWrap'])
  vi.advanceTimersByTime(100)
  expect(settings.set).toHaveBeenCalledTimes(1)
})

it('sends the first change at once and groups the next 100 ms into one call with the last value of each id', async () => {
  const { wordWrap, showHidden } = await import('./setting.ts')
  for (let i = 0; i < 100; i++) {
    wordWrap.set(i % 2 === 0)
    if (i === 10) showHidden.set(true)
  }
  expect(wordWrap.get()).toBe(false)
  expect(settings.set).toHaveBeenCalledExactlyOnceWith([['editor.wordWrap', true]])
  vi.advanceTimersByTime(99)
  expect(settings.set).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(1)
  expect(settings.set).toHaveBeenCalledTimes(2)
  expect(settings.set).toHaveBeenLastCalledWith([['editor.wordWrap', false], ['files.showHidden', true]])
  // Nothing more goes while nothing changes; a change after the quiet period goes at once.
  vi.advanceTimersByTime(500)
  expect(settings.set).toHaveBeenCalledTimes(2)
  wordWrap.set(true)
  expect(settings.set).toHaveBeenCalledTimes(3)
})

it('never makes more than one call to the main process per 100 ms', async () => {
  const { wordWrap } = await import('./setting.ts')
  const times: number[] = []
  let clock = 0
  vi.mocked(settings.set).mockImplementation(() => void times.push(clock))
  while (clock < 1000) {
    if (clock % 10 === 0) wordWrap.set(clock % 20 === 0)
    clock++
    vi.advanceTimersByTime(1)
  }
  expect(times.length).toBeGreaterThan(1)
  for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(100)
})

it('flushes the waiting change when the window is leaving', async () => {
  const { wordWrap, showHidden } = await import('./setting.ts')
  wordWrap.set(true)
  showHidden.set(true)
  expect(settings.set).toHaveBeenCalledTimes(1)
  expect(settings.all).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new Event('pagehide'))
  expect(settings.set).toHaveBeenCalledTimes(2)
  // The synchronous read after the send is the barrier that makes the main process receive it before the window is gone.
  expect(settings.all).toHaveBeenCalledTimes(2)
  expect(settings.set).toHaveBeenLastCalledWith([['files.showHidden', true]])
  vi.advanceTimersByTime(500)
  expect(settings.set).toHaveBeenCalledTimes(2)
})

it('ignores the event of an id whose newer value is still waiting to be sent', async () => {
  const { wordWrap } = await import('./setting.ts')
  wordWrap.set(true)
  wordWrap.set(false)
  values = { 'editor.wordWrap': true }
  changed(['editor.wordWrap'])
  expect(wordWrap.get()).toBe(false)
})

it('notifies readers immediately and only rerenders the id in onChanged', async () => {
  const { wordWrap, showHidden } = await import('./setting.ts')
  let wrapRenders = 0
  let hiddenRenders = 0
  function Wrap() { wrapRenders++; return <span>{String(wordWrap.use())}</span> }
  function Hidden() { hiddenRenders++; return <span>{String(showHidden.use())}</span> }
  render(<><Wrap /><Hidden /></>)
  act(() => wordWrap.set(true))
  expect(wrapRenders).toBe(2)
  expect(hiddenRenders).toBe(1)
  // all() can contain other values; only the ids named by this event may update.
  values = { 'editor.wordWrap': false, 'files.showHidden': true }
  act(() => changed(['editor.wordWrap']))
  expect(wordWrap.get()).toBe(false)
  expect(wrapRenders).toBe(3)
  expect(showHidden.get()).toBe(false)
  expect(hiddenRenders).toBe(1)
  act(() => changed(['files.showHidden']))
  expect(hiddenRenders).toBe(2)
})

it('migrates only valid absent values and preserves legacy keys', async () => {
  localStorage.removeItem('fb:settings-migrated')
  localStorage.setItem('fb:wordWrap', 'true')
  localStorage.setItem('fb:showHidden', '"invalid"')
  localStorage.setItem('fb:sortKey', '"size"')
  values = { 'files.sortKey': 'modified' }
  const { wordWrap, showHidden, sortKey } = await import('./setting.ts')
  expect(wordWrap.get()).toBe(true)
  expect(showHidden.get()).toBe(false)
  expect(sortKey.get()).toBe('modified')
  vi.advanceTimersByTime(100)
  expect(settings.set).toHaveBeenCalledExactlyOnceWith([['editor.wordWrap', true]])
  expect(localStorage.getItem('fb:wordWrap')).toBe('true')
  expect(localStorage.getItem('fb:showHidden')).toBe('"invalid"')
  expect(localStorage.getItem('fb:sortKey')).toBe('"size"')
  expect(localStorage.getItem('fb:settings-migrated')).toBe('true')
})

it('migrates over the default the bridge reports for an id the file does not hold, but never over a value set', async () => {
  localStorage.removeItem('fb:settings-migrated')
  localStorage.setItem('fb:wordWrap', 'true')
  localStorage.setItem('fb:sortKey', '"size"')
  // The main process answers every registered id: the default stands for "not in the file".
  values = { 'editor.wordWrap': false, 'files.sortKey': 'modified' }
  const { wordWrap, sortKey } = await import('./setting.ts')
  expect(wordWrap.get()).toBe(true)
  expect(sortKey.get()).toBe('modified')
  vi.advanceTimersByTime(100)
  expect(settings.set).toHaveBeenCalledExactlyOnceWith([['editor.wordWrap', true]])
})

it('falls back to the default when onChanged brings an invalid value', async () => {
  const { sortKey } = await import('./setting.ts')
  values = { 'files.sortKey': 'size' }
  changed(['files.sortKey'])
  expect(sortKey.get()).toBe('size')
  values = { 'files.sortKey': 'bogus' }
  changed(['files.sortKey'])
  expect(sortKey.get()).toBe('name')
})

it('does not resurrect a legacy value after migration and a reset to default', async () => {
  localStorage.removeItem('fb:settings-migrated')
  localStorage.setItem('fb:wordWrap', 'true')
  const first = await import('./setting.ts')
  vi.advanceTimersByTime(100)
  first.wordWrap.set(false)
  vi.advanceTimersByTime(100)
  vi.mocked(settings.set).mockClear()
  // The next startup has no persisted override (the user reset to default).
  values = {}
  vi.resetModules()
  const second = await import('./setting.ts')
  expect(second.wordWrap.get()).toBe(false)
  vi.advanceTimersByTime(100)
  expect(settings.set).not.toHaveBeenCalled()
  expect(localStorage.getItem('fb:wordWrap')).toBe('true')
})

it('migrates all 17 legacy options to their builtin ids in one batch', async () => {
  localStorage.removeItem('fb:settings-migrated')
  const legacy: Record<string, unknown> = {
    wordWrap: true, svgView: 'code', csvView: 'text', markdownView: 'text', markdownWide: true,
    markdownWrapCode: true, reopenSession: false, dividerColour: '#123456', hotExit: false,
    showHidden: true, sortKey: 'size', sortDescending: true, formatSource: false,
    diffLayout: 'inline', diffCollapse: false, theme: 'light', language: 'pt-BR',
  }
  for (const [key, value] of Object.entries(legacy)) localStorage.setItem(`fb:${key}`, JSON.stringify(value))
  await import('./setting.ts')
  await import('../theme/theme.ts')
  await import('./language.ts')
  vi.advanceTimersByTime(100)
  expect(settings.set).toHaveBeenCalledExactlyOnceWith([
    ['editor.wordWrap', true], ['files.svgView', 'code'], ['files.csvView', 'text'],
    ['editor.markdownView', 'text'], ['editor.markdownWide', true], ['editor.markdownWrapCode', true],
    ['tabs.reopenSession', false], ['appearance.dividerColour', '#123456'], ['editor.hotExit', false],
    ['files.showHidden', true], ['files.sortKey', 'size'], ['files.sortDescending', true],
    ['editor.formatSource', false], ['diff.layout', 'inline'], ['diff.collapseUnchanged', false],
    ['appearance.theme', 'light'], ['system.language', 'pt-BR'],
  ])
})

it('marks migration even when there are no valid legacy values', async () => {
  localStorage.removeItem('fb:settings-migrated')
  await import('./setting.ts')
  await Promise.resolve()
  expect(localStorage.getItem('fb:settings-migrated')).toBe('true')
  expect(settings.set).not.toHaveBeenCalled()
})

it('keeps the localStorage get set reload and use APIs without the bridge', async () => {
  delete window.fb
  const { wordWrap } = await import('./setting.ts')
  function Reader() { return <span>{String(wordWrap.use())}</span> }
  render(<Reader />)
  act(() => wordWrap.set(true))
  expect(screen.getByText('true')).toBeTruthy()
  expect(localStorage.getItem('fb:wordWrap')).toBe('true')
  localStorage.setItem('fb:wordWrap', 'false')
  act(() => wordWrap.reload())
  expect(screen.getByText('false')).toBeTruthy()
  expect(wordWrap.get()).toBe(false)
})

it('applies the bridge theme before rendering and loads language through the same store', async () => {
  values = { 'appearance.theme': 'light', 'system.language': 'pt-BR' }
  localStorage.setItem('fb:theme', '"dark"')
  const { applyInitialTheme } = await import('../theme/theme.ts')
  const { getLanguageSetting, setLanguageSetting } = await import('./language.ts')
  applyInitialTheme()
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(getLanguageSetting()).toBe('pt-BR')
  expect(settings.all).toHaveBeenCalledTimes(1)
  setLanguageSetting('en')
  vi.advanceTimersByTime(100)
  expect(settings.set).toHaveBeenCalledExactlyOnceWith([['system.language', 'en']])
})

it('keeps the median cost of 100 sets under 5 ms over 20 samples', async () => {
  const { wordWrap } = await import('./setting.ts')
  const samples = []
  for (let sample = 0; sample < 20; sample++) {
    const start = performance.now()
    for (let i = 0; i < 100; i++) wordWrap.set(i % 2 === 0)
    samples.push(performance.now() - start)
    vi.advanceTimersByTime(100)
  }
  samples.sort((a, b) => a - b)
  const median = (samples[9] + samples[10]) / 2
  if (process.env.FB_SETTINGS_BUDGET_REPORT) {
    writeFileSync(process.env.FB_SETTINGS_BUDGET_REPORT, JSON.stringify({ medianMs: median, samplesMs: samples }) + '\n')
  }
  process.stdout.write(`100 settings.set renderer operations: median ${median.toFixed(4)} ms (20 samples)\n`)
  expect(median).toBeLessThan(5)
})
