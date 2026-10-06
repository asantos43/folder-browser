/** Delimited text (CSV, TSV) as rows of cells: what the table view draws. Pure, and bounded: a file is never turned into more rows or columns than the view can use. */

export interface Table {
  rows: string[][]
  /** The widest row, before the limit on columns. */
  columns: number
  /** Rows (or cells of a row) were left out because of the limits. */
  truncated: boolean
}

export const MAX_ROWS = 5000
export const MAX_COLUMNS = 200

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
export function parseDelimited(text: string, delimiter: string, limits: { rows?: number; columns?: number } = {}): Table {
  const maxRows = limits.rows ?? MAX_ROWS
  const maxColumns = limits.columns ?? MAX_COLUMNS
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let widest = 0
  let truncated = false
  const endCell = () => {
    if (row.length < maxColumns) row.push(cell)
    else truncated = true
    cell = ''
  }
  const endRow = () => {
    endCell()
    widest = Math.max(widest, row.length)
    rows.push(row)
    row = []
  }
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
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
    else if (c === delimiter) endCell()
    else if (c === '\n') endRow()
    else if (c === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
    } else cell += c
  }
  // The last line has no break after it (and an empty one after the final break is not a row).
  if (rows.length < maxRows && (cell !== '' || row.length > 0)) endRow()
  return { rows, columns: widest, truncated }
}
