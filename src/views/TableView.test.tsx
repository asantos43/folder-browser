// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileTarget } from '@/find/types.ts'
import { I18nProvider } from '@/i18n/context.tsx'
import { csvView } from '@/state/setting.ts'
import { tableOptions } from '@/state/tableState.ts'
import { TableView, type TableEditing } from './TableView.tsx'

const outcome = vi.hoisted(() => ({ next: null as unknown, asked: [] as string[], tables: [] as unknown[] }))
vi.mock('@/state/sqlSession.ts', () => ({
  createSqlWorker: () => ({}),
  SqlSession: class {
    setTable(table: unknown) {
      outcome.tables.push(table)
    }
    async query(sql: string) {
      outcome.asked.push(sql)
      return outcome.next
    }
    dispose() {}
  },
}))

beforeEach(() => {
  localStorage.clear()
  csvView.reload()
  tableOptions.clear()
  outcome.next = null
  outcome.asked = []
  outcome.tables = []
})
afterEach(() => {
  cleanup()
  delete window.fb
})

const BOATS = 'Boat,Seats\nGull,12\nHeron,8\nTern,100\n'
const show = (text: string, props: { tab?: boolean; onSave?: () => void; edit?: TableEditing; key?: string } = {}) => {
  const onSave = props.onSave ?? vi.fn()
  render(
    <I18nProvider language="en">
      <TableView text={text} name="boats.csv" tab={props.tab ?? false} tableKey={props.key ?? 'k'} onSave={onSave} edit={props.edit} />
    </I18nProvider>,
  )
  return onSave
}
const boats = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((c) => c.textContent))
const grid = () => document.querySelector('[tabindex="0"]') as HTMLElement

describe('TableView: the table', () => {
  it('draws the first row as the header and numbers the rows under it', () => {
    show('Boat,Seats\nGull,12\nHeron,8\n')
    const table = screen.getByRole('table', { name: 'Table of boats.csv' })
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(3)
    expect(screen.getByRole('columnheader', { name: 'Boat' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Gull' })).toBeTruthy()
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['2', '3'])
    expect(screen.getByText('3 rows, 2 columns')).toBeTruthy()
  })
  it('reads a semicolon file and a TSV', () => {
    show('nome;preço\nmaçã;1,5\n')
    expect(screen.getByRole('cell', { name: '1,5' })).toBeTruthy()
    cleanup()
    show('a\tb\n1\t2\n', { tab: true })
    expect(screen.getByRole('cell', { name: '2' })).toBeTruthy()
  })
  it('shows what a cell holds as text, never as markup', () => {
    show('x\n<img src=x onerror=alert(1)><b>bold</b>\n')
    expect(document.querySelector('table img')).toBeNull()
    expect(document.querySelector('table b')).toBeNull()
    expect(screen.getByRole('cell').textContent).toBe('<img src=x onerror=alert(1)><b>bold</b>')
  })
  it('draws only the rows in view, however many there are', () => {
    show(`h\n${Array.from({ length: 100_000 }, (_, i) => `row${i}`).join('\n')}\n`)
    expect(screen.getByText('100001 rows, 1 columns')).toBeTruthy()
    expect(document.querySelectorAll('tbody td[data-r]').length).toBeLessThan(200)
    expect(screen.getByRole('cell', { name: 'row0' })).toBeTruthy()
  })
  it('says when only the start of a huge file is drawn', () => {
    show(`h\n${'x\n'.repeat(500_010)}`)
    expect(screen.getByText('Only the first 500,000 rows and 500 columns are shown.')).toBeTruthy()
  })
  it('has the switch to the text, which remembers the choice, and Save As', () => {
    const onSave = show('a,b\n1,2\n')
    expect(screen.getByRole('button', { name: 'Show the file as a table' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Show the file as text' }))
    expect(csvView.get()).toBe('text')
    expect(localStorage.getItem('fb:csvView')).toBe('"text"')
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(onSave).toHaveBeenCalledOnce()
  })
  it('has View as hex and Open With…', () => {
    const onHex = vi.fn()
    const onOpenWith = vi.fn()
    render(
      <I18nProvider language="en">
        <TableView text={'a,b\n1,2\n'} name="x.csv" tab={false} onSave={() => {}} onHex={onHex} onOpenWith={onOpenWith} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View as hex' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open With…' }))
    expect(onHex).toHaveBeenCalledOnce()
    expect(onOpenWith).toHaveBeenCalledOnce()
  })
  it('has no way to change cells when it was not given one', () => {
    show(BOATS)
    fireEvent.doubleClick(screen.getByRole('cell', { name: 'Gull' }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add Row' })).toBeNull()
  })
})

describe('TableView: header, sort and filter', () => {
  it('takes the first row as data when the header is switched off, and names the columns A, B…', () => {
    show(BOATS)
    fireEvent.click(screen.getByRole('button', { name: 'The first row is the header (the names of the columns)' }))
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'B' })).toBeTruthy()
    expect(boats()[0]).toEqual(['Boat', 'Seats'])
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['1', '2', '3', '4'])
  })
  it('sorts by a column, numbers as numbers, up then down then back to the file order, and never changes the file', () => {
    show(BOATS)
    const sort = () => fireEvent.click(screen.getByRole('button', { name: 'Sort by Seats' }))
    sort()
    expect(boats().map((r) => r[0])).toEqual(['Heron', 'Gull', 'Tern'])
    expect(screen.getByRole('columnheader', { name: 'Seats' }).getAttribute('aria-sort')).toBe('ascending')
    sort()
    expect(boats().map((r) => r[0])).toEqual(['Tern', 'Gull', 'Heron'])
    expect(screen.getByRole('columnheader', { name: 'Seats' }).getAttribute('aria-sort')).toBe('descending')
    sort()
    expect(boats().map((r) => r[0])).toEqual(['Gull', 'Heron', 'Tern'])
    // The row numbers are the file's, so a sorted table says where each row is.
    sort()
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['3', '2', '4'])
  })
  it('filters by a column and a condition, says how many rows are left, and Clear Filters shows them all', () => {
    show(BOATS)
    fireEvent.click(screen.getByRole('button', { name: 'Filter Seats' }))
    const panel = screen.getByRole('dialog', { name: 'Filter Seats' })
    fireEvent.change(within(panel).getByLabelText('Condition'), { target: { value: 'gt' } })
    fireEvent.change(within(panel).getByLabelText('Value'), { target: { value: '9' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Apply' }))
    expect(boats().map((r) => r[0])).toEqual(['Gull', 'Tern'])
    expect(screen.getByText('2 of 3 rows, 2 columns')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show every row again' }))
    expect(boats()).toHaveLength(3)
  })
  it('filters by ticking values of the column', () => {
    show('Boat,Kind\nGull,sail\nHeron,motor\nTern,sail\n')
    fireEvent.click(screen.getByRole('button', { name: 'Filter Kind' }))
    const panel = screen.getByRole('dialog', { name: 'Filter Kind' })
    fireEvent.click(within(panel).getByRole('checkbox', { name: /motor/ }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Apply' }))
    expect(boats().map((r) => r[0])).toEqual(['Heron'])
  })
  it('keeps what was asked when the tab is shown again', () => {
    show(BOATS)
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Seats' }))
    cleanup()
    show(BOATS)
    expect(boats().map((r) => r[0])).toEqual(['Heron', 'Gull', 'Tern'])
  })
})

describe('TableView: search', () => {
  it('marks the cells that have the text, in the rows shown, and goes from one to the next', () => {
    show('Boat,Note\nGull,big one\nHeron,small\nTern,BIGGER\n')
    const target = fileTarget.get()!
    let state = { count: 0, index: 0 }
    act(() => void (state = target.search('big', { caseSensitive: false }) as typeof state))
    expect(state).toEqual({ count: 2, index: 1 })
    expect(document.querySelector('[data-r="0"][data-c="1"]')!.className).toContain('--wsnp-find-current')
    expect(document.querySelector('[data-r="2"][data-c="1"]')!.className).toContain('--wsnp-find-match')
    act(() => void (state = target.step(1) as typeof state))
    expect(state).toEqual({ count: 2, index: 2 })
    act(() => void (state = target.step(1) as typeof state))
    expect(state.index).toBe(1)
    act(() => void (state = target.search('big', { caseSensitive: true }) as typeof state))
    expect(state.count).toBe(1)
    act(() => target.clear())
    expect(document.querySelector('[class*="--wsnp-find"]')).toBeNull()
  })
})

describe('TableView: the query box', () => {
  it('runs the query on the table, shows the rows of the result in its place, and Show All Rows goes back', async () => {
    show(BOATS)
    fireEvent.click(screen.getByRole('button', { name: 'Ask the table a question in SQL' }))
    expect(screen.getByText('The table is called t. Its columns: Boat, Seats. rowid is the row\'s number.')).toBeTruthy()
    expect(outcome.tables.at(-1)).toMatchObject({ names: ['Boat', 'Seats'], types: ['text', 'number'] })
    outcome.next = { ok: true, result: { columns: ['n'], rows: [['2']], more: false } }
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT count(*) AS n FROM t WHERE Seats > 9' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Run' })))
    expect(outcome.asked).toEqual(['SELECT count(*) AS n FROM t WHERE Seats > 9'])
    expect(screen.getByRole('table', { name: 'Result of the query' })).toBeTruthy()
    expect(boats()).toEqual([['2']])
    expect(screen.getByText('1 rows in the result')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show All Rows' }))
    expect(boats()).toHaveLength(3)
  })
  it('says in words what went wrong', async () => {
    show(BOATS)
    fireEvent.click(screen.getByRole('button', { name: 'Ask the table a question in SQL' }))
    outcome.next = { ok: false, error: 'notSelect' }
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'DELETE FROM t' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Run' })))
    expect(screen.getByRole('alert').textContent).toContain('Only SELECT queries can be run')
    outcome.next = { ok: false, error: 'failed', message: 'no such column: x' }
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Run' })))
    expect(screen.getByRole('alert').textContent).toContain('no such column: x')
    expect(boats()).toHaveLength(3)
  })
  it('exports the result as a file of the same kind', async () => {
    const saveAs = vi.fn(async () => ({ saved: false, reason: 'cancelled' }))
    window.fb = { edit: { saveAs } } as never
    show('a;b\n1;2\n', { key: 'x' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask the table a question in SQL' }))
    outcome.next = { ok: true, result: { columns: ['a', 'note'], rows: [['1', 'x;y']], more: false } }
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Run' })))
    fireEvent.click(screen.getByRole('button', { name: 'Export Result' }))
    expect(saveAs).toHaveBeenCalledWith('boats-result.csv', 'a;note\n1;"x;y"\n', { eol: 'lf', bom: false })
  })
})

describe('TableView: editing', () => {
  const editing = (over: Partial<TableEditing> = {}): TableEditing => ({ modified: false, canUndo: false, canRedo: false, apply: vi.fn(), undo: vi.fn(), redo: vi.fn(), onSave: vi.fn(), onSaveAs: vi.fn(), ...over })
  it('edits a cell in place: double click, type, Enter makes one change at the cell, and moves down', () => {
    const edit = editing()
    show(BOATS, { edit })
    fireEvent.doubleClick(screen.getByRole('cell', { name: 'Gull' }))
    const box = screen.getByRole('textbox', { name: 'Edit cell' }) as HTMLTextAreaElement
    expect(box.value).toBe('Gull')
    fireEvent.change(box, { target: { value: 'Gull, grey' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(edit.apply).toHaveBeenCalledWith([{ from: 11, to: 15, insert: '"Gull, grey"' }])
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.querySelector('[data-r="1"][data-c="0"]')!.className).toContain('outline-focus')
  })
  it('does nothing when the text is the same, or when Esc gives up', () => {
    const edit = editing()
    show(BOATS, { edit })
    fireEvent.doubleClick(screen.getByRole('cell', { name: 'Gull' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    fireEvent.doubleClick(screen.getByRole('cell', { name: 'Heron' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'changed' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(edit.apply).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
  it('starts with F2 or by typing, and Tab keeps the cell and goes to the next', () => {
    const edit = editing()
    show(BOATS, { edit })
    fireEvent.mouseDown(screen.getByRole('cell', { name: 'Heron' }))
    fireEvent.keyDown(grid(), { key: 'x' })
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(box.value).toBe('x')
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(edit.apply).toHaveBeenCalledWith([{ from: 19, to: 24, insert: 'x' }])
    expect(document.querySelector('[data-r="1"][data-c="1"]')!.className).toContain('outline-focus')
    fireEvent.keyDown(grid(), { key: 'F2' })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('8')
  })
  it('does not keep a cell twice when Enter is followed by the box losing the focus', () => {
    const edit = editing()
    show(BOATS, { edit })
    fireEvent.doubleClick(screen.getByRole('cell', { name: 'Tern' }))
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'Auk' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.blur(box)
    expect(edit.apply).toHaveBeenCalledOnce()
  })
  it('edits the header, and clears a cell with Delete', () => {
    const edit = editing()
    show(BOATS, { edit })
    fireEvent.doubleClick(screen.getByRole('columnheader', { name: 'Seats' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Berths' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(edit.apply).toHaveBeenLastCalledWith([{ from: 5, to: 10, insert: 'Berths' }])
    fireEvent.mouseDown(screen.getByRole('cell', { name: 'Gull' }))
    fireEvent.keyDown(grid(), { key: 'Delete' })
    expect(edit.apply).toHaveBeenLastCalledWith([{ from: 11, to: 15, insert: '' }])
  })
  it('edits the cells of the row shown, also when the table is sorted', () => {
    const edit = editing()
    show(BOATS, { edit })
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Seats' }))
    fireEvent.doubleClick(screen.getByRole('cell', { name: 'Heron' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Egret' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(edit.apply).toHaveBeenCalledWith([{ from: 19, to: 24, insert: 'Egret' }])
  })
  it('adds a row below the selected one and deletes it, adds and deletes a column, each as one change', () => {
    const edit = editing()
    show(BOATS, { edit })
    fireEvent.mouseDown(screen.getByRole('cell', { name: 'Gull' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add an empty row below the selected one (or at the end)' }))
    expect(edit.apply).toHaveBeenLastCalledWith([{ from: 19, insert: ',\n' }])
    fireEvent.click(screen.getByRole('button', { name: 'Delete the selected row' }))
    expect(edit.apply).toHaveBeenLastCalledWith([{ from: 11, to: 19 }])
    fireEvent.click(screen.getByRole('button', { name: 'Add an empty column after the selected one (or at the end)' }))
    expect(edit.apply).toHaveBeenLastCalledWith([{ from: 5, insert: ',' }, { from: 16, insert: ',' }, { from: 25, insert: ',' }, { from: 32, insert: ',' }])
    fireEvent.click(screen.getByRole('button', { name: 'Delete the selected column' }))
    expect(edit.apply).toHaveBeenLastCalledWith([{ from: 0, to: 5 }, { from: 11, to: 16 }, { from: 19, to: 25 }, { from: 27, to: 32 }])
  })
  it('has Save, Undo and Redo that say what the buffer can do, and Ctrl+Z reaches it', () => {
    const edit = editing({ modified: true, canUndo: true, canRedo: false })
    show(BOATS, { edit })
    expect(screen.getByText('● Modified')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Save the file/ }))
    expect(edit.onSave).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(edit.undo).toHaveBeenCalledOnce()
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true })
    expect(edit.undo).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true, shiftKey: true })
    expect(edit.redo).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(edit.onSaveAs).toHaveBeenCalledOnce()
  })
  it('does not edit a result of a query', async () => {
    const edit = editing()
    show(BOATS, { edit })
    fireEvent.click(screen.getByRole('button', { name: 'Ask the table a question in SQL' }))
    outcome.next = { ok: true, result: { columns: ['n'], rows: [['2']], more: false } }
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Run' })))
    fireEvent.doubleClick(screen.getByRole('cell', { name: '2' }))
    expect(screen.queryByRole('textbox', { name: 'Edit cell' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Add an empty row below the selected one (or at the end)' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('TableView: the cell menu', () => {
  it('has Copy on any cell, and the edits when the table can be edited', () => {
    const copyText = vi.fn()
    window.fb = { copyText } as never
    const edit: TableEditing = { modified: false, canUndo: false, canRedo: false, apply: vi.fn(), undo: vi.fn(), redo: vi.fn(), onSave: vi.fn(), onSaveAs: vi.fn() }
    show(BOATS)
    fireEvent.contextMenu(screen.getByRole('cell', { name: 'Gull' }))
    expect(screen.queryByRole('menuitem', { name: /Add Row/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy/ }))
    expect(copyText).toHaveBeenCalledWith('Gull')
    cleanup()
    show(BOATS, { edit })
    fireEvent.contextMenu(screen.getByRole('cell', { name: 'Heron' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Add Row/ }))
    expect(edit.apply).toHaveBeenLastCalledWith([{ from: 27, insert: ',\n' }])
    fireEvent.contextMenu(screen.getByRole('cell', { name: 'Heron' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete Column/ }))
    expect(edit.apply).toHaveBeenLastCalledWith([{ from: 0, to: 5 }, { from: 11, to: 16 }, { from: 19, to: 25 }, { from: 27, to: 32 }])
  })
})
