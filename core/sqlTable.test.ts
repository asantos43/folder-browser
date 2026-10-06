import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkQuery, loadTable, runQuery } from './sqlTable.ts'
import { inferTypes } from './table.ts'

describe('checkQuery', () => {
  it('lets one SELECT or WITH through, without its closing semicolon', () => {
    expect(checkQuery('SELECT * FROM t')).toEqual({ ok: true, sql: 'SELECT * FROM t' })
    expect(checkQuery('  select 1 ; ')).toEqual({ ok: true, sql: '  select 1 ' })
    expect(checkQuery('WITH a AS (SELECT 1) SELECT * FROM a')).toMatchObject({ ok: true })
    expect(checkQuery('(SELECT 1) UNION (SELECT 2)')).toMatchObject({ ok: false, error: 'notSelect' })
    expect(checkQuery('-- count\nSELECT count(*) FROM t -- all\n;')).toMatchObject({ ok: true })
  })
  it('does not take a semicolon in a text or a name for the end', () => {
    expect(checkQuery("SELECT * FROM t WHERE a = 'x;y'")).toMatchObject({ ok: true })
    expect(checkQuery('SELECT "a;b" FROM t')).toMatchObject({ ok: true })
    expect(checkQuery("SELECT 'it''s; fine'")).toMatchObject({ ok: true })
    expect(checkQuery('SELECT [a;b] FROM t')).toMatchObject({ ok: true })
    expect(checkQuery('SELECT 1 /* ; */')).toMatchObject({ ok: true })
  })
  it('refuses several statements, and anything that is not a SELECT', () => {
    expect(checkQuery('SELECT 1; SELECT 2')).toEqual({ ok: false, error: 'several' })
    expect(checkQuery('SELECT 1; DROP TABLE t')).toEqual({ ok: false, error: 'several' })
    expect(checkQuery("SELECT 1; 'x'")).toEqual({ ok: false, error: 'several' })
    expect(checkQuery('DELETE FROM t')).toEqual({ ok: false, error: 'notSelect' })
    expect(checkQuery('PRAGMA query_only = OFF')).toEqual({ ok: false, error: 'notSelect' })
    expect(checkQuery('ATTACH DATABASE "x" AS y')).toEqual({ ok: false, error: 'notSelect' })
    expect(checkQuery('')).toEqual({ ok: false, error: 'empty' })
    expect(checkQuery(' ; -- nothing')).toEqual({ ok: false, error: 'empty' })
  })
})

describe('the table in SQLite', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>
  beforeAll(async () => {
    SQL = await initSqlJs()
  })
  const body = [['Gull', '12', '2024-01-05'], ['Heron', '8', '2024-02-10'], ['Tern', '', '2023-12-31'], ['Auk', '100', ''], ['Odd "one"', '5', '2024-03-01']]
  const names = ['Boat', 'Seats', 'Day']
  const make = () => {
    const db = new SQL.Database()
    loadTable(db, names, inferTypes(body, 3), body)
    return db
  }
  it('answers WHERE, ORDER BY, LIKE and aggregates, with numbers as numbers', () => {
    const db = make()
    expect(runQuery(db, 'SELECT Boat FROM t WHERE Seats > 9 ORDER BY Seats DESC').rows).toEqual([['Auk'], ['Gull']])
    expect(runQuery(db, "SELECT Boat FROM t WHERE Boat LIKE 'h%'").rows).toEqual([['Heron']])
    expect(runQuery(db, 'SELECT count(*), sum(Seats), avg(Seats), min(Day) FROM t').rows).toEqual([['5', '125', '31.25', '2023-12-31']])
    expect(runQuery(db, 'SELECT Boat FROM t WHERE Seats IS NULL').rows).toEqual([['Tern']])
    expect(runQuery(db, 'SELECT "Boat" FROM t WHERE Boat = \'Odd "one"\'').rows).toEqual([['Odd "one"']])
  })
  it('gives the columns, NULL as an empty cell, and says when there are more rows than the limit', () => {
    const db = make()
    const all = runQuery(db, 'SELECT Boat, Seats FROM t ORDER BY rowid')
    expect(all.columns).toEqual(['Boat', 'Seats'])
    expect(all.rows[2]).toEqual(['Tern', ''])
    expect(runQuery(db, 'SELECT * FROM t', 2)).toMatchObject({ more: true })
    expect(runQuery(db, 'SELECT * FROM t', 2).rows).toHaveLength(2)
    expect(runQuery(db, 'SELECT * FROM t', 5).more).toBe(false)
  })
  it('says what SQLite says when the statement is wrong', () => {
    const db = make()
    expect(() => runQuery(db, 'SELECT nope FROM t')).toThrow(/no such column/)
    expect(() => runQuery(db, 'SELECT * FROM missing')).toThrow(/no such table/)
  })
  it('cannot be written to, whatever the statement says', () => {
    const db = make()
    expect(() => runQuery(db, 'DELETE FROM t')).toThrow(/readonly|read-only/i)
    expect(() => runQuery(db, "WITH x AS (SELECT 1) INSERT INTO t VALUES ('a','1','b')")).toThrow()
    expect(runQuery(db, 'SELECT count(*) FROM t').rows).toEqual([['5']])
  })
})
