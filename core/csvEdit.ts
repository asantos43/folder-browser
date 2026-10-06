/** Changes to a delimited text as changes of the text itself: each is where the cells are (`Table.spans`), so everything not touched stays byte for byte as it was. Pure. */
import type { Table } from './csv.ts'

/** A change of the text, as CodeMirror takes it: replace `from`–`to` (`to` omitted: insert) with `insert`. */
export interface TextChange {
  from: number
  to?: number
  insert?: string
}

/** A value as it is written in a cell: in quotes (with the quotes inside doubled) when it holds the delimiter, a quote or a line break, or begins or ends with a space. */
export function encodeCell(value: string, delimiter: string): string {
  if (value === '' || !(value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r') || value.startsWith(' ') || value.endsWith(' '))) return value
  return `"${value.replaceAll('"', '""')}"`
}

const need = (table: Table) => {
  if (!table.spans || !table.rowAt) throw new Error('the table was parsed without spans')
  return { spans: table.spans, rowAt: table.rowAt }
}

/** Sets the cell at row `r` and column `c` (the rows are those of `table.rows`, the header too); a row shorter than the column gets the delimiters it lacks. */
export function setCell(table: Table, delimiter: string, r: number, c: number, value: string): TextChange {
  const { spans, rowAt } = need(table)
  const row = spans[r]
  const cells = row.length / 2
  const text = encodeCell(value, delimiter)
  if (c < cells) return { from: row[c * 2], to: row[c * 2 + 1], insert: text }
  return { from: rowAt[r].to, insert: delimiter.repeat(c - cells + 1) + text }
}

/** A new empty row before row `at` (`at` = the number of rows: at the end), as wide as `columns`. `text` is the whole text (to see how it ends). */
export function insertRow(table: Table, delimiter: string, at: number, columns: number, text: string): TextChange {
  const { rowAt } = need(table)
  const line = delimiter.repeat(Math.max(0, columns - 1))
  if (at < rowAt.length) return { from: rowAt[at].from, insert: `${line}\n` }
  const ended = text === '' || text.endsWith('\n') || text.endsWith('\r')
  // A row of one empty cell is an empty line, which only counts as a row when a line break ends it.
  return { from: text.length, insert: `${ended ? '' : '\n'}${line}${ended || line === '' ? '\n' : ''}` }
}

/** The changes that take row `r` out (with its line break; the last row with the break before it). */
export function deleteRow(table: Table, r: number): TextChange {
  const { rowAt } = need(table)
  const at = rowAt[r]
  if (at.next > at.to || r === 0) return { from: at.from, to: at.next }
  return { from: rowAt[r - 1].to, to: at.to }
}

/** A new empty column before column `at` (`at` = the width: after the last one), as one change per row that is long enough. */
export function insertColumn(table: Table, delimiter: string, at: number): TextChange[] {
  const { spans, rowAt } = need(table)
  const changes: TextChange[] = []
  for (let r = 0; r < spans.length; r++) {
    const cells = spans[r].length / 2
    if (at < cells) changes.push({ from: spans[r][at * 2], insert: delimiter })
    else if (at === cells && cells > 0) changes.push({ from: rowAt[r].to, insert: delimiter })
  }
  return changes
}

/** The changes that take column `c` out of every row that has it (the delimiter next to it goes too). */
export function deleteColumn(table: Table, c: number): TextChange[] {
  const { spans } = need(table)
  const changes: TextChange[] = []
  for (const row of spans) {
    const cells = row.length / 2
    if (c >= cells) continue
    if (cells === 1) changes.push({ from: row[0], to: row[1] })
    else if (c < cells - 1) changes.push({ from: row[c * 2], to: row[c * 2 + 2] })
    else changes.push({ from: row[c * 2 - 1], to: row[c * 2 + 1] })
  }
  return changes
}

/** Applies changes (all given against the same text) to a string: what a test or a caller without an editor needs. */
export function applyChanges(text: string, changes: TextChange[]): string {
  let out = ''
  let at = 0
  for (const change of [...changes].sort((a, b) => a.from - b.from)) {
    out += text.slice(at, change.from) + (change.insert ?? '')
    at = change.to ?? change.from
  }
  return out + text.slice(at)
}

/** Rows of cells as delimited text (what **Export Result** writes): a cell is quoted when it needs it, a line break ends each row. */
export function toDelimited(head: string[] | undefined, rows: string[][], delimiter: string): string {
  const line = (cells: string[]) => cells.map((cell) => encodeCell(cell, delimiter)).join(delimiter)
  return [...(head ? [line(head)] : []), ...rows.map(line)].join('\n') + '\n'
}
