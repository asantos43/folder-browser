import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseDelimited } from './csv.ts'

describe('parseDelimited', () => {
  it('splits rows and cells', () => {
    expect(parseDelimited('a,b,c\n1,2,3\n', ',').rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('reads CRLF, a last line with no break, and a byte order mark', () => {
    expect(parseDelimited('﻿a,b\r\n1,2', ',').rows).toEqual([['a', 'b'], ['1', '2']])
  })
  it('keeps the delimiter, doubled quotes and line breaks of a quoted cell', () => {
    expect(parseDelimited('name,note\n"Pear, green","say ""hi""\nthere"\n', ',').rows).toEqual([['name', 'note'], ['Pear, green', 'say "hi"\nthere']])
  })
  it('keeps empty cells and short rows, and says how wide the widest is', () => {
    const table = parseDelimited('a,,c\nx\n,\n', ',')
    expect(table.rows).toEqual([['a', '', 'c'], ['x'], ['', '']])
    expect(table.columns).toBe(3)
  })
  it('says nothing for an empty text', () => {
    expect(parseDelimited('', ',')).toEqual({ rows: [], columns: 0, truncated: false })
  })
  it('stops at the limits and says so', () => {
    const many = Array.from({ length: 50 }, (_, i) => `${i},x`).join('\n')
    const rows = parseDelimited(many, ',', { rows: 10 })
    expect(rows.rows).toHaveLength(10)
    expect(rows.truncated).toBe(true)
    const wide = parseDelimited('a,b,c,d,e', ',', { columns: 3 })
    expect(wide.rows[0]).toEqual(['a', 'b', 'c'])
    expect(wide.truncated).toBe(true)
  })
  it('takes tabs and semicolons', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t').rows).toEqual([['a', 'b'], ['1', '2']])
    expect(parseDelimited('a;b\n1,5;2', ';').rows).toEqual([['a', 'b'], ['1,5', '2']])
  })
})

describe('detectDelimiter', () => {
  it('finds the one the lines use most, outside quotes', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('nome;preço\nmaçã;1,5\n')).toBe(';')
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|')
    expect(detectDelimiter('"x,y,z";b\n1;2')).toBe(';')
  })
  it('is a tab for a TSV, and a comma when there is nothing to go by', () => {
    expect(detectDelimiter('a,b', true)).toBe('\t')
    expect(detectDelimiter('just words')).toBe(',')
  })
})
