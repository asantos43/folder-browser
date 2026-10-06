// @vitest-environment happy-dom
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import type { Draft, EditOpen, FbApi } from '@core/api.ts'
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
function setup(open: EditOpen | (() => Promise<EditOpen>), props: { language?: 'plain' | 'json'; tabKey?: string; draft?: Draft | null } = {}) {
  const openFn = vi.fn(typeof open === 'function' ? open : async () => open)
  const drafts = { get: vi.fn(async () => props.draft ?? null), delete: vi.fn(async () => {}) }
  window.fb = { edit: { open: openFn }, drafts, copyText: vi.fn() } as unknown as FbApi
  const handlers = { onSave: vi.fn(), onSaveAs: vi.fn(), onChanged: vi.fn(), onRestored: vi.fn(), onOpenWith: vi.fn(), onHex: vi.fn() }
  const element = (
    <I18nProvider language="en">
      <EditView tabKey={props.tabKey ?? 'f:r1:a.txt'} rootId="r1" path="a.txt" language={props.language ?? 'plain'} fallback={(reason) => <p>fallback {reason}</p>} {...handlers} />
    </I18nProvider>
  )
  const view = render(element)
  return { openFn, drafts, handlers, element, ...view }
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

  it('shows the changes of a draft kept by the last session, as changes not saved, with the file on disk as what is saved; the version is the one the changes began from', async () => {
    const draft: Draft = { version: 1, rootPath: '/home/me/work', path: 'a.txt', kind: 'text', text: 'my unsaved words', base: { mtimeMs: 1, size: 5 }, eol: 'crlf', bom: false, at: '2026-10-06T12:00:00.000Z' }
    const { handlers } = setup(OK('on disk', { version: { mtimeMs: 9, size: 7 } }), { draft })
    await waitFor(() => expect(content()).toContain('my unsaved words'))
    // (What follows from the text is drawn and told just after it: under load not at the same moment.)
    await waitFor(() => {
      expect(screen.getByText('● Modified')).toBeTruthy()
      expect(screen.getByText('CRLF')).toBeTruthy()
      expect(handlers.onRestored).toHaveBeenCalledWith('a.txt')
      expect(handlers.onChanged).toHaveBeenLastCalledWith('f:r1:a.txt', true)
    })
    const buffer = editorBuffers.get('f:r1:a.txt')!
    expect(buffer.saved.toString()).toBe('on disk')
    expect(buffer.version).toEqual({ mtimeMs: 1, size: 5 })
  })
  it('lets a draft go that is what the file is now (nothing is restored)', async () => {
    const draft: Draft = { version: 1, rootPath: '/r', path: 'a.txt', kind: 'text', text: 'same', base: { mtimeMs: 1, size: 4 }, eol: 'lf', bom: false, at: '2026-10-06T12:00:00.000Z' }
    const { handlers, drafts } = setup(OK('same', { version: { mtimeMs: 1, size: 4 } }), { draft })
    await waitFor(() => expect(content()).toContain('same'))
    expect(handlers.onRestored).not.toHaveBeenCalled()
    expect(drafts.delete).toHaveBeenCalledWith('r1', 'a.txt')
    expect(screen.queryByText('● Modified')).toBeNull()
  })
  it('restores the changes of a file that is not there any more, so they are not lost', async () => {
    const draft: Draft = { version: 1, rootPath: '/r', path: 'a.txt', kind: 'text', text: 'rescued', base: { mtimeMs: 1, size: 4 }, eol: 'lf', bom: false, at: '2026-10-06T12:00:00.000Z' }
    const { handlers } = setup({ ok: false, error: 'no-file' }, { draft })
    await waitFor(() => expect(content()).toContain('rescued'))
    expect(handlers.onRestored).toHaveBeenCalledOnce()
  })
  it('ignores a draft for a file that cannot be edited, and shows the file as it is', async () => {
    const draft: Draft = { version: 1, rootPath: '/r', path: 'a.txt', kind: 'text', text: 'draft', base: { mtimeMs: 1, size: 4 }, eol: 'lf', bom: false, at: '2026-10-06T12:00:00.000Z' }
    setup({ ok: false, error: 'not-utf8' }, { draft })
    await waitFor(() => expect(screen.getByText('fallback edit.refused.not-utf8')).toBeTruthy())
  })
})
