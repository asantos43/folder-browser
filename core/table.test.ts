import { describe, expect, it } from 'vitest'
import { columnNames, compareValues, distinctValues, findCells, inferTypes, passes, toDate, toNumber, visibleRows } from './table.ts'

describe('values', () => {
  it('reads numbers as people write them', () => {
    expect(toNumber('12')).toBe(12)
    expect(toNumber(' -3.5 ')).toBe(-3.5)
    expect(toNumber('1,5')).toBe(1.5)
    expect(toNumber('1,234.50')).toBe(1234.5)
    expect(toNumber('1e3')).toBe(1000)
    expect(toNumber('12abc')).toBeNull()
    expect(toNumber('')).toBeNull()
  })
  it('reads ISO dates', () => {
    expect(toDate('2024-03-01')).toBe(Date.UTC(2024, 2, 1))
    expect(toDate('2024/03/01')).toBe(Date.UTC(2024, 2, 1))
    expect(toDate('2024-03-01 10:30')).not.toBeNull()
    expect(toDate('March 1')).toBeNull()
  })
  it('finds the type of a column from its values, forgiving a stray one', () => {
    const body = [['a', '1', '2024-01-01'], ['b', '2', '2024-02-01'], ['c', '', '2024-03-01'], ['d', 'x', '']]
    expect(inferTypes(body, 3)).toEqual(['text', 'text', 'date'])
    const many = Array.from({ length: 40 }, (_, i) => [String(i)]).concat([['n/a']])
    expect(inferTypes(many, 1)).toEqual(['number'])
    expect(inferTypes([[''], ['']], 1)).toEqual(['text'])
  })
  it('compares by type, with what does not fit after what does', () => {
    expect(compareValues('9', '10', 'number')).toBeLessThan(0)
    expect(compareValues('9', '10', 'text')).toBeLessThan(0) // numeric collation
    expect(compareValues('abc', '5', 'number')).toBeGreaterThan(0)
    expect(compareValues('b', 'A', 'text')).toBeGreaterThan(0)
  })
})

describe('passes', () => {
  it('text operators ignore case', () => {
    expect(passes('Heron', { column: 0, op: 'contains', value: 'ER' }, 'text')).toBe(true)
    expect(passes('Heron', { column: 0, op: 'starts', value: 'he' }, 'text')).toBe(true)
    expect(passes('Heron', { column: 0, op: 'ends', value: 'ON' }, 'text')).toBe(true)
    expect(passes('Heron', { column: 0, op: 'not-contains', value: 'x' }, 'text')).toBe(true)
    expect(passes('Heron', { column: 0, op: 'equals', value: 'heron' }, 'text')).toBe(true)
    expect(passes('Heron', { column: 0, op: 'not-equals', value: 'heron' }, 'text')).toBe(false)
  })
  it('compares numbers as numbers', () => {
    expect(passes('10', { column: 0, op: 'gt', value: '9' }, 'number')).toBe(true)
    expect(passes('10', { column: 0, op: 'lt', value: '9' }, 'text')).toBe(false) // numeric collation, as text
    expect(passes('2.0', { column: 0, op: 'equals', value: '2' }, 'number')).toBe(true)
    expect(passes('', { column: 0, op: 'ge', value: '0' }, 'number')).toBe(false)
  })
  it('knows empty, not empty, and a list of values', () => {
    expect(passes(undefined, { column: 0, op: 'empty', value: '' }, 'text')).toBe(true)
    expect(passes(' ', { column: 0, op: 'empty', value: '' }, 'text')).toBe(true)
    expect(passes('a', { column: 0, op: 'not-empty', value: '' }, 'text')).toBe(true)
    expect(passes('a', { column: 0, op: 'in', value: '', values: ['a', 'b'] }, 'text')).toBe(true)
    expect(passes('c', { column: 0, op: 'in', value: '', values: ['a', 'b'] }, 'text')).toBe(false)
  })
})

describe('visibleRows', () => {
  const body = [['Gull', '12'], ['Heron', '8'], ['Tern', ''], ['Auk', '100']]
  const types = inferTypes(body, 2)
  it('is every row, in order, with no filter and no sort', () => {
    expect(visibleRows(body, { types })).toEqual([0, 1, 2, 3])
  })
  it('sorts by value, keeps empty cells last either way, and is stable', () => {
    expect(visibleRows(body, { types, sort: { column: 1, dir: 'asc' } })).toEqual([1, 0, 3, 2])
    expect(visibleRows(body, { types, sort: { column: 1, dir: 'desc' } })).toEqual([3, 0, 1, 2])
    expect(visibleRows(body, { types, sort: { column: 0, dir: 'asc' } })).toEqual([3, 0, 1, 2])
  })
  it('filters, and sorts what is left', () => {
    expect(visibleRows(body, { types, filters: [{ column: 1, op: 'gt', value: '9' }], sort: { column: 0, dir: 'desc' } })).toEqual([0, 3])
    expect(visibleRows(body, { types, filters: [{ column: 1, op: 'gt', value: '9' }, { column: 0, op: 'contains', value: 'u' }] })).toEqual([0, 3])
  })
})

describe('distinct values and search', () => {
  it('counts the values of a column, most frequent first, and says when there are more', () => {
    const body = [['a'], ['b'], ['a'], ['c'], ['a'], ['b']]
    expect(distinctValues(body, 0)).toEqual([{ value: 'a', count: 3 }, { value: 'b', count: 2 }, { value: 'c', count: 1 }])
    const some = distinctValues(body, 0, 2)
    expect(some).toHaveLength(2)
    expect(some.more).toBe(true)
  })
  it('finds a text in the rows shown, in reading order', () => {
    const body = [['Gull', 'big'], ['Heron', 'bigger'], ['Tern', 'small']]
    expect(findCells(body, [0, 1, 2], 'BIG', false)).toEqual([[0, 1], [1, 1]])
    expect(findCells(body, [0, 1, 2], 'BIG', true)).toEqual([])
    expect(findCells(body, [2, 1], 'e', false)).toEqual([[0, 0], [1, 0], [1, 1]])
    expect(findCells(body, [0, 1, 2], '', false)).toEqual([])
  })
})

describe('columnNames', () => {
  it('uses the header, made unique and never empty, or numbers the columns', () => {
    expect(columnNames(['Boat', '', 'boat'], 4, 'column')).toEqual(['Boat', 'column 2', 'boat 2', 'column 4'])
    expect(columnNames(undefined, 2, 'column')).toEqual(['column 1', 'column 2'])
  })
})
