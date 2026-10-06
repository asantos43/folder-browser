import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SqlSession, type SqlRequest, type SqlResponse } from './sqlSession.ts'

class FakeWorker {
  onmessage: ((e: MessageEvent<SqlResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  sent: SqlRequest[] = []
  reply = true
  postMessage(message: SqlRequest) {
    this.sent.push(message)
    if (!this.reply) return
    queueMicrotask(() => {
      if (message.type === 'load') this.onmessage?.({ data: { type: 'ready' } } as MessageEvent<SqlResponse>)
      else this.onmessage?.({ data: { type: 'result', id: message.id, result: { columns: ['a'], rows: [['1']], more: false } } } as MessageEvent<SqlResponse>)
    })
  }
  terminate() {
    this.terminated = true
  }
}

const table = { names: ['a'], types: ['text' as const], rows: [['1']] }
let workers: FakeWorker[]
const session = (timeout = 50) => new SqlSession(() => (workers.push(new FakeWorker()), workers.at(-1) as unknown as Worker), timeout)
beforeEach(() => {
  workers = []
})
afterEach(() => vi.useRealTimers())

describe('SqlSession', () => {
  it('starts no worker until a query is asked, then loads the table once and runs the queries', async () => {
    const s = session()
    s.setTable(table)
    expect(workers).toHaveLength(0)
    expect(await s.query('SELECT 1')).toEqual({ ok: true, result: { columns: ['a'], rows: [['1']], more: false } })
    await s.query('SELECT 2')
    expect(workers).toHaveLength(1)
    expect(workers[0].sent.map((m) => m.type)).toEqual(['load', 'query', 'query'])
  })
  it('loads the table again when it changed', async () => {
    const s = session()
    s.setTable(table)
    await s.query('SELECT 1')
    s.setTable({ ...table, rows: [['2']] })
    await s.query('SELECT 1')
    expect(workers[0].sent.map((m) => m.type)).toEqual(['load', 'query', 'load', 'query'])
  })
  it('ends the worker of a query that takes too long, and starts another for the next', async () => {
    const s = session(20)
    s.setTable(table)
    // The first worker never answers.
    const slow = s.query('SELECT slow')
    workers[0].reply = false
    expect(await slow).toEqual({ ok: false, error: 'timeout', message: undefined })
    expect(workers[0].terminated).toBe(true)
    expect((await s.query('SELECT 1')).ok).toBe(true)
    expect(workers).toHaveLength(2)
  })
})
