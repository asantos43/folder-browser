/// <reference lib="webworker" />
import { checkQuery, loadTable, runQuery } from '@core/sqlTable.ts'
import initSqlJs, { type Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import type { SqlRequest, SqlResponse } from '@/state/sqlSession.ts'

/** SQLite (sql.js) in a worker of its own: the table is loaded once, and each message is one query on it. A query that runs too long is not stopped here: the page ends the worker. */
let db: Database | null = null
const send = (message: SqlResponse) => postMessage(message)

self.onmessage = async (event: MessageEvent<SqlRequest>) => {
  const message = event.data
  try {
    if (message.type === 'load') {
      const SQL = await initSqlJs({ locateFile: () => wasmUrl })
      db?.close()
      db = new SQL.Database()
      loadTable(db, message.names, message.types, message.rows)
      send({ type: 'ready' })
    } else if (message.type === 'query') {
      if (!db) return send({ type: 'error', id: message.id, message: 'not loaded' })
      const checked = checkQuery(message.sql)
      if (!checked.ok) return send({ type: 'refused', id: message.id, reason: checked.error })
      send({ type: 'result', id: message.id, result: runQuery(db, checked.sql) })
    }
  } catch (error) {
    send({ type: 'error', id: 'id' in message ? message.id : 0, message: error instanceof Error ? error.message : String(error) })
  }
}
