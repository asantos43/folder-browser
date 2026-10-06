// @vitest-environment happy-dom
import type { FbApi } from '@core/api.ts'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { diffCollapse, diffLayout } from '@/state/setting.ts'
import { DiffView } from './DiffView.tsx'

const enc = (text: string) => new TextEncoder().encode(text)
type Files = Record<string, Uint8Array | { error: 'no-snapshot' | 'no-file' | 'too-large' }>

function show(files: Files, props: { zoom?: number } = {}) {
  const readFile = vi.fn(async (id: string, path: string) => {
    const file = files[`${id}:${path}`]
    return !file ? ({ error: 'no-file' } as const) : 'error' in file ? file : { bytes: file }
  })
  window.fb = { readFile } as unknown as FbApi
  const view = render(
    <I18nProvider language="en">
      <DiffView left={{ rootId: 'r1', path: 'a.txt' }} right={{ rootId: 'r2', path: 'docs/b.txt' }} leftTitle="work › a.txt" rightTitle="backup.zip › docs/b.txt" {...props} />
    </I18nProvider>,
  )
  return { readFile, view }
}
const lines = (n: number, change?: [number, string]) => Array.from({ length: n }, (_, i) => (change && change[0] === i ? change[1] : `line ${i}`)).join('\n')
/** The text of what the editors draw (CodeMirror draws the lines in view). */
const drawn = () => [...document.querySelectorAll('.cm-editor')].map((e) => e.querySelector('.cm-content')?.textContent ?? '')

beforeEach(() => {
  localStorage.clear()
  diffLayout.reload()
  diffCollapse.reload()
})
afterEach(() => {
  cleanup()
  delete window.fb
})

describe('DiffView', () => {
  it('reads both files, shows them side by side with the changes counted, and says where each one is', async () => {
    const { readFile } = show({ 'r1:a.txt': enc('one\ntwo\nthree\n'), 'r2:docs/b.txt': enc('one\n2\nthree\nfour\n') })
    await waitFor(() => expect(document.querySelectorAll('.cm-editor')).toHaveLength(2))
    expect(readFile).toHaveBeenCalledWith('r1', 'a.txt')
    expect(readFile).toHaveBeenCalledWith('r2', 'docs/b.txt')
    expect(screen.getByText('2 changes')).toBeTruthy()
    expect(screen.getByText('work › a.txt')).toBeTruthy()
    expect(screen.getByText('backup.zip › docs/b.txt')).toBeTruthy()
    expect(document.querySelector('.cm-merge-a')?.textContent).toContain('two')
    expect(document.querySelector('.cm-merge-b')?.textContent).toContain('four')
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Comparison of work › a.txt and backup.zip › docs/b.txt')
    // Both sides are read-only.
    for (const content of document.querySelectorAll('.cm-content')) expect(content.getAttribute('contenteditable')).toBe('false')
  })
  it('says one change in the singular, and that two texts that are the same are the same (and shows them whole, nothing folded)', async () => {
    show({ 'r1:a.txt': enc('a\nb\n'), 'r2:docs/b.txt': enc('a\nc\n') })
    await screen.findByText('1 change')
    cleanup()
    show({ 'r1:a.txt': enc(lines(40)), 'r2:docs/b.txt': enc(lines(40)) })
    await screen.findByText('The two files have the same text')
    expect(document.querySelector('.cm-collapsedLines')).toBeNull()
    expect(screen.getByRole('button', { name: /Next Change/ }).hasAttribute('disabled')).toBe(true)
  })
  it('does not count a different line ending as a difference, and says that the endings differ', async () => {
    show({ 'r1:a.txt': enc('one\r\ntwo\r\n'), 'r2:docs/b.txt': enc('one\ntwo\n') })
    await screen.findByText('The two files have the same text')
    expect(screen.getByText('Line endings differ (CRLF and LF); they are not compared')).toBeTruthy()
  })
  it('folds the long stretches that are the same, and the toolbar unfolds them (the choice is kept)', async () => {
    show({ 'r1:a.txt': enc(lines(60)), 'r2:docs/b.txt': enc(lines(60, [30, 'changed'])) })
    await waitFor(() => expect(document.querySelector('.cm-collapsedLines')).not.toBeNull())
    const toggle = screen.getByRole('button', { name: 'Fold the long stretches of lines that are the same' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(document.querySelector('.cm-collapsedLines')).toBeNull())
    expect(diffCollapse.get()).toBe(false)
    expect(localStorage.getItem('fb:diffCollapse')).toBe('false')
  })
  it('shows one column with the removed lines above the added ones, and keeps the choice', async () => {
    show({ 'r1:a.txt': enc('one\ntwo\n'), 'r2:docs/b.txt': enc('one\n2\n') })
    await screen.findByText('1 change')
    fireEvent.click(screen.getByRole('button', { name: 'Show the two files in one column, the removed lines above the added ones' }))
    await waitFor(() => expect(document.querySelectorAll('.cm-editor')).toHaveLength(1))
    expect(document.querySelector('.cm-deletedChunk')?.textContent).toContain('two')
    expect(document.querySelector('.cm-content')?.textContent).toContain('2')
    expect(screen.getByText('1 change')).toBeTruthy()
    expect(diffLayout.get()).toBe('inline')
    fireEvent.click(screen.getByRole('button', { name: 'Show the two files next to each other' }))
    await waitFor(() => expect(document.querySelectorAll('.cm-editor')).toHaveLength(2))
  })
  it('swaps the sides: what was removed is added, and the titles change places', async () => {
    show({ 'r1:a.txt': enc('one\ntwo\n'), 'r2:docs/b.txt': enc('one\n2\n') })
    await waitFor(() => expect(document.querySelectorAll('.cm-editor')).toHaveLength(2))
    expect(drawn()[0]).toContain('two')
    fireEvent.click(screen.getByRole('button', { name: 'Swap Sides' }))
    await waitFor(() => expect(drawn()[0]).toContain('2'))
    expect(drawn()[0]).not.toContain('two')
    const titles = [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title'))
    expect(titles.indexOf('backup.zip › docs/b.txt')).toBeLessThan(titles.indexOf('work › a.txt'))
  })
  it('goes to the next change with F7 and the button (and does nothing when there is none)', async () => {
    show({ 'r1:a.txt': enc(lines(80, [5, 'x'])), 'r2:docs/b.txt': enc(lines(80, [60, 'y'])) })
    await screen.findByText('2 changes')
    const next = screen.getByRole('button', { name: /Next Change/ })
    expect(next.hasAttribute('disabled')).toBe(false)
    expect(() => act(() => void fireEvent.keyDown(window, { key: 'F7' }))).not.toThrow()
    expect(() => act(() => void fireEvent.click(next))).not.toThrow()
  })
  it('says why a file cannot be compared, with its name, and shows no editor', async () => {
    const cases: [Files, RegExp][] = [
      [{ 'r1:a.txt': enc('ok'), 'r2:docs/b.txt': new Uint8Array([1, 0, 2]) }, /b\.txt is not a text file/],
      [{ 'r1:a.txt': new Uint8Array([0x68, 0xe9]), 'r2:docs/b.txt': enc('ok') }, /a\.txt is not UTF-8 text/],
      [{ 'r1:a.txt': enc('ok'), 'r2:docs/b.txt': { error: 'too-large' } }, /b\.txt is too large to compare/],
      [{ 'r1:a.txt': { error: 'no-file' }, 'r2:docs/b.txt': enc('ok') }, /a\.txt cannot be read: it is not there any more/],
      [{ 'r1:a.txt': enc('ok'), 'r2:docs/b.txt': { error: 'no-snapshot' } }, /b\.txt cannot be read: its folder is not open any more/],
    ]
    for (const [files, message] of cases) {
      show(files)
      expect((await screen.findByRole('alert')).textContent).toMatch(message)
      expect(document.querySelector('.cm-editor')).toBeNull()
      cleanup()
    }
  })
  it('draws at the zoom of the tab, and reads the files again when the sides are others', async () => {
    const { view, readFile } = show({ 'r1:a.txt': enc('a'), 'r2:docs/b.txt': enc('b'), 'r1:c.txt': enc('c') }, { zoom: 1.5 })
    await waitFor(() => expect(document.querySelectorAll('.cm-editor')).toHaveLength(2))
    expect(document.querySelector('.cm-editor')?.closest('div[style]')?.getAttribute('style')).toContain('--wsnp-zoom: 1.5')
    view.rerender(
      <I18nProvider language="en">
        <DiffView left={{ rootId: 'r1', path: 'c.txt' }} right={{ rootId: 'r2', path: 'docs/b.txt' }} leftTitle="work › c.txt" rightTitle="backup.zip › docs/b.txt" zoom={1.5} />
      </I18nProvider>,
    )
    await waitFor(() => expect(drawn()[0]).toContain('c'))
    expect(readFile).toHaveBeenCalledWith('r1', 'c.txt')
  })
})
