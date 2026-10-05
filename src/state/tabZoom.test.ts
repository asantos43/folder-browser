import { describe, expect, it } from 'vitest'
import { pruneZooms, stepTabZoom, tabZoomOf, TAB_LIMITS } from './tabZoom.ts'

describe('the zoom of a tab', () => {
  it('goes by the steps of a browser, up and down, inside 25 % and 500 %', () => {
    expect(stepTabZoom(1, 1)).toBe(1.1)
    expect(stepTabZoom(1.1, 1)).toBe(1.25)
    expect(stepTabZoom(1, -1)).toBe(0.9)
    expect(stepTabZoom(0.25, -1)).toBe(TAB_LIMITS.min)
    expect(stepTabZoom(5, 1)).toBe(TAB_LIMITS.max)
    expect([1, 1.1, 1.25, 1.5, 1.75, 2, 3, 4, 5].every((z, i, all) => i === 0 || stepTabZoom(all[i - 1], 1) === z)).toBe(true)
  })
  it('is 100 % for a tab that has none, and never outside its limits', () => {
    expect(tabZoomOf({}, 'a')).toBe(1)
    expect(tabZoomOf({ a: 2 }, 'a')).toBe(2)
    expect(tabZoomOf({ a: 99 }, 'a')).toBe(5)
    expect(tabZoomOf({ a: 2 }, null)).toBe(1)
  })
  it('forgets the zoom of a tab that is closed, and one that is back at 100 %, and keeps the object when nothing changes', () => {
    const zooms = { a: 2, b: 1.5, c: 1 }
    expect(pruneZooms(zooms, new Set(['a', 'c']))).toEqual({ a: 2 })
    const same = { a: 2 }
    expect(pruneZooms(same, new Set(['a']))).toBe(same)
  })
})
