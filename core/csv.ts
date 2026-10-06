/** Delimited text (CSV, TSV) as rows of cells: what the table view draws. Pure, and bounded: a file is never turned into more rows or columns than the view can use. */

export interface Table {
  rows: string[][]
  /** The widest row, before the limit on columns. */
  columns: number
  /** Rows (or cells of a row) were left out because of the limits. */
  truncated: boolean
  /** Where each cell is in the text, when asked for (`limits.spans`): per row, `[from, to, from, to…]` with the quotes inside the span. */
  spans?: number[][]
  /** Where each row is in the text, when asked for: `from` is its first character, `to` the end of its content, `next` where the following row starts (after the line break). */
  rowAt?: { from: number; to: number; next: number }[]
}

export const MAX_ROWS = 500_000
export const MAX_COLUMNS = 500

const CANDIDATES = [',', ';', '\t', '|']

/** The delimiter of a text: a tab for `.tsv`; else the one of `, ; tab |` that the first lines have most often outside quotes (a semicolon where Excel writes the decimal comma). */
export function detectDelimiter(text: string, tab = false): string {
  if (tab) return '\t'
  const counts = new Map<string, number>(CANDIDATES.map((c) => [c, 0]))
  let quoted = false
  let lines = 0
  for (let i = 0; i < text.length && lines < 5; i++) {
    const c = text[i]
    if (c === '"') quoted = !quoted
    else if (!quoted && c === '\n') lines++
    else if (!quoted && counts.has(c)) counts.set(c, counts.get(c)! + 1)
  }
  let best = ','
  for (const [c, n] of counts) if (n > counts.get(best)!) best = c
  return best
}

/** Parses RFC 4180 text (quotes, doubled quotes, line breaks inside a quoted cell, CRLF or LF), up to the limits. */
export function parseDelimited(text: string, delimiter: string, limits: { rows?: number; columns?: number; spans?: boolean } = {}): Table {
  const maxRows = limits.rows ?? MAX_ROWS
  const maxColumns = limits.columns ?? MAX_COLUMNS
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let widest = 0
  let truncated = false
  const spans: number[][] | undefined = limits.spans ? [] : undefined
  const rowAt: { from: number; to: number; next: number }[] | undefined = limits.spans ? [] : undefined
  let cellFrom = text.charCodeAt(0) === 0xfeff ? 1 : 0
  let rowSpan: number[] = []
  let rowFrom = cellFrom
  /** `end` is where the cell stops in the text; `after` where the next one (or row) starts. */
  const endCell = (end: number, after: number) => {
    if (row.length < maxColumns) {
      row.push(cell)
      if (spans) rowSpan.push(cellFrom, end)
    } else truncated = true
    cell = ''
    cellFrom = after
  }
  const endRow = (end: number, after: number) => {
    endCell(end, after)
    widest = Math.max(widest, row.length)
    rows.push(row)
    if (spans && rowAt) {
      spans.push(rowSpan)
      rowAt.push({ from: rowFrom, to: end, next: after })
    }
    row = []
    rowSpan = []
    rowFrom = after
  }
  let i = cellFrom
  for (; i < text.length; i++) {
    if (rows.length >= maxRows) {
      truncated = true
      break
    }
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delimiter) endCell(i, i + 1)
    else if (c === '\n') endRow(i, i + 1)
    else if (c === '\r') {
      const end = i
      if (text[i + 1] === '\n') i++
      endRow(end, i + 1)
    } else cell += c
  }
  // The last line has no break after it (and an empty one after the final break is not a row).
  if (rows.length < maxRows && (cell !== '' || row.length > 0 || (text.length > cellFrom && text.length > rowFrom))) endRow(text.length, text.length)
  return { rows, columns: widest, truncated, ...(spans ? { spans, rowAt } : {}) }
}
