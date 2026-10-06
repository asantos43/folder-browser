// @vitest-environment happy-dom
import type { Draft, EditOpen, FbApi } from '@core/api.ts'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { editorBuffers } from '@/state/editors.ts'
import { tableOptions } from '@/state/tableState.ts'
import { TableEditView } from './TableEditView.tsx'

beforeEach(() => {
  localStorage.clear()
  editorBuffers.clear()
  tableOptions.clear()
})
afterEach(() => {
  cleanup()
  delete window.fb
})

const OK = (text: string, extra: Partial<Extract<EditOpen, { ok: true }>> = {}): EditOpen => ({ ok: true, text, version: { mtimeMs: 1, size: text.length }, eol: 'lf', bom: false, ...extra })
function setup(open: EditOpen, props: { draft?: Draft | null; tabKey?: string } = {}) {
  const drafts = { get: vi.fn(async () => props.draft ?? null), delete: vi.fn(async () => {}) }
  window.fb = { edit: { open: vi.fn(async () => open) }, drafts, copyText: vi.fn() } as unknown as FbApi
  const handlers = { onSave: vi.fn(), onSaveAs: vi.fn(), onChanged: vi.fn(), onRestored: vi.fn() }
  const element = (
    <I18nProvider language="en">
      <TableEditView tabKey={props.tabKey ?? 'f:r1:b.csv'} rootId="r1" path="b.csv" name="b.csv" tab={false} tableKey="k" language="plain" fallback={() => <p>fallback</p>} {...handlers} />
    </I18nProvider>
  )
  return { drafts, handlers, element, ...render(element) }
}
const cells = () => screen.getAllByRole('row').slice(1).map((row) => Array.from(row.querySelectorAll('td'), (c) => c.textContent))
const edit = (name: string, value: string) => {
  fireEvent.doubleClick(screen.getByRole('cell', { name }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
}

describe('TableEditView', () => {
  it('shows the file as a table, with Save off until a cell changes', async () => {
    const { handlers } = setup(OK('Boat,Seats\r\nGull,12\n'.replaceAll('\r\n', '\n')))
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Gull' })).toBeTruthy())
    expect((screen.getByRole('button', { name: /Save the file/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(handlers.onChanged).toHaveBeenLastCalledWith('f:r1:b.csv', false)
  })
  it('a cell edited is a change of the editor\'s text: the tab is marked, the buffer holds the new text, nothing else is touched', async () => {
    const { handlers } = setup(OK('Boat,"Seats, n"\nGull,12\n\nHeron,8\n'))
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Gull' })).toBeTruthy())
    edit('12', '14')
    await waitFor(() => expect(screen.getByText('● Modified')).toBeTruthy())
    expect(handlers.onChanged).toHaveBeenLastCalledWith('f:r1:b.csv', true)
    expect(editorBuffers.get('f:r1:b.csv')!.state.doc.toString()).toBe('Boat,"Seats, n"\nGull,14\n\nHeron,8\n')
    expect(cells()[0]).toEqual(['Gull', '14'])
  })
  it('undo takes back what one action did, in one step, also a column of many rows; redo does it again', async () => {
    const { handlers } = setup(OK('a,b\n1,2\n3,4\n'))
    await waitFor(() => expect(screen.getByRole('cell', { name: '1' })).toBeTruthy())
    fireEvent.mouseDown(screen.getByRole('cell', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: /Delete the selected column/ }))
    expect(editorBuffers.get('f:r1:b.csv')!.state.doc.toString()).toBe('b\n2\n4\n')
    edit('2', '9')
    expect(editorBuffers.get('f:r1:b.csv')!.state.doc.toString()).toBe('b\n9\n4\n')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(editorBuffers.get('f:r1:b.csv')!.state.doc.toString()).toBe('b\n2\n4\n')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(editorBuffers.get('f:r1:b.csv')!.state.doc.toString()).toBe('a,b\n1,2\n3,4\n')
    await waitFor(() => expect(screen.queryByText('● Modified')).toBeNull())
    expect(handlers.onChanged).toHaveBeenLastCalledWith('f:r1:b.csv', false)
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(editorBuffers.get('f:r1:b.csv')!.state.doc.toString()).toBe('b\n2\n4\n')
  })
  it('adds a row at the end and the table shows it', async () => {
    setup(OK('a,b\n1,2\n'))
    await waitFor(() => expect(screen.getByRole('cell', { name: '1' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Add an empty row/ }))
    expect(editorBuffers.get('f:r1:b.csv')!.state.doc.toString()).toBe('a,b\n1,2\n,\n')
    expect(cells()).toHaveLength(2)
  })
  it('Save and Save As go to the workbench, with the text and the line ending of the buffer', async () => {
    const { handlers } = setup(OK('a,b\n1,2\n', { eol: 'crlf', bom: true }))
    await waitFor(() => expect(screen.getByRole('cell', { name: '1' })).toBeTruthy())
    edit('1', '5')
    fireEvent.click(screen.getByRole('button', { name: /Save the file/ }))
    expect(handlers.onSave).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(handlers.onSaveAs).toHaveBeenCalledWith('a,b\n5,2\n', { eol: 'crlf', bom: true })
  })
  it('keeps the changes of a tab that is left and shown again, and is the same text the editor would show', async () => {
    const { unmount, element } = setup(OK('a,b\n1,2\n'))
    await waitFor(() => expect(screen.getByRole('cell', { name: '1' })).toBeTruthy())
    edit('1', '7')
    unmount()
    render(element)
    await waitFor(() => expect(screen.getByRole('cell', { name: '7' })).toBeTruthy())
    expect(screen.getByText('● Modified')).toBeTruthy()
  })
  it('opens the changes that were kept for the next start, marked as modified, and says so', async () => {
    const draft: Draft = { version: 1, kind: 'text', text: 'a,b\n1,99\n', base: { mtimeMs: 1, size: 8 }, eol: 'lf', bom: false, rootPath: '/r', path: 'b.csv', at: '2026-10-06T00:00:00Z' }
    const { handlers } = setup(OK('a,b\n1,2\n'), { draft })
    await waitFor(() => expect(screen.getByRole('cell', { name: '99' })).toBeTruthy())
    expect(screen.getByText('● Modified')).toBeTruthy()
    expect(handlers.onRestored).toHaveBeenCalledWith('b.csv')
  })
  it('hands a file that cannot be edited to the fallback', async () => {
    setup({ ok: false, error: 'too-large' } as EditOpen)
    await waitFor(() => expect(screen.getByText('fallback')).toBeTruthy())
  })
  it('leaves a table as it is when the buffer says the file was saved (the dot goes)', async () => {
    const { rerender } = setup(OK('a,b\n1,2\n'))
    await waitFor(() => expect(screen.getByRole('cell', { name: '1' })).toBeTruthy())
    edit('1', '3')
    const buffer = editorBuffers.get('f:r1:b.csv')!
    await act(async () => void (buffer.saved = buffer.state.doc))
    rerender(
      <I18nProvider language="en">
        <TableEditView tabKey="f:r1:b.csv" rootId="r1" path="b.csv" name="b.csv" tab={false} tableKey="k" language="plain" dirty={false} fallback={() => null} onSave={() => {}} onSaveAs={() => {}} onChanged={() => {}} />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.queryByText('● Modified')).toBeNull())
  })
})
