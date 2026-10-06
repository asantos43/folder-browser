/** A table of cells as a SQLite table that can only be read, and the one statement the query box lets through. Pure (it takes a database from sql.js): the worker that runs it is in `src/workers/`. */
import type { Database } from 'sql.js'
import { toNumber, type ColumnType } from './table.ts'

/** The most rows a query gives back (the rest is said, not sent). */
export const RESULT_LIMIT = 100_000

export type Checked = { ok: true; sql: string } | { ok: false; error: 'empty' | 'several' | 'notSelect' }

/**
 * The one statement the box may run: it begins with SELECT or WITH, and nothing but a closing `;`, spaces and comments follows it. The text is read as SQLite reads it (quotes
 * with doubled quotes inside, `[names]`, backticks, `--` and block comments), so a `;` inside a text is not the end.
 */
export function checkQuery(input: string): Checked {
  let i = 0
  let first = ''
  let semicolon = -1
  let significant = false
  const n = input.length
  while (i < n) {
    const c = input[i]
    if (c === '-' && input[i + 1] === '-') {
      while (i < n && input[i] !== '\n') i++
    } else if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      i++
      while (i < n) {
        if (input[i] === close) {
          if (close !== ']' && input[i + 1] === close) i += 2
          else break
        } else i++
      }
      i++
      if (semicolon >= 0) return { ok: false, error: 'several' }
      significant = true
    } else if (c === ';') {
      if (semicolon < 0) semicolon = i
      i++
    } else if (/\s/.test(c)) i++
    else {
      if (semicolon >= 0) return { ok: false, error: 'several' }
      if (!significant && c !== '(') {
        const word = /^[A-Za-z]+/.exec(input.slice(i))?.[0] ?? ''
        first = word.toUpperCase()
        significant = true
      } else significant = true
      i++
    }
  }
  if (!significant) return { ok: false, error: 'empty' }
  if (first !== 'SELECT' && first !== 'WITH') return { ok: false, error: 'notSelect' }
  return { ok: true, sql: semicolon >= 0 ? input.slice(0, semicolon) : input }
}

const ident = (name: string): string => `"${name.replaceAll('"', '""')}"`

/** Makes the table `t` of the rows (`names` and `types` for its columns) and shuts the database against writing. A number column holds numbers (empty cells are NULL), a date column the text of the date, the others text. */
export function loadTable(db: Database, names: string[], types: ColumnType[], rows: string[][]): void {
  db.run(`CREATE TABLE t (${names.map((name, i) => `${ident(name)} ${types[i] === 'number' ? 'REAL' : 'TEXT'}`).join(', ')})`)
  db.run('BEGIN')
  const insert = db.prepare(`INSERT INTO t VALUES (${names.map(() => '?').join(', ')})`)
  for (const row of rows) {
    insert.run(
      names.map((_, i) => {
        const v = row[i]
        if (v === undefined || (v.trim() === '' && types[i] !== 'text')) return null
        if (types[i] === 'number') return toNumber(v) ?? v
        return v
      }),
    )
  }
  insert.free()
  db.run('COMMIT')
  db.run('PRAGMA query_only = ON')
}

export interface QueryResult {
  columns: string[]
  rows: string[][]
  /** There were more rows than `RESULT_LIMIT`. */
  more: boolean
}

const show = (v: unknown): string => (v === null || v === undefined ? '' : v instanceof Uint8Array ? `[${v.length} bytes]` : String(v))

/** Runs one checked statement and gives its rows as text (NULL is an empty cell). Throws what SQLite says when the statement is wrong. */
export function runQuery(db: Database, sql: string, limit = RESULT_LIMIT): QueryResult {
  const statement = db.prepare(sql)
  try {
    const columns = statement.getColumnNames()
    const rows: string[][] = []
    let more = false
    while (statement.step()) {
      if (rows.length >= limit) {
        more = true
        break
      }
      rows.push(statement.get().map(show))
    }
    return { columns, rows, more }
  } finally {
    statement.free()
  }
}
