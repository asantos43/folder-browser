import { describe, expect, it } from 'vitest'
import { innerPath, isInner, listingsAbove, partsOf, trailOf } from './vpath.ts'

describe('the path of a file in a ZIP', () => {
  it('joins and splits at !/ and tells the folder levels of a trail', () => {
    expect(innerPath('a.zip', 'x/y.txt')).toBe('a.zip!/x/y.txt')
    expect(partsOf('a.zip!/b.zip!/c')).toEqual(['a.zip', 'b.zip', 'c'])
    expect(isInner('a.zip!/c')).toBe(true)
    expect(isInner('a/c')).toBe(false)
    expect(trailOf('a/b.zip!/c/d.txt')).toEqual(['a', 'b.zip', 'c', 'd.txt'])
  })
})

describe('listingsAbove', () => {
  it('lists the folders and ZIP files above a file, outermost first', () => {
    expect(listingsAbove('a.txt')).toEqual([])
    expect(listingsAbove('docs/deep/a.txt')).toEqual(['docs', 'docs/deep'])
    expect(listingsAbove('a/b.zip!/c/d.txt')).toEqual(['a', 'a/b.zip', 'a/b.zip!/c'])
    expect(listingsAbove('p.zip!/in.zip!/x.txt')).toEqual(['p.zip', 'p.zip!/in.zip'])
  })
})
