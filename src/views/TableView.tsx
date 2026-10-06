import { detectDelimiter, MAX_COLUMNS, MAX_ROWS, parseDelimited } from '@core/csv.ts'
import { deleteColumn, deleteRow, insertColumn, insertRow, setCell, toDelimited, type TextChange } from '@core/csvEdit.ts'
import type { QueryResult } from '@core/sqlTable.ts'
import { columnNames, findCells, inferTypes, visibleRows, type Filter, type Sort } from '@core/table.ts'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboard, type MouseEvent as ReactMouse } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import type { MenuEntry } from '@/components/Menu.tsx'
import { Icon } from '@/components/Icon.tsx'
import { NONE, fileTarget, wrap, type FindOptions, type FindState } from '@/find/types.ts'
import { useI18n } from '@/i18n/context.tsx'
import { shortcut } from '@/workbench/commands.ts'
import { createSqlWorker, SqlSession } from '@/state/sqlSession.ts'
import { tableOptions, type TableOptions } from '@/state/tableState.ts'
import { ColumnFilter } from './ColumnFilter.tsx'
import { CsvToggle } from './CsvToggle.tsx'
import { QueryBar } from './QueryBar.tsx'
import { FileActions, SaveButton, Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'
import { useGroup } from '@/state/groups.ts'

/** What the table needs to change the text it is drawn from (the buffer of the text editor): one call is one change that can be undone. Absent: the table is only looked at. */
export interface TableEditing {
  modified: boolean
  canUndo: boolean
  canRedo: boolean
  apply(changes: TextChange[]): void
  undo(): void
  redo(): void
  onSave(): void
  onSaveAs(): void
}

const ROW = 22
const OVERSCAN = 10
const ROW_HEAD = 56
const cell = 'border-r border-b border-group-border px-2'
const clip = 'block overflow-hidden text-ellipsis whitespace-pre'

/** The name a spreadsheet gives column `i`: A, B… Z, AA… */
export const letters = (i: number): string => {
  let n = i + 1
  let out = ''
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

const firstLine = (value: string): string => (value.includes('\n') || value.includes('\r') ? `${value.split(/\r?\n|\r/)[0]} ↵` : value)

interface Selected {
  /** A position in the rows shown (-1: the header). */
  r: number
  c: number
}

/**
 * A CSV or TSV file as a table: the rows in view are the ones drawn (a file of hundreds of thousands of rows scrolls), the header stays in view, the cells are text (nothing in them is
 * read as markup or followed). **Search** (`Ctrl+F`) marks the cells, **sort** and **filter** by a column change which rows are shown and in what order (never the file), the
 * **query** box asks the table a question in SQL, and, with `edit`, a cell is edited in place (and rows and columns added or deleted) as changes to the text of the editor's buffer.
 */
export function TableView({ text, name, tab, tableKey, onSave, onOpenWith, onHex, zoom = 1, edit }: { text: string; name: string; tab: boolean; tableKey?: string; onSave: () => void; onOpenWith?: () => void; onHex?: () => void; zoom?: number; edit?: TableEditing }) {
  const { t } = useI18n()
  const group = useGroup()
  const key = tableKey ?? name
  const [opts, setOptsState] = useState<TableOptions>(() => tableOptions.get(key))
  const setOpts = (change: Partial<TableOptions>) => {
    const next = { ...opts, ...change }
    tableOptions.set(key, next)
    setOptsState(next)
  }
  const [result, setResult] = useState<QueryResult | null>(null)
  const [sel, setSel] = useState<Selected | null>(null)
  const [editing, setEditingState] = useState<{ r: number; c: number; value: string } | null>(null)
  // The cell being edited is also kept in a ref, so that a second way to finish (Enter, then the box losing the focus) cannot keep it twice.
  const editingNow = useRef(editing)
  const setEditing = (value: { r: number; c: number; value: string } | null) => {
    editingNow.current = value
    setEditingState(value)
  }
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [filterAt, setFilterAt] = useState<{ column: number; x: number; y: number } | null>(null)
  const [scroll, setScroll] = useState({ top: 0, height: 0 })
  const [found, setFound] = useState<{ cells: [number, number][]; index: number }>({ cells: [], index: -1 })
  const scroller = useRef<HTMLDivElement>(null)
  const rowH = ROW * zoom

  const delimiter = useMemo(() => detectDelimiter(text, tab), [text, tab])
  const parsed = useMemo(() => parseDelimited(text, delimiter, { spans: edit !== undefined }), [text, delimiter, edit !== undefined])
  const hasHeader = opts.header && parsed.rows.length > 0
  const bodyOffset = hasHeader ? 1 : 0
  const columns = Math.min(parsed.columns, MAX_COLUMNS)
  const head = hasHeader ? parsed.rows[0] : undefined
  const body = useMemo(() => (hasHeader ? parsed.rows.slice(1) : parsed.rows), [parsed, hasHeader])
  const names = useMemo(() => columnNames(head, columns, t('table.columnName')), [head, columns, t])
  const sourceTypes = useMemo(() => inferTypes(body, columns), [body, columns])

  const shownHead = result ? result.columns : head
  const shownBody = result ? result.rows : body
  const shownColumns = result ? result.columns.length : columns
  const types = useMemo(() => (result ? inferTypes(result.rows, result.columns.length) : sourceTypes), [result, sourceTypes])
  const order = useMemo(() => visibleRows(shownBody, { filters: opts.filters, sort: opts.sort, types }), [shownBody, opts.filters, opts.sort, types])
  const canEdit = edit !== undefined && !result && !parsed.truncated
  const filtered = opts.filters.length > 0

  // What the code of the query needs of the table: the file's own, never the result.
  const session = useMemo(() => new SqlSession(createSqlWorker), [])
  useEffect(() => session.setTable({ names, types: sourceTypes, rows: body }), [session, names, sourceTypes, body])
  useEffect(() => () => session.dispose(), [session])

  const widths = useMemo(() => {
    const sample = shownBody.slice(0, 100)
    return Array.from({ length: shownColumns }, (_, c) => {
      let chars = Math.max((shownHead?.[c] ?? letters(c)).length + 6, 4)
      for (const row of sample) chars = Math.max(chars, Math.min(row[c]?.length ?? 0, 40))
      return Math.round(Math.min(chars, 40) * 7.8 * zoom + 20)
    })
  }, [shownBody, shownHead, shownColumns, zoom])
  const total = Math.round(ROW_HEAD * zoom) + widths.reduce((a, b) => a + b, 0)

  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const measure = () => setScroll((s) => ({ top: box.scrollTop, height: box.clientHeight || s.height }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  const viewHeight = scroll.height || 800
  // Fewer rows than before (a filter, a result) move the browser's scroll without saying so at once: never draw past the end.
  const top = Math.min(scroll.top, Math.max(0, order.length * rowH - viewHeight + rowH))
  const first = Math.max(0, Math.floor(top / rowH) - OVERSCAN)
  const last = Math.min(order.length, Math.ceil((top + viewHeight) / rowH) + OVERSCAN)
  useEffect(() => {
    const box = scroller.current
    if (box) setScroll((s) => (s.top === box.scrollTop ? s : { ...s, top: box.scrollTop }))
  }, [order.length])

  // Search (Ctrl+F): where the text is in the rows shown; the cells are marked, and the current one is selected.
  const finding = useRef({ query: '', caseSensitive: false })
  const dataNow = useRef({ shownBody, order })
  dataNow.current = { shownBody, order }
  const selectCell = (r: number, c: number) => {
    setSel({ r, c })
    const box = scroller.current
    if (box) {
      const top = r * rowH
      if (top < box.scrollTop || top + rowH * 2 > box.scrollTop + (box.clientHeight || viewHeight)) box.scrollTop = Math.max(0, top - rowH * 3)
    }
  }
  const foundNow = useRef(found)
  foundNow.current = found
  const selectNow = useRef(selectCell)
  selectNow.current = selectCell
  const target = useMemo(() => {
    const state = (cells: [number, number][], index: number): FindState => (cells.length ? { count: cells.length, index: index + 1 } : NONE)
    return {
      search(query: string, options: FindOptions): FindState {
        finding.current = { query, caseSensitive: options.caseSensitive }
        const cells = findCells(dataNow.current.shownBody, dataNow.current.order, query, options.caseSensitive)
        setFound({ cells, index: cells.length ? 0 : -1 })
        if (cells.length) selectNow.current(cells[0][0], cells[0][1])
        return state(cells, 0)
      },
      step(direction: 1 | -1): FindState {
        const { cells } = foundNow.current
        if (!cells.length) return NONE
        const index = wrap(foundNow.current.index + direction, cells.length)
        setFound({ cells, index })
        selectNow.current(cells[index][0], cells[index][1])
        return state(cells, index)
      },
      clear() {
        finding.current = { query: '', caseSensitive: false }
        setFound({ cells: [], index: -1 })
      },
    }
  }, [])
  useEffect(() => fileTarget.set(target, group), [target, group])
  // A change of the rows shown (an edit, a filter) finds the text again where it is now.
  useEffect(() => {
    const { query, caseSensitive } = finding.current
    if (!query) return
    const cells = findCells(shownBody, order, query, caseSensitive)
    setFound((old) => ({ cells, index: cells.length ? Math.min(Math.max(old.index, 0), cells.length - 1) : -1 }))
  }, [shownBody, order])
  const marks = useMemo(() => new Set(found.cells.map(([r, c]) => r * 1000 + c)), [found.cells])
  const current = found.index >= 0 ? found.cells[found.index] : undefined

  // The selected cell stays in view.
  useEffect(() => {
    if (!sel) return
    scroller.current?.querySelector<HTMLElement>(`[data-r="${sel.r}"][data-c="${sel.c}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [sel])

  const tableRow = (r: number) => (r < 0 ? 0 : order[r] + bodyOffset)
  const valueAt = (r: number, c: number): string => (r < 0 ? (shownHead?.[c] ?? '') : (shownBody[order[r]]?.[c] ?? ''))

  const startEditing = (r: number, c: number, value?: string) => {
    if (!canEdit || (r < 0 && !hasHeader)) return
    setSel({ r, c })
    setEditing({ r, c, value: value ?? valueAt(r, c) })
  }
  const stopEditing = () => {
    setEditing(null)
    scroller.current?.focus()
  }
  const commit = (move?: 'down' | 'right' | 'left') => {
    const now = editingNow.current
    if (!now || !edit) return
    const row = tableRow(now.r)
    if (now.value !== (parsed.rows[row]?.[now.c] ?? '')) edit.apply([setCell(parsed, delimiter, row, now.c, now.value)])
    const { r, c } = now
    stopEditing()
    if (move === 'down') selectCell(Math.min(r + 1, order.length - 1), c)
    else if (move === 'right') selectCell(r, Math.min(c + 1, shownColumns - 1))
    else if (move === 'left') selectCell(r, Math.max(c - 1, 0))
  }

  const addRowAfter = (r: number | null) => {
    if (!canEdit) return
    const at = r !== null && r >= 0 ? order[r] + bodyOffset + 1 : r !== null ? bodyOffset : parsed.rows.length
    edit!.apply([insertRow(parsed, delimiter, at, Math.max(columns, 1), text)])
  }
  const removeRowAt = (r: number) => {
    if (canEdit && r >= 0) edit!.apply([deleteRow(parsed, order[r] + bodyOffset)])
  }
  const addRow = () => addRowAfter(sel ? sel.r : null)
  const removeRow = () => sel && removeRowAt(sel.r)
  const addColumn = () => {
    if (canEdit) edit!.apply(insertColumn(parsed, delimiter, sel ? sel.c + 1 : columns))
  }
  const removeColumn = () => {
    if (canEdit && sel) edit!.apply(deleteColumn(parsed, sel.c))
  }

  const cellMenu = (event: ReactMouse, r: number, c: number) => {
    event.preventDefault()
    setSel({ r, c })
    const value = valueAt(r, c)
    const entries: MenuEntry[] = [{ id: 'copy', label: t('menu.copy'), shortcut: shortcut('Ctrl+C'), run: () => void window.fb?.copyText(value) }]
    if (canEdit) {
      entries.unshift({ id: 'edit', label: t('table.editCell'), shortcut: 'F2', disabled: r < 0 && !hasHeader, run: () => startEditing(r, c) })
      entries.push(
        { separator: true },
        { id: 'addRow', label: t('table.addRow'), run: () => addRowAfter(r) },
        { id: 'deleteRow', label: t('table.deleteRow'), disabled: r < 0, run: () => removeRowAt(r) },
        { id: 'addColumn', label: t('table.addColumn'), run: () => edit!.apply(insertColumn(parsed, delimiter, c + 1)) },
        { id: 'deleteColumn', label: t('table.deleteColumn'), run: () => edit!.apply(deleteColumn(parsed, c)) },
      )
    }
    setMenu({ x: event.clientX, y: event.clientY, label: t('menu.edit'), entries })
  }

  const move = (r: number, c: number, extend = false) => {
    if (!order.length && !shownHead) return
    const minRow = shownHead ? -1 : 0
    selectCell(Math.max(minRow, Math.min(r, order.length - 1)), Math.max(0, Math.min(c, shownColumns - 1)))
    void extend
  }
  const onKeyDown = (event: ReactKeyboard) => {
    if (editing) return
    const mod = event.ctrlKey || event.metaKey
    const page = Math.max(1, Math.floor(viewHeight / rowH) - 2)
    const at = sel ?? { r: shownHead ? -1 : 0, c: 0 }
    const go = (r: number, c: number) => {
      event.preventDefault()
      move(r, c)
    }
    if (mod && !event.altKey && event.key.toLowerCase() === 'z' && canEdit) {
      event.preventDefault()
      return event.shiftKey ? edit!.redo() : edit!.undo()
    }
    if (mod && event.key.toLowerCase() === 'y' && canEdit) {
      event.preventDefault()
      return edit!.redo()
    }
    if (mod && event.key.toLowerCase() === 'c' && sel && !window.getSelection()?.toString()) {
      event.preventDefault()
      return void window.fb?.copyText(valueAt(sel.r, sel.c))
    }
    if (mod || event.altKey) return
    switch (event.key) {
      case 'ArrowDown':
        return go(at.r + 1, at.c)
      case 'ArrowUp':
        return go(at.r - 1, at.c)
      case 'ArrowRight':
        return go(at.r, at.c + 1)
      case 'ArrowLeft':
        return go(at.r, at.c - 1)
      case 'PageDown':
        return go(at.r + page, at.c)
      case 'PageUp':
        return go(at.r - page, at.c)
      case 'Home':
        return go(at.r, 0)
      case 'End':
        return go(at.r, shownColumns - 1)
      case 'Tab':
        return go(at.r, at.c + (event.shiftKey ? -1 : 1))
      case 'Enter':
      case 'F2':
        if (sel && canEdit) {
          event.preventDefault()
          startEditing(sel.r, sel.c)
        }
        return
      case 'Delete':
      case 'Backspace':
        if (sel && canEdit && (sel.r >= 0 || hasHeader) && valueAt(sel.r, sel.c) !== '') {
          event.preventDefault()
          edit!.apply([setCell(parsed, delimiter, tableRow(sel.r), sel.c, '')])
        }
        return
      default:
        if (sel && canEdit && event.key.length === 1) {
          event.preventDefault()
          startEditing(sel.r, sel.c, event.key)
        }
    }
  }

  const sortBy = (column: number) => {
    const sort: Sort | null = opts.sort?.column !== column ? { column, dir: 'asc' } : opts.sort.dir === 'asc' ? { column, dir: 'desc' } : null
    setOpts({ sort })
  }
  const setFilter = (column: number, filter: Filter | null) => {
    setOpts({ filters: [...opts.filters.filter((f) => f.column !== column), ...(filter ? [filter] : [])] })
    setFilterAt(null)
  }
  const showResult = (value: QueryResult | null) => {
    setResult(value)
    setSel(null)
    setEditing(null)
    setOpts({ sort: null, filters: [] })
  }
  const exportResult = (value: QueryResult) => {
    const stem = name.replace(/\.[^.]+$/, '')
    const ext = delimiter === '\t' ? 'tsv' : 'csv'
    void window.fb?.edit.saveAs(`${stem}-result.${ext}`, toDelimited(value.columns, value.rows, delimiter), { eol: 'lf', bom: false })
  }

  const sortMark = (c: number) => (opts.sort?.column === c ? (opts.sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-swap')
  const ariaSort = (c: number) => (opts.sort?.column === c ? (opts.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined)
  const filterFor = (c: number) => opts.filters.find((f) => f.column === c)

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        <CsvToggle />
        {edit ? (
          <>
            <ToolbarButton icon="save" text={t('edit.save')} label={t('edit.saveTitle')} disabled={!edit.modified} onClick={edit.onSave} />
            <ToolbarButton icon="discard" label={t('table.undo')} disabled={!edit.canUndo} onClick={edit.undo} />
            <ToolbarButton icon="redo" label={t('table.redo')} disabled={!edit.canRedo} onClick={edit.redo} />
            <Separator />
            <ToolbarButton icon="insert" label={t('table.addRowTitle')} disabled={!canEdit} onClick={addRow} />
            <ToolbarButton icon="trash" label={t('table.deleteRowTitle')} disabled={!canEdit || !sel || sel.r < 0} onClick={removeRow} />
            <ToolbarButton icon="add" label={t('table.addColumnTitle')} disabled={!canEdit} onClick={addColumn} />
            <ToolbarButton icon="remove" label={t('table.deleteColumnTitle')} disabled={!canEdit || !sel} onClick={removeColumn} />
            <Separator />
          </>
        ) : null}
        <ToolbarButton icon="list-selection" label={t('table.headerTitle')} text={t('table.header')} pressed={opts.header} onClick={() => setOpts({ header: !opts.header, sort: null, filters: [] })} />
        <ToolbarButton icon="database" label={t('table.queryTitle')} text={t('table.query')} pressed={opts.query} onClick={() => setOpts({ query: !opts.query })} />
        {filtered || opts.sort ? <ToolbarButton icon="clear-all" label={t('table.clearFiltersTitle')} onClick={() => setOpts({ sort: null, filters: [] })} /> : null}
        <Separator />
        <SaveButton label={t('file.saveAs')} onClick={edit ? edit.onSaveAs : onSave} />
        <FileActions onOpenWith={onOpenWith} onHex={onHex} />
        <span className="ml-auto flex items-center gap-3 pr-1 text-[12px] whitespace-nowrap text-fg-muted">
          {edit?.modified ? <span aria-live="polite">● {t('edit.modified')}</span> : null}
          {parsed.truncated && !result ? <span>{t(edit ? 'table.readOnlyBig' : 'csv.truncated', { rows: MAX_ROWS.toLocaleString(), columns: String(MAX_COLUMNS) })}</span> : null}
          <span>{filtered ? t('table.count', { shown: order.length, rows: shownBody.length, columns: shownColumns }) : t('csv.size', { rows: result ? shownBody.length : parsed.rows.length, columns: shownColumns })}</span>
        </span>
      </Toolbar>
      {opts.query ? <QueryBar session={session} names={names} sql={opts.sql} onSql={(sql) => setOpts({ sql })} result={result} onResult={showResult} onExport={exportResult} /> : null}
      <div
        ref={scroller}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        className="min-h-0 flex-1 overflow-auto bg-editor text-editor-fg outline-none select-text"
        style={{ '--wsnp-zoom': zoom, fontSize: `${13 * zoom}px` } as CSSProperties}
      >
        <table aria-label={result ? t('query.resultTable') : t('csv.label', { name })} aria-rowcount={order.length + 1} className="border-separate border-spacing-0 font-mono" style={{ tableLayout: 'fixed', width: total }}>
          <colgroup>
            <col style={{ width: Math.round(ROW_HEAD * zoom) }} />
            {widths.map((w, c) => (
              <col key={c} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: rowH }}>
              <th scope="col" className={`${cell} sticky top-0 left-0 z-20 bg-widget text-fg-muted`} />
              {Array.from({ length: shownColumns }, (_, c) => (
                <th
                  key={c}
                  scope="col"
                  aria-label={shownHead?.[c] || letters(c)}
                  aria-sort={ariaSort(c)}
                  data-r={-1}
                  data-c={c}
                  onMouseDown={() => setSel({ r: -1, c })}
                  onDoubleClick={() => startEditing(-1, c)}
                  onContextMenu={(e) => cellMenu(e, -1, c)}
                  className={`${cell} group sticky top-0 z-10 bg-widget text-left font-semibold ${sel && sel.r === -1 && sel.c === c ? 'outline outline-1 -outline-offset-1 outline-focus' : ''}`}
                >
                  {editing && editing.r === -1 && editing.c === c ? (
                    <CellEditor value={editing.value} onChange={(value) => setEditing({ ...editing, value })} onCommit={commit} onCancel={stopEditing} label={t('table.editCell')} />
                  ) : null}
                  <span className="flex items-center gap-1 overflow-hidden">
                    <span className="min-w-0 flex-1 truncate">{shownHead?.[c] ?? letters(c)}</span>
                    <button type="button" aria-label={t('table.sortBy', { name: names[c] ?? letters(c) })} title={t('table.sortBy', { name: names[c] ?? letters(c) })} onMouseDown={(e) => e.stopPropagation()} onClick={() => sortBy(c)} className={`flex shrink-0 items-center rounded px-0.5 hover:bg-toolbar-hover ${opts.sort?.column === c ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}>
                      <Icon name={sortMark(c)} className="text-[12px]" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('table.filterBy', { name: names[c] ?? letters(c) })}
                      title={t('table.filterBy', { name: names[c] ?? letters(c) })}
                      aria-pressed={filterFor(c) !== undefined}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        const box = e.currentTarget.getBoundingClientRect()
                        setFilterAt({ column: c, x: box.left, y: box.bottom + 2 })
                      }}
                      className={`flex shrink-0 items-center rounded px-0.5 hover:bg-toolbar-hover ${filterFor(c) ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
                    >
                      <Icon name={filterFor(c) ? 'filter-filled' : 'filter'} className="text-[12px]" />
                    </button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 ? (
              <tr aria-hidden style={{ height: first * rowH }}>
                <td colSpan={shownColumns + 1} />
              </tr>
            ) : null}
            {order.slice(first, last).map((source, offset) => {
              const r = first + offset
              const row = shownBody[source]
              return (
                <tr key={source} aria-rowindex={r + 2} style={{ height: rowH }} className="hover:bg-list-hover">
                  <th scope="row" className={`${cell} sticky left-0 z-[5] bg-widget text-right font-normal text-fg-muted`}>
                    <span className={clip}>{result ? r + 1 : source + 1 + bodyOffset}</span>
                  </th>
                  {Array.from({ length: shownColumns }, (_, c) => {
                    const selected = sel?.r === r && sel.c === c
                    const mark = marks.has(r * 1000 + c)
                    const isCurrent = current !== undefined && current[0] === r && current[1] === c
                    return (
                      <td
                        key={c}
                        data-r={r}
                        data-c={c}
                        onMouseDown={() => {
                          setSel({ r, c })
                          if (editing) commit()
                        }}
                        onDoubleClick={() => startEditing(r, c)}
                        onContextMenu={(e) => cellMenu(e, r, c)}
                        className={`${cell} relative ${types[c] === 'number' ? 'text-right' : ''} ${selected ? 'outline outline-1 -outline-offset-1 outline-focus' : ''} ${isCurrent ? 'bg-[var(--wsnp-find-current)]' : mark ? 'bg-[var(--wsnp-find-match)]' : ''}`}
                      >
                        {editing && editing.r === r && editing.c === c ? <CellEditor value={editing.value} onChange={(value) => setEditing({ ...editing, value })} onCommit={commit} onCancel={stopEditing} label={t('table.editCell')} /> : null}
                        <span className={clip}>{firstLine(row?.[c] ?? '')}</span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {last < order.length ? (
              <tr aria-hidden style={{ height: (order.length - last) * rowH }}>
                <td colSpan={shownColumns + 1} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {filterAt ? <ColumnFilter name={names[filterAt.column] ?? letters(filterAt.column)} column={filterAt.column} body={shownBody} filter={filterFor(filterAt.column)} at={filterAt} onApply={(filter) => setFilter(filterAt.column, filter)} onClose={() => setFilterAt(null)} /> : null}
    </div>
  )
}

/** The box a cell is edited in, over the cell: Enter keeps the text (and goes down), Tab keeps it (and goes right), Esc gives up, Alt+Enter or Shift+Enter starts a new line. */
function CellEditor({ value, onChange, onCommit, onCancel, label }: { value: string; onChange: (value: string) => void; onCommit: (move?: 'down' | 'right' | 'left') => void; onCancel: () => void; label: string }) {
  const box = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const finish = (how: () => void) => {
    if (done.current) return
    done.current = true
    how()
  }
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  return (
    <textarea
      ref={box}
      aria-label={label}
      value={value}
      rows={Math.min(8, value.split('\n').length)}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(() => onCommit())}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          return finish(onCancel)
        }
        if (e.key === 'Enter' && e.altKey) {
          e.preventDefault()
          const el = e.currentTarget
          const at = el.selectionStart
          return onChange(`${value.slice(0, at)}\n${value.slice(el.selectionEnd)}`)
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          return finish(() => onCommit('down'))
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          return finish(() => onCommit(e.shiftKey ? 'left' : 'right'))
        }
      }}
      className="absolute top-0 left-0 z-30 min-h-full min-w-full resize-none overflow-hidden border border-focus bg-editor px-2 font-mono text-editor-fg outline-none"
      style={{ width: 'max(100%, 240px)' }}
    />
  )
}
