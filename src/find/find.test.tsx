// @vitest-environment happy-dom
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { readOnlyExtensions } from '@/views/codeTheme.ts'
import { createCodeFindTarget } from './code.ts'
import { createDomFindTarget, rangeOf, textNodes } from './dom.ts'
import { FindBar } from './FindBar.tsx'
import { createFrameFindTarget } from './frame.ts'
import { createPdfFindTarget } from './pdf.ts'
import { indexesOf, NONE, wrap, type FindTarget } from './types.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const CASE = { caseSensitive: true }
const ANY = { caseSensitive: false }

describe('indexesOf', () => {
  it('finds every match once, not overlapping, with or without the case', () => {
    expect(indexesOf('aaaa', 'aa', true)).toEqual([0, 2])
    expect(indexesOf('Meadow meadow MEADOW', 'meadow', false)).toEqual([0, 7, 14])
    expect(indexesOf('Meadow meadow MEADOW', 'meadow', true)).toEqual([7])
    expect(indexesOf('abc', '', true)).toEqual([])
    expect(indexesOf('a'.repeat(50), 'a', true, 10)).toHaveLength(10)
  })
  it('wraps an index both ways', () => {
    expect([wrap(3, 3), wrap(-1, 3), wrap(1, 3)]).toEqual([0, 2, 1])
  })
})

describe('the text of a view drawn as HTML', () => {
  const mount = () => {
    document.body.innerHTML = `<div id="area"><h2>Meadow notes</h2><p>The <b>mea</b>dow is open. <span hidden>meadow hidden</span></p><div role="toolbar">meadow toolbar</div><div data-find-skip>meadow skipped</div><ul><li>MEADOW master</li></ul><script>var meadow</script></div>`
    return document.getElementById('area') as HTMLElement
  }

  it('reads only the text that is shown: not hidden, scripts, toolbars or the find bar itself', () => {
    const area = mount()
    expect(textNodes(area).map((n) => n.nodeValue)).toEqual(['Meadow notes', 'The ', 'mea', 'dow is open. ', 'MEADOW master'])
  })

  it('makes a range over text that is split between elements', () => {
    const area = mount()
    const nodes = textNodes(area)
    const text = nodes.map((n) => n.nodeValue).join('')
    const at = text.indexOf('meadow')
    expect(rangeOf(nodes, at, at + 6)?.toString()).toBe('meadow')
  })

  it('counts the matches, goes to the next and the previous with a wrap, and follows the case', () => {
    const target = createDomFindTarget(() => mount())
    expect(target.search('meadow', ANY)).toEqual({ count: 3, index: 1 })
    expect(target.step(1)).toEqual({ count: 3, index: 2 })
    expect(target.step(1)).toEqual({ count: 3, index: 3 })
    expect(target.step(1)).toEqual({ count: 3, index: 1 })
    expect(target.step(-1)).toEqual({ count: 3, index: 3 })
    expect(target.search('meadow', CASE)).toEqual({ count: 1, index: 1 })
    expect(target.search('nothing', ANY)).toEqual(NONE)
    expect(target.step(1)).toEqual(NONE)
    expect(target.search('', ANY)).toEqual(NONE)
    target.clear()
  })

  it('finds nothing when there is no view', () => {
    expect(createDomFindTarget(() => null).search('x', ANY)).toEqual(NONE)
  })
})

describe('the source editor', () => {
  const editor = (doc: string) => {
    const host = document.createElement('div')
    document.body.append(host)
    return new EditorView({ parent: host, state: EditorState.create({ doc, extensions: readOnlyExtensions('plain', false) }) })
  }
  const DOC = 'alpha meadow\nbeta\nmeadow again\nMEADOW last\n'

  it('counts the matches over the whole text and steps through them', () => {
    const view = editor(DOC)
    const target = createCodeFindTarget(() => view)
    expect(target.search('meadow', ANY)).toEqual({ count: 3, index: 1 })
    expect(target.step(1).index).toBe(2)
    expect(target.step(-1).index).toBe(1)
    expect(target.step(-1).index).toBe(3)
    expect(target.search('meadow', CASE)).toEqual({ count: 2, index: 1 })
    expect(target.search('zzz', ANY)).toEqual(NONE)
  })

  it('draws the matches, the current one apart, and lets go of them', () => {
    const view = editor(DOC)
    const target = createCodeFindTarget(() => view)
    target.search('meadow', ANY)
    expect(view.dom.querySelectorAll('.cm-wsnpMatch')).toHaveLength(3)
    expect(view.dom.querySelectorAll('.cm-wsnpMatch-current')).toHaveLength(1)
    target.step(1)
    expect(view.dom.querySelector('.cm-wsnpMatch-current')?.textContent).toBe('meadow')
    expect(view.dom.querySelectorAll('.cm-wsnpMatch-current')).toHaveLength(1)
    target.clear()
    expect(view.dom.querySelectorAll('.cm-wsnpMatch')).toHaveLength(0)
  })

  it('forgets the matches when the text changes under them', () => {
    const view = editor(DOC)
    const target = createCodeFindTarget(() => view)
    target.search('meadow', ANY)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'other text' } })
    expect(view.dom.querySelectorAll('.cm-wsnpMatch')).toHaveLength(0)
  })

  it('gives the text selected in the editor, which the page cannot see when the editor draws only some lines', () => {
    const view = editor(DOC)
    const target = createCodeFindTarget(() => view)
    expect(target.selectedText?.()).toBe('')
    view.dispatch({ selection: { anchor: 6, head: 12 } })
    expect(target.selectedText?.()).toBe('meadow')
  })

  it('does nothing without an editor', () => {
    const target = createCodeFindTarget(() => null)
    expect(target.search('a', ANY)).toEqual(NONE)
    expect(target.step(1)).toEqual(NONE)
    target.clear()
  })
})

describe('the page of a snapshot', () => {
  const fake = (found = true, count = 4) => ({
    findInPage: vi.fn(async (_id: string, _q: string, _o: unknown) => ({ found, count })),
    clearFindInPage: vi.fn(async (_id: string) => {}),
  })

  it('asks the main process to search from the top, counts, and follows the steps by asking for the next match', async () => {
    const api = fake()
    const target = createFrameFindTarget(api, 'a')
    expect(await target.search('meadow', ANY)).toEqual({ count: 4, index: 1 })
    expect(api.findInPage).toHaveBeenLastCalledWith('a', 'meadow', { caseSensitive: false, backwards: false, reset: true, count: true })
    expect(await target.step(1)).toEqual({ count: 4, index: 2 })
    expect(api.findInPage).toHaveBeenLastCalledWith('a', 'meadow', { caseSensitive: false, backwards: false, reset: false, count: false })
    expect(await target.step(-1)).toEqual({ count: 4, index: 1 })
    expect(api.findInPage).toHaveBeenLastCalledWith('a', 'meadow', { caseSensitive: false, backwards: true, reset: false, count: false })
    expect(await target.step(-1)).toEqual({ count: 4, index: 4 })
  })

  it('says there is nothing when the page has no match, and clears the page when the text is emptied or the bar closes', async () => {
    const api = fake(false, 0)
    const target = createFrameFindTarget(api, 'a')
    expect(await target.search('nope', ANY)).toEqual(NONE)
    expect(await target.step(1)).toEqual(NONE)
    expect(await target.search('', ANY)).toEqual(NONE)
    expect(api.clearFindInPage).toHaveBeenCalledWith('a')
    target.clear()
    expect(api.clearFindInPage).toHaveBeenCalledTimes(2)
  })
})

describe('a PDF', () => {
  const PAGES = ['Meadow report. Page one. The meadow is open.', 'Nothing here', 'MEADOW last page']
  const doc = { numPages: 3, getPage: async (n: number) => ({ getTextContent: async () => ({ items: [{ str: PAGES[n - 1].slice(0, 6) }, { str: PAGES[n - 1].slice(6) }] }) }) } as unknown as PDFDocumentProxy

  /** A scroller with the text layers pdf.js would have drawn. */
  const scroller = () => {
    const el = document.createElement('div')
    el.innerHTML = PAGES.map((text, i) => `<div data-page="${i + 1}"><div class="textLayer"><span>${text.slice(0, 6)}</span><span>${text.slice(6)}</span></div></div>`).join('')
    document.body.append(el)
    return el
  }

  it('counts the matches over every page, and goes to the page of each', async () => {
    const goTo = vi.fn()
    const el = scroller()
    const target = createPdfFindTarget(doc, () => el, goTo, () => 1)
    expect(await target.search('meadow', ANY)).toEqual({ count: 3, index: 1 })
    expect(goTo).toHaveBeenLastCalledWith(1)
    expect(await target.step(1)).toEqual({ count: 3, index: 2 })
    expect(goTo).toHaveBeenLastCalledWith(1)
    expect(await target.step(1)).toEqual({ count: 3, index: 3 })
    expect(goTo).toHaveBeenLastCalledWith(3)
    expect(await target.step(1)).toEqual({ count: 3, index: 1 })
    expect(await target.search('meadow', CASE)).toEqual({ count: 1, index: 1 })
    expect(await target.search('absent', ANY)).toEqual(NONE)
    target.clear()
  })

  it('starts at the page being read', async () => {
    const goTo = vi.fn()
    const target = createPdfFindTarget(doc, () => scroller(), goTo, () => 2)
    expect(await target.search('meadow', ANY)).toEqual({ count: 3, index: 3 })
    expect(goTo).toHaveBeenLastCalledWith(3)
  })
})

describe('FindBar', () => {
  const fakeTarget = (states: { search?: { count: number; index: number }; step?: { count: number; index: number } } = {}) => {
    const target = {
      search: vi.fn((_q: string, _o: { caseSensitive: boolean }) => states.search ?? { count: 3, index: 1 }),
      step: vi.fn((_d: 1 | -1) => states.step ?? { count: 3, index: 2 }),
      clear: vi.fn(),
    } satisfies FindTarget
    return target
  }
  const show = (target: FindTarget | null, onClose = vi.fn()) => {
    const getTarget = () => target
    const view = render(<I18nProvider language="en"><FindBar getTarget={getTarget} focusToken={1} onClose={onClose} /></I18nProvider>)
    return { onClose, ...view }
  }
  const type = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Find' }), { target: { value: text } })

  it('has the cursor in the box, searches a moment after typing, and says which match of how many', async () => {
    const target = fakeTarget()
    show(target)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Find' }))
    type('meadow')
    await waitFor(() => expect(target.search).toHaveBeenCalledWith('meadow', { caseSensitive: false }))
    expect(await screen.findByText('1 of 3')).toBeTruthy()
  })

  it('steps with Enter and Shift+Enter and with the buttons', async () => {
    const target = fakeTarget()
    show(target)
    type('meadow')
    await screen.findByText('1 of 3')
    const box = screen.getByRole('textbox', { name: 'Find' })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(target.step).toHaveBeenLastCalledWith(1))
    expect(await screen.findByText('2 of 3')).toBeTruthy()
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    await waitFor(() => expect(target.step).toHaveBeenLastCalledWith(-1))
    fireEvent.click(screen.getByRole('button', { name: 'Next Match' }))
    await waitFor(() => expect(target.step).toHaveBeenCalledTimes(3))
    fireEvent.click(screen.getByRole('button', { name: 'Previous Match' }))
    await waitFor(() => expect(target.step).toHaveBeenCalledTimes(4))
  })

  it('searches again with the case when Match Case is switched', async () => {
    const target = fakeTarget()
    show(target)
    type('Meadow')
    await waitFor(() => expect(target.search).toHaveBeenCalledWith('Meadow', { caseSensitive: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Match Case' }))
    await waitFor(() => expect(target.search).toHaveBeenLastCalledWith('Meadow', { caseSensitive: true }))
    expect(screen.getByRole('button', { name: 'Match Case' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says there are no results, and keeps the step buttons off', async () => {
    const target = fakeTarget({ search: { count: 0, index: 0 } })
    show(target)
    type('zzz')
    expect(await screen.findByText('No results')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next Match' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes with Escape and with its button, and lets go of the marks in the view', async () => {
    const target = fakeTarget()
    const { onClose, unmount } = show(target)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
    expect(target.clear).toHaveBeenCalled()
  })

  it('does not show the answer of a search that a newer one overtook', async () => {
    const slow = { resolve: (_s: { count: number; index: number }) => {} }
    const target: FindTarget = {
      search: vi.fn((q: string) => (q === 'slow' ? new Promise<{ count: number; index: number }>((resolve) => void (slow.resolve = resolve)) : { count: 9, index: 1 })),
      step: vi.fn(() => NONE),
      clear: vi.fn(),
    }
    show(target)
    type('slow')
    await waitFor(() => expect(target.search).toHaveBeenCalledWith('slow', expect.anything()))
    type('fast')
    expect(await screen.findByText('1 of 9')).toBeTruthy()
    await act(async () => slow.resolve({ count: 1, index: 1 }))
    expect(screen.getByText('1 of 9')).toBeTruthy()
  })

  it('works without a target (nothing to search)', async () => {
    show(null)
    type('x')
    expect(await screen.findByText('No results')).toBeTruthy()
  })
})
