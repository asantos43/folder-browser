// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view'
import type { FbApi } from '@core/api.ts'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { editorBuffers, hasChanges } from '@/state/editors.ts'
import { wordWrap } from '@/state/setting.ts'
import { UntitledView } from './UntitledView.tsx'

beforeEach(() => {
  localStorage.clear()
  wordWrap.reload()
  editorBuffers.clear()
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
})
