import { describe, expect, it } from 'vitest'
import { emptyHistory, step, visit, type History } from './history.ts'

const walk = (...keys: string[]): History => keys.reduce(visit, emptyHistory)

describe('history of the tabs visited', () => {
  it('adds each tab that comes to the front after the current place, and ignores the one already there', () => {
    expect(walk('a', 'b', 'c')).toEqual({ list: ['a', 'b', 'c'], at: 2 })
    expect(walk('a', 'a')).toEqual({ list: ['a'], at: 0 })
  })
  it('forgets what was ahead when a new tab is visited from the middle, as a browser does', () => {
    const back = { ...walk('a', 'b', 'c'), at: 0 }
    expect(visit(back, 'd')).toEqual({ list: ['a', 'd'], at: 1 })
  })
  it('keeps only the last fifty', () => {
    const many = walk(...Array.from({ length: 70 }, (_, i) => `t${i}`))
    expect(many.list).toHaveLength(50)
    expect(many.list[0]).toBe('t20')
    expect(many.at).toBe(49)
  })
  it('steps to the nearest place that is still open and not the tab on screen', () => {
    const h = walk('a', 'b', 'c', 'd')
    const all = new Set(['a', 'b', 'c', 'd'])
    expect(step(h, -1, all, 'd')).toBe(2)
    expect(step(h, 1, all, 'd')).toBeNull()
    expect(step(h, -1, new Set(['a', 'd']), 'd')).toBe(0)
    expect(step(h, -1, new Set(['d']), 'd')).toBeNull()
    expect(step({ ...h, at: 1 }, 1, all, 'b')).toBe(2)
  })
  it('skips a tab that was closed, and an earlier visit to the tab that is on screen', () => {
    const h = walk('a', 'b', 'a', 'c')
    expect(step({ ...h, at: 3 }, -1, new Set(['a', 'c']), 'c')).toBe(2)
    expect(step({ ...h, at: 2 }, -1, new Set(['a', 'b']), 'a')).toBe(1)
    expect(step({ ...h, at: 1 }, -1, new Set(['a', 'b']), 'b')).toBe(0)
  })
  it('has nowhere to go from nothing', () => {
    expect(step(emptyHistory, -1, new Set(), null)).toBeNull()
    expect(step(emptyHistory, 1, new Set(['a']), null)).toBeNull()
  })
})
