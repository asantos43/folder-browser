import { describe, expect, it } from 'vitest'
import { fuzzyScore } from './fuzzy.ts'

describe('fuzzyScore', () => {
  it('matches letters in order, and nothing else', () => {
    expect(fuzzyScore('rdm', 'readme.txt')).not.toBeNull()
    expect(fuzzyScore('mdr', 'readme.txt')).toBeNull()
    expect(fuzzyScore('zzz', 'readme.txt')).toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
  it('ranks the start of the name first, then a word, then the middle, then scattered letters', () => {
    const score = (q: string, t: string) => fuzzyScore(q, t) as number
    expect(score('read', 'readme.txt')).toBeGreaterThan(score('me', 'readme.txt') - 1)
    expect(score('txt', 'docs/readme.txt')).toBeGreaterThan(score('rdt', 'docs/readme.txt'))
    expect(score('read', 'readme.txt')).toBeGreaterThan(score('read', 'unreadable.txt'))
    expect(score('data', 'data.json')).toBeGreaterThan(score('data', 'my-data.json'))
    expect(score('data', 'my-data.json')).toBeGreaterThan(score('data', 'mydata.json'))
  })
  it('ignores the case', () => {
    expect(fuzzyScore('README', 'readme.txt')).toBe(fuzzyScore('readme', 'README.TXT'))
  })
})
