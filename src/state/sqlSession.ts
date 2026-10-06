import type { QueryResult } from '@core/sqlTable.ts'
import type { ColumnType } from '@core/table.ts'

export type SqlRequest = { type: 'load'; names: string[]; types: ColumnType[]; rows: string[][] } | { type: 'query'; id: number; sql: string }
export type SqlResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; result: QueryResult }
  | { type: 'refused'; id: number; reason: 'empty' | 'several' | 'notSelect' }
  | { type: 'error'; id: number; message: string }

export type SqlOutcome = { ok: true; result: QueryResult } | { ok: false; error: 'empty' | 'several' | 'notSelect' | 'timeout' | 'failed'; message?: string }

export interface SqlTable {
  names: string[]
  types: ColumnType[]
  rows: string[][]
}

/** The page's side of the query worker: it makes the worker when the first query is asked, loads the table into it, and ends it (a new one starts at the next query) when a query takes longer than `timeoutMs`. */
export class SqlSession {
  private worker: Worker | null = null
  private loaded = false
  private next = 1
  private table: SqlTable | null = null
  private waiting = new Map<number, (outcome: SqlOutcome) => void>()
  private ready: (() => void) | null = null

  private readonly make: () => Worker
  private readonly timeoutMs: number

  constructor(make: () => Worker, timeoutMs = 10_000) {
    this.make = make
    this.timeoutMs = timeoutMs
  }

  /** What the next query runs on (the table changed: the worker loads it again). */
  setTable(table: SqlTable): void {
    this.table = table
    this.loaded = false
  }

  private start(): Worker {
    if (this.worker) return this.worker
    const worker = this.make()
    worker.onmessage = (event: MessageEvent<SqlResponse>) => {
      const message = event.data
      if (message.type === 'ready') return this.ready?.()
      const done = this.waiting.get(message.id)
      if (!done) return
      this.waiting.delete(message.id)
      if (message.type === 'result') done({ ok: true, result: message.result })
      else if (message.type === 'refused') done({ ok: false, error: message.reason })
      else done({ ok: false, error: 'failed', message: message.message })
    }
    worker.onerror = (event) => this.fail('failed', event.message)
    this.worker = worker
    return worker
  }

  private fail(error: 'timeout' | 'failed', message?: string): void {
    this.worker?.terminate()
    this.worker = null
    this.loaded = false
    this.ready = null
    for (const done of this.waiting.values()) done({ ok: false, error, message })
    this.waiting.clear()
  }

  /** Runs one statement. */
  query(sql: string): Promise<SqlOutcome> {
    const table = this.table
    if (!table) return Promise.resolve({ ok: false, error: 'failed', message: 'no table' })
    return new Promise((resolve) => {
      const id = this.next++
      const worker = this.start()
      const timer = setTimeout(() => this.fail('timeout'), this.timeoutMs)
      this.waiting.set(id, (outcome) => {
        clearTimeout(timer)
        resolve(outcome)
      })
      const ask = () => worker.postMessage({ type: 'query', id, sql } satisfies SqlRequest)
      if (this.loaded) return ask()
      this.ready = () => {
        this.loaded = true
        this.ready = null
        ask()
      }
      worker.postMessage({ type: 'load', names: table.names, types: table.types, rows: table.rows } satisfies SqlRequest)
    })
  }

  dispose(): void {
    this.fail('failed')
  }
}

/** The real worker (a module of the build). */
export const createSqlWorker = (): Worker => new Worker(new URL('../workers/sql.worker.ts', import.meta.url), { type: 'module' })
