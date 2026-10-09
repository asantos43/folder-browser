// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view'
import type { FbApi } from '@core/api.ts'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { fileLanguage } from '@/state/fileLanguage.ts'
import { draftOf } from '@/state/buffers.ts'
import { editorBuffers, hasChanges } from '@/state/editors.ts'
import { newUntitledBuffer } from '@/state/untitled.ts'
import { wordWrap } from '@/state/setting.ts'
import { UntitledView } from './UntitledView.tsx'

beforeEach(() => {
  localStorage.clear()
  wordWrap.reload()
  editorBuffers.clear()
  fileLanguage.clear()
  window.fb = { copyText: vi.fn() } as unknown as FbApi
})
afterEach(() => {
  cleanup()
  delete window.fb
})

const show = (key = 'u:1') => {
  const handlers = { onSave: vi.fn(), onChanged: vi.fn() }
  const element = (
    <I18nProvider language="en">
      <UntitledView tabKey={key} {...handlers} />
    </I18nProvider>
  )
  return { handlers, element, ...render(element) }
}
const editor = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
const type = (text: string) => act(() => void editor().dispatch({ changes: { from: editor().state.doc.length, insert: text } }))

describe('UntitledView', () => {
  it('opens empty, with no changes, and keeps its text in a buffer of the tab (nowhere else)', () => {
    show()
    expect(editor().state.doc.toString()).toBe('')
    const buffer = editorBuffers.get('u:1')!
    expect(hasChanges(buffer)).toBe(false)
    expect(screen.queryByText(/modified/i)).toBeNull()
  })

  it('says it has changes as soon as it has text, and none when the text is gone', () => {
    const { handlers } = show()
    type('pasted text')
    expect(handlers.onChanged).toHaveBeenLastCalledWith('u:1', true)
    expect(screen.getByText(/modified/i)).toBeTruthy()
    expect(screen.getByText('1 lines')).toBeTruthy()
    act(() => void editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: '' } }))
    expect(handlers.onChanged).toHaveBeenLastCalledWith('u:1', false)
  })

  it('keeps its text when it is shown again (another tab came to the front in between)', () => {
    const first = show()
    type('one\ntwo')
    first.unmount()
    show()
    expect(editor().state.doc.toString()).toBe('one\ntwo')
    expect(screen.getByText('2 lines')).toBeTruthy()
  })

  it('has Save As in the toolbar, which the workbench answers', () => {
    const { handlers } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(handlers.onSave).toHaveBeenCalledOnce()
  })

  it('wraps long lines when Word Wrap is on', () => {
    show()
    const toggle = screen.getByRole('button', { name: /Wrap long lines/ })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(wordWrap.get()).toBe(true)
    expect(document.querySelector('.cm-lineWrapping')).not.toBeNull()
  })

  it('two new texts do not share a buffer', () => {
    show('u:1')
    type('first')
    cleanup()
    show('u:2')
    expect(editor().state.doc.toString()).toBe('')
    expect(editorBuffers.get('u:1')!.state.doc.toString()).toBe('first')
  })

  it('shows the text that came back from the last session as changes that are not saved', () => {
    newUntitledBuffer('u:3', false, 'kept\ntext')
    const { handlers } = show('u:3')
    expect(editor().state.doc.toString()).toBe('kept\ntext')
    expect(hasChanges(editorBuffers.get('u:3')!)).toBe(true)
    expect(handlers.onChanged).toHaveBeenCalledWith('u:3', true)
    expect(screen.getByText(/modified/i)).toBeTruthy()
  })

  describe('the language of the text', () => {
    const PAGE = '<!doctype html><html><head><title>t</title></head><body><p>hello world</p></body></html>'
    const paste = (text: string) => act(() => void editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: text }, userEvent: 'input.paste' }))
    beforeEach(() => void vi.useFakeTimers())
    afterEach(() => void vi.useRealTimers())

    it('says nothing of a language while the text is plain, and detects it a moment after a paste (not at once, not at a key)', () => {
      show()
      expect(screen.getByText('Plain Text')).toBeTruthy()
      paste(PAGE)
      act(() => void vi.advanceTimersByTime(299))
      expect(screen.queryByText('HTML (detected)')).toBeNull()
      act(() => void vi.advanceTimersByTime(2))
      expect(screen.getByText('HTML (detected)')).toBeTruthy()
      expect(editorBuffers.get('u:1')!.lang).toEqual({ language: 'html', detected: true, manual: false })
    })

    it('looks once for several changes in a row, and not at all for a few characters', () => {
      show()
      type('ab')
      act(() => void vi.advanceTimersByTime(1000))
      expect(screen.getByText('Plain Text')).toBeTruthy()
      paste(PAGE)
      act(() => void vi.advanceTimersByTime(200))
      paste(`${PAGE}\n`)
      act(() => void vi.advanceTimersByTime(200))
      expect(screen.queryByText('HTML (detected)')).toBeNull()
      act(() => void vi.advanceTimersByTime(150))
      expect(screen.getByText('HTML (detected)')).toBeTruthy()
    })

    it('goes back to plain text when the text stops convincing', () => {
      show()
      paste(PAGE)
      act(() => void vi.advanceTimersByTime(400))
      paste('just some words, nothing else in here at all')
      act(() => void vi.advanceTimersByTime(400))
      expect(screen.getByText('Plain Text')).toBeTruthy()
      expect(editorBuffers.get('u:1')!.lang).toEqual({ language: 'plain', detected: false, manual: false })
    })

    it('a language chosen by hand loses "(detected)" and is not changed by a new paste', () => {
      show()
      paste(PAGE)
      act(() => void vi.advanceTimersByTime(400))
      act(() => fileLanguage.set('u:1', 'python'))
      expect(screen.getByText('Python')).toBeTruthy()
      expect(screen.queryByText(/detected/)).toBeNull()
      paste(PAGE)
      act(() => void vi.advanceTimersByTime(400))
      expect(screen.getByText('Python')).toBeTruthy()
      expect(editorBuffers.get('u:1')!.lang).toEqual({ language: 'python', detected: false, manual: true })
      // Plain Text chosen by hand is a choice too.
      act(() => fileLanguage.set('u:1', 'plain'))
      paste(PAGE)
      act(() => void vi.advanceTimersByTime(400))
      expect(screen.getByText('Plain Text')).toBeTruthy()
      // Auto Detect gives the choice back to the text.
      act(() => fileLanguage.set('u:1', undefined))
      expect(screen.getByText('HTML (detected)')).toBeTruthy()
    })

    it('offers Format Document for the language it found, and lays the text out', async () => {
      show()
      expect(screen.queryByRole('button', { name: /Lay the text out/ })).toBeNull()
      paste('<!doctype html><html><head><title>t</title></head><body><p>hello</p></body></html>')
      act(() => void vi.advanceTimersByTime(400))
      vi.useRealTimers()
      fireEvent.click(screen.getByRole('button', { name: /Lay the text out/ }))
      await vi.waitFor(() => expect(editor().state.doc.lines).toBeGreaterThan(3))
    })

    it('keeps the language in the draft, and a restored one comes back (a chosen one is not changed by the text)', () => {
      newUntitledBuffer('u:4', false, PAGE, { language: 'python', detected: false, manual: true })
      show('u:4')
      expect(screen.getByText('Python')).toBeTruthy()
      expect(draftOf('u:4')).toMatchObject({ kind: 'text', language: 'python', manual: true })
      paste(`${PAGE} `)
      act(() => void vi.advanceTimersByTime(400))
      expect(screen.getByText('Python')).toBeTruthy()
      cleanup()
      newUntitledBuffer('u:5', false, PAGE, { language: 'html', detected: true, manual: false })
      show('u:5')
      expect(screen.getByText('HTML (detected)')).toBeTruthy()
      expect(draftOf('u:5')).toMatchObject({ language: 'html', manual: false })
    })
  })
})
