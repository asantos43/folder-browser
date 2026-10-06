import { describe, expect, it } from 'vitest'
import { rangeBetween, topmost } from './selection.ts'

describe('topmost', () => {
  it('leaves out what is in a folder or ZIP that is also in the list, keeping the order', () => {
    expect(topmost(['docs/a.txt', 'docs', 'b.txt'])).toEqual(['docs', 'b.txt'])
    expect(topmost(['p.zip!/x/y.txt', 'p.zip', 'p.zip!/x'])).toEqual(['p.zip'])
    expect(topmost(['p.zip!/x/y.txt', 'p.zip!/x', 'q.txt'])).toEqual(['p.zip!/x', 'q.txt'])
  })
  it('does not take a name that only starts like another for being in it, and drops repeats', () => {
    expect(topmost(['docs', 'docs2/a.txt', 'docs', 'docs.txt'])).toEqual(['docs', 'docs2/a.txt', 'docs.txt'])
    expect(topmost([])).toEqual([])
  })
})

describe('rangeBetween', () => {
  const rows = ['a', 'b', 'c', 'd', 'e']
  it('is the rows from one to the other, both included, either way round', () => {
    expect(rangeBetween(rows, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeBetween(rows, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeBetween(rows, 'c', 'c')).toEqual(['c'])
  })
  it('is only the row asked for when the start is not on screen, and nothing when the row is not', () => {
    expect(rangeBetween(rows, null, 'c')).toEqual(['c'])
    expect(rangeBetween(rows, 'zz', 'c')).toEqual(['c'])
    expect(rangeBetween(rows, 'a', 'zz')).toEqual([])
  })
})
