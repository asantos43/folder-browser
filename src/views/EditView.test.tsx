// @vitest-environment happy-dom
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import type { EditOpen, FbApi } from '@core/api.ts'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { editorBuffers } from '@/state/editors.ts'
import { wordWrap } from '@/state/setting.ts'
import { EditView } from './EditView.tsx'

beforeEach(() => {
  localStorage.clear()
  wordWrap.reload()
  editorBuffers.clear()
})
afterEach(() => {
  cleanup()
  delete window.fb
})

const OK = (text: string, extra: Partial<Extract<EditOpen, { ok: true }>> = {}): EditOpen => ({ ok: true, text, version: { mtimeMs: 1, size: text.length }, eol: 'lf', bom: false, ...extra })
function setup(open: EditOpen | (() => Promise<EditOpen>), props: { language?: 'plain' | 'json'; tabKey?: string } = {}) {
  const openFn = vi.fn(typeof open === 'function' ? open : async () => open)
  window.fb = { edit: { open: openFn }, copyText: vi.fn() } as unknown as FbApi
  const handlers = { onSave: vi.fn(), onSaveAs: vi.fn(), onChanged: vi.fn(), onOpenWith: vi.fn(), onHex: vi.fn() }
  const element = (
    <I18nProvider language="en">
      <EditView tabKey={props.tabKey ?? 'f:r1:a.txt'} rootId="r1" path="a.txt" language={props.language ?? 'plain'} fallback={(reason) => <p>fallback {reason}</p>} {...handlers} />
    </I18nProvider>
  )
  const view = render(element)
  return { openFn, handlers, element, ...view }
}
const editor = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
const type = (text: string) => act(() => void editor().dispatch({ changes: { from: editor().state.doc.length, insert: text } }))
const content = () => document.querySelector('.cm-content')?.textContent ?? ''

describe('EditView', () => {
  it('shows the file read by the main process, with how its lines end and its encoding, and Save is off until there are changes', async () => {
    const { openFn, handlers } = setup(OK('first\nsecond\n', { eol: 'crlf', bom: true }))
    await waitFor(() => expect(content()).toContain('first'))
    expect(openFn).toHaveBeenCalledWith('r1', 'a.txt')
    expect(screen.getByText('CRLF')).toBeTruthy()
    expect(screen.getByText('UTF-8 with BOM')).toBeTruthy()
    expect(screen.getByText('Plain Text')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Save the file/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(handlers.onChanged).toHaveBeenLastCalledWith('f:r1:a.txt', false)
  })
  it('says when the text has changes, turns Save on, and says there are none again when the changes are undone', async () => {
    const { handlers } = setup(OK('hello'))
    await waitFor(() => expect(content()).toContain('hello'))
    type(' world')
    await waitFor(() => expect(screen.getByText('● Modified')).toBeTruthy())
    expect(handlers.onChanged).toHaveBeenLastCalledWith('f:r1:a.txt', true)
    expect((screen.getByRole('button', { name: /Save the file/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Save the file/ }))
    expect(handlers.onSave).toHaveBeenCalledOnce()
    act(() => void undo(editor()))
    await waitFor(() => expect(screen.queryByText('● Modified')).toBeNull())
    expect(handlers.onChanged).toHaveBeenLastCalledWith('f:r1:a.txt', false)
  })
  it('keeps the text and the changes of a tab that is left and shown again, without asking the main process again', async () => {
    const { openFn, handlers, unmount, element } = setup(OK('keep me'))
    await waitFor(() => expect(content()).toContain('keep me'))
    type('!')
    unmount()
    render(element)
    await waitFor(() => expect(content()).toContain('keep me!'))
    expect(openFn).toHaveBeenCalledOnce()
    expect(handlers.onChanged).toHaveBeenLastCalledWith('f:r1:a.txt', true)
  })
  it('hands a file that cannot be edited to the fallback, with the reason', async () => {
    setup({ ok: false, error: 'not-utf8' })
    await waitFor(() => expect(screen.getByText('fallback edit.refused.not-utf8')).toBeTruthy())
    expect(document.querySelector('.cm-editor')).toBeNull()
  })
  it('lays a JSON file out as an edit that can be undone, and has no such button for plain text', async () => {
    setup(OK('{"a":1,"b":[1,2]}'), { language: 'json' })
    await waitFor(() => expect(content()).toContain('{"a":1'))
    fireEvent.click(screen.getByRole('button', { name: /Lay the text out/ }))
    await waitFor(() => expect(editor().state.doc.toString()).toContain('"a": 1'))
    act(() => void undo(editor()))
    expect(editor().state.doc.toString()).toBe('{"a":1,"b":[1,2]}')
    cleanup()
    setup(OK('plain'), { tabKey: 'f:r1:other.txt' })
    await waitFor(() => expect(content()).toContain('plain'))
    expect(screen.queryByRole('button', { name: /Lay the text out/ })).toBeNull()
  })
  it('gives Save As the text on screen, with the ending and the mark of the file', async () => {
    const { handlers } = setup(OK('abc', { eol: 'crlf', bom: true }))
    await waitFor(() => expect(content()).toContain('abc'))
    type('d')
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(handlers.onSaveAs).toHaveBeenCalledWith('abcd', { eol: 'crlf', bom: true })
  })
  it('has Open With… and View as hex', async () => {
    const { handlers } = setup(OK('x'))
    await waitFor(() => expect(content()).toContain('x'))
    fireEvent.click(screen.getByRole('button', { name: 'Open With…' }))
    fireEvent.click(screen.getByRole('button', { name: 'View as hex' }))
    expect(handlers.onOpenWith).toHaveBeenCalledOnce()
    expect(handlers.onHex).toHaveBeenCalledOnce()
  })
})
