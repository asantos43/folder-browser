/** What a table of cells can be asked: the type of a column, sorting, filtering, the distinct values of a column, searching. Pure; the rows are never changed (a view is a list of row numbers). */

export type ColumnType = 'number' | 'date' | 'text'

const PLAIN_NUMBER = /^[-+]?(\d+([.,]\d+)?|[.,]\d+)([eE][-+]?\d+)?$/
const GROUPED_NUMBER = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/
const DATE = /^\d{4}[-/]\d{2}[-/]\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[-+]\d{2}:?\d{2})?)?$/

/** A number as written in a cell (`12`, `-3.5`, `1e3`, `1,5` with a decimal comma, `1,234.50` with thousands), or null. */
export function toNumber(value: string): number | null {
  const v = value.trim()
  if (GROUPED_NUMBER.test(v)) return Number(v.replaceAll(',', ''))
  if (!PLAIN_NUMBER.test(v)) return null
  return Number(v.replace(',', '.'))
}

/** A date as written in a cell (ISO, with `-` or `/`, a time optional), as milliseconds, or null. */
export function toDate(value: string): number | null {
  const v = value.trim()
  if (!DATE.test(v)) return null
  const ms = Date.parse(v.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3').replace(' ', 'T'))
  return Number.isNaN(ms) ? null : ms
}

/** The type of each column: a number or a date when nearly every value that is not empty is one (95%, so a stray note does not turn a column into text), else text. */
export function inferTypes(body: string[][], columns: number, sample = 20_000): ColumnType[] {
  const types: ColumnType[] = []
  for (let c = 0; c < columns; c++) {
    let seen = 0
    let numbers = 0
    let dates = 0
    for (let r = 0; r < body.length && seen < sample; r++) {
      const v = body[r][c]
      if (v === undefined || v.trim() === '') continue
      seen++
      if (toNumber(v) !== null) numbers++
      else if (toDate(v) !== null) dates++
    }
    types.push(seen === 0 ? 'text' : numbers >= seen * 0.95 ? 'number' : dates >= seen * 0.95 ? 'date' : 'text')
  }
  return types
}

const keyOf = (value: string | undefined, type: ColumnType): number | string | null => {
  if (value === undefined || value.trim() === '') return null
  if (type === 'number') return toNumber(value) ?? value
  if (type === 'date') return toDate(value) ?? value
  return value
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Orders two values of a column of `type`: numbers and dates by value, text the way a person sorts it; what does not fit the type goes after what does. */
export function compareValues(a: string | undefined, b: string | undefined, type: ColumnType): number {
  const x = keyOf(a, type)
  const y = keyOf(b, type)
  if (typeof x === 'number' && typeof y === 'number') return x - y
  if (typeof x === 'number') return -1
  if (typeof y === 'number') return 1
  return collator.compare(String(x), String(y))
}

export type FilterOp = 'contains' | 'not-contains' | 'equals' | 'not-equals' | 'starts' | 'ends' | 'empty' | 'not-empty' | 'gt' | 'ge' | 'lt' | 'le' | 'in'
export const FILTER_OPS: FilterOp[] = ['contains', 'not-contains', 'equals', 'not-equals', 'starts', 'ends', 'empty', 'not-empty', 'gt', 'ge', 'lt', 'le', 'in']
/** The operators that take no value. */
export const UNARY_OPS: FilterOp[] = ['empty', 'not-empty']

export interface Filter {
  column: number
  op: FilterOp
  value: string
  /** The values ticked (`in`). */
  values?: string[]
}
export interface Sort {
  column: number
  dir: 'asc' | 'desc'
}

/** Whether a cell passes a filter. Text is compared without regard to case; `gt`… compare as numbers or dates in a column of that type, as text otherwise. */
export function passes(cell: string | undefined, filter: Filter, type: ColumnType): boolean {
  const v = cell ?? ''
  const empty = v.trim() === ''
  switch (filter.op) {
    case 'empty':
      return empty
    case 'not-empty':
      return !empty
    case 'in':
      return (filter.values ?? []).includes(v)
    case 'contains':
      return v.toLowerCase().includes(filter.value.toLowerCase())
    case 'not-contains':
      return !v.toLowerCase().includes(filter.value.toLowerCase())
    case 'starts':
      return v.toLowerCase().startsWith(filter.value.toLowerCase())
    case 'ends':
      return v.toLowerCase().endsWith(filter.value.toLowerCase())
    case 'equals':
    case 'not-equals': {
      const same = type !== 'text' && keyOf(v, type) !== null && keyOf(filter.value, type) !== null ? compareValues(v, filter.value, type) === 0 : v.toLowerCase() === filter.value.toLowerCase()
      return filter.op === 'equals' ? same : !same
    }
    default: {
      if (empty) return false
      const order = compareValues(v, filter.value, type)
      return filter.op === 'gt' ? order > 0 : filter.op === 'ge' ? order >= 0 : filter.op === 'lt' ? order < 0 : order <= 0
    }
  }
}

/** The numbers of the rows of `body` to show, in the order to show them: the ones that pass every filter, sorted when asked (stable; empty cells last either way). */
export function visibleRows(body: string[][], options: { filters?: Filter[]; sort?: Sort | null; types: ColumnType[] }): number[] {
  const { filters = [], sort, types } = options
  let rows: number[] = []
  for (let r = 0; r < body.length; r++) if (filters.every((f) => passes(body[r][f.column], f, types[f.column] ?? 'text'))) rows.push(r)
  if (sort) {
    const type = types[sort.column] ?? 'text'
    const sign = sort.dir === 'asc' ? 1 : -1
    rows = rows
      .map((r) => ({ r, v: body[r][sort.column] }))
      .sort((a, b) => {
        const ea = keyOf(a.v, type) === null
        const eb = keyOf(b.v, type) === null
        if (ea || eb) return ea === eb ? a.r - b.r : ea ? 1 : -1
        return sign * compareValues(a.v, b.v, type) || a.r - b.r
      })
      .map((x) => x.r)
  }
  return rows
}

/** The distinct values of a column, most frequent first (at most `limit`; `more` when there are others). */
export function distinctValues(body: string[][], column: number, limit = 200): { value: string; count: number }[] & { more?: boolean } {
  const counts = new Map<string, number>()
  for (const row of body) {
    const v = row[column] ?? ''
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const all = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || collator.compare(a.value, b.value))
  const out: { value: string; count: number }[] & { more?: boolean } = all.slice(0, limit)
  if (all.length > limit) out.more = true
  return out
}

/** Where `query` is in the cells of the rows shown (`order`, as row numbers of `body`): `[position in order, column]` in reading order, at most `cap`. */
export function findCells(body: string[][], order: number[], query: string, caseSensitive: boolean, cap = 100_000): [number, number][] {
  if (!query) return []
  const needle = caseSensitive ? query : query.toLowerCase()
  const found: [number, number][] = []
  for (let i = 0; i < order.length && found.length < cap; i++) {
    const row = body[order[i]]
    for (let c = 0; c < row.length && found.length < cap; c++) if ((caseSensitive ? row[c] : row[c].toLowerCase()).includes(needle)) found.push([i, c])
  }
  return found
}

/** A name for each column: the header's text when there is a header (made unique and never empty), else `column 1`, `column 2`…; `label` says the word. */
export function columnNames(head: string[] | undefined, columns: number, label: string): string[] {
  const used = new Set<string>()
  return Array.from({ length: columns }, (_, i) => {
    const base = head && head[i]?.trim() ? head[i].trim() : `${label} ${i + 1}`
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`
    used.add(name.toLowerCase())
    return name
  })
}
