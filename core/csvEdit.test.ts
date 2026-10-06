import { describe, expect, it } from 'vitest'
import { parseDelimited } from './csv.ts'
import { applyChanges, deleteColumn, deleteRow, encodeCell, insertColumn, insertRow, setCell, toDelimited } from './csvEdit.ts'

const parse = (text: string, d = ',') => parseDelimited(text, d, { spans: true })

describe('spans', () => {
  it('say where each cell and row is, quotes inside', () => {
    const text = 'a,"b,c"\r\nd,\n'
    const t = parse(text)
    expect(t.spans).toEqual([[0, 1, 2, 7], [9, 10, 11, 11]])
    expect(t.rowAt).toEqual([{ from: 0, to: 7, next: 9 }, { from: 9, to: 11, next: 12 }])
    expect(text.slice(2, 7)).toBe('"b,c"')
  })
  it('know a last line with no break, and a byte order mark', () => {
    const t = parse('﻿a,b\n1,2')
    expect(t.spans).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]])
    expect(t.rowAt![1]).toEqual({ from: 5, to: 8, next: 8 })
  })
})

describe('encodeCell', () => {
  it('quotes only what needs it', () => {
    expect(encodeCell('plain', ',')).toBe('plain')
    expect(encodeCell('a,b', ',')).toBe('"a,b"')
    expect(encodeCell('say "hi"', ',')).toBe('"say ""hi"""')
    expect(encodeCell('two\nlines', ',')).toBe('"two\nlines"')
    expect(encodeCell(' pad', ',')).toBe('" pad"')
    expect(encodeCell('a,b', ';')).toBe('a,b')
    expect(encodeCell('', ',')).toBe('')
  })
})

describe('setCell', () => {
  it('replaces one cell and leaves every other byte alone', () => {
    const text = 'a,"b,c",d\r\n1,2,3\r\n'
    const out = applyChanges(text, [setCell(parse(text), ',', 0, 1, 'x')])
    expect(out).toBe('a,x,d\r\n1,2,3\r\n')
  })
  it('quotes a value that needs it, and unquotes one that does not', () => {
    const text = 'a,"b,c"\n'
    expect(applyChanges(text, [setCell(parse(text), ',', 0, 0, 'p,q')])).toBe('"p,q","b,c"\n')
    expect(applyChanges(text, [setCell(parse(text), ',', 0, 1, 'plain')])).toBe('a,plain\n')
  })
  it('pads a row that is shorter than the column', () => {
    const text = 'a,b,c\n1\n'
    expect(applyChanges(text, [setCell(parse(text), ',', 1, 2, 'z')])).toBe('a,b,c\n1,,z\n')
  })
  it('works on a last row with no break, and on a TSV', () => {
    const text = 'a\tb\n1\t2'
    expect(applyChanges(text, [setCell(parse(text, '\t'), '\t', 1, 1, 'x\ty')])).toBe('a\tb\n1\t"x\ty"')
  })
})

describe('rows', () => {
  it('inserts an empty row as wide as the table, before a row or at the end', () => {
    const text = 'a,b,c\n1,2,3\n'
    expect(applyChanges(text, [insertRow(parse(text), ',', 1, 3, text)])).toBe('a,b,c\n,,\n1,2,3\n')
    expect(applyChanges(text, [insertRow(parse(text), ',', 2, 3, text)])).toBe('a,b,c\n1,2,3\n,,\n')
    const open = 'a,b\n1,2'
    expect(applyChanges(open, [insertRow(parse(open), ',', 2, 2, open)])).toBe('a,b\n1,2\n,')
  })
  it('a row of one column is an empty line that a line break ends', () => {
    const text = 'a\nb'
    const out = applyChanges(text, [insertRow(parse(text), ',', 2, 1, text)])
    expect(parse(out).rows).toEqual([['a'], ['b'], ['']])
  })
  it('deletes a row with its break; the last row with the break before it', () => {
    const text = 'a,b\n1,2\n3,4\n'
    expect(applyChanges(text, [deleteRow(parse(text), 1)])).toBe('a,b\n3,4\n')
    expect(applyChanges(text, [deleteRow(parse(text), 0)])).toBe('1,2\n3,4\n')
    const open = 'a,b\n1,2'
    expect(applyChanges(open, [deleteRow(parse(open), 1)])).toBe('a,b')
    expect(applyChanges('x', [deleteRow(parse('x'), 0)])).toBe('')
  })
  it('deletes a row of several lines in a quoted cell', () => {
    const text = 'a,b\n"x\ny",2\nc,d\n'
    expect(applyChanges(text, [deleteRow(parse(text), 1)])).toBe('a,b\nc,d\n')
  })
})

describe('columns', () => {
  it('inserts an empty column before a column and after the last', () => {
    const text = 'a,b\n1,2\n'
    expect(applyChanges(text, insertColumn(parse(text), ',', 1))).toBe('a,,b\n1,,2\n')
    expect(applyChanges(text, insertColumn(parse(text), ',', 0))).toBe(',a,b\n,1,2\n')
    expect(applyChanges(text, insertColumn(parse(text), ',', 2))).toBe('a,b,\n1,2,\n')
  })
  it('deletes a column with its delimiter, in every row that has it', () => {
    const text = 'a,b,c\n1,"2,x",3\n4\n'
    expect(applyChanges(text, deleteColumn(parse(text), 1))).toBe('a,c\n1,3\n4\n')
    expect(applyChanges(text, deleteColumn(parse(text), 2))).toBe('a,b\n1,"2,x"\n4\n')
    expect(applyChanges(text, deleteColumn(parse(text), 0))).toBe('b,c\n"2,x",3\n\n')
  })
})

describe('toDelimited', () => {
  it('writes the header and the rows, quoting what needs it', () => {
    expect(toDelimited(['a', 'b'], [['1', 'x,y'], ['2', 'say "hi"']], ',')).toBe('a,b\n1,"x,y"\n2,"say ""hi"""\n')
    expect(toDelimited(undefined, [['1', '2']], '\t')).toBe('1\t2\n')
    expect(parseDelimited(toDelimited(['a'], [['two\nlines']], ','), ',').rows).toEqual([['a'], ['two\nlines']])
  })
})
