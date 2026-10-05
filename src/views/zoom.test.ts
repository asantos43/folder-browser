import { describe, expect, it } from 'vitest'
import { anchoredScroll, clampZoom, formatPercent, IMAGE_LIMITS, parsePercent, PDF_LIMITS, resolveScale, stepZoom, wheelZoom } from './zoom.ts'

describe('stepZoom', () => {
  it('goes to the next step, up and down', () => {
    expect(stepZoom(1, 1, IMAGE_LIMITS)).toBe(1.1)
    expect(stepZoom(1, -1, IMAGE_LIMITS)).toBe(0.9)
    expect(stepZoom(0.5, 1, PDF_LIMITS)).toBe(0.67)
  })
  it('goes to the nearer step from a scale between two', () => {
    expect(stepZoom(1.3, 1, IMAGE_LIMITS)).toBe(1.5)
    expect(stepZoom(1.3, -1, IMAGE_LIMITS)).toBe(1.25)
  })
  it('stops at the limits', () => {
    expect(stepZoom(4, 1, PDF_LIMITS)).toBe(4)
    expect(stepZoom(0.25, -1, PDF_LIMITS)).toBe(0.25)
    expect(stepZoom(16, 1, IMAGE_LIMITS)).toBe(16)
    expect(stepZoom(0.05, -1, IMAGE_LIMITS)).toBe(0.05)
  })
})

describe('resolveScale', () => {
  const content = { width: 1000, height: 500 }
  const room = { width: 500, height: 400 }
  it('keeps a number, inside the limits', () => {
    expect(resolveScale(2, content, room, IMAGE_LIMITS)).toBe(2)
    expect(resolveScale(100, content, room, IMAGE_LIMITS)).toBe(16)
    expect(resolveScale(0, content, room, PDF_LIMITS)).toBe(0.25)
  })
  it('fits the width, or the whole page', () => {
    expect(resolveScale('fit-width', content, room, IMAGE_LIMITS)).toBe(0.5)
    expect(resolveScale('fit-page', { width: 100, height: 800 }, room, IMAGE_LIMITS)).toBe(0.5)
    expect(resolveScale('fit-page', { width: 100, height: 100 }, room, IMAGE_LIMITS)).toBe(4)
  })
  it('keeps room around the content when asked', () => {
    expect(resolveScale('fit-width', { width: 100, height: 100 }, { width: 140, height: 140 }, IMAGE_LIMITS, 20)).toBe(1)
  })
  it('"auto" fits but never enlarges', () => {
    expect(resolveScale('auto', content, room, IMAGE_LIMITS)).toBe(0.5)
    expect(resolveScale('auto', { width: 10, height: 10 }, room, IMAGE_LIMITS)).toBe(1)
  })
  it('does not divide by nothing', () => {
    expect(resolveScale('fit-width', { width: 0, height: 0 }, room, IMAGE_LIMITS)).toBe(1)
    expect(resolveScale('fit-page', content, { width: 0, height: 0 }, IMAGE_LIMITS, 10)).toBe(1)
  })
})

describe('the zoom box and the wheel', () => {
  it('reads what a person types', () => {
    expect(parsePercent('150', IMAGE_LIMITS)).toBe(1.5)
    expect(parsePercent(' 75 % ', IMAGE_LIMITS)).toBe(0.75)
    expect(parsePercent('12.5%', IMAGE_LIMITS)).toBe(0.125)
    expect(parsePercent('99999', IMAGE_LIMITS)).toBe(16)
    for (const bad of ['', 'abc', '-50', '0', '1,5', '50 pct']) expect(parsePercent(bad, IMAGE_LIMITS), bad).toBeNull()
  })
  it('shows a scale as a percentage', () => {
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(0.333)).toBe('33%')
    expect(formatPercent(1.256)).toBe('126%')
  })
  it('zooms smoothly with the wheel, in and out by the same amount, inside the limits', () => {
    const up = wheelZoom(1, -100, IMAGE_LIMITS)
    expect(up).toBeGreaterThan(1)
    expect(wheelZoom(up, 100, IMAGE_LIMITS)).toBeCloseTo(1)
    expect(wheelZoom(15.9, -10_000, IMAGE_LIMITS)).toBe(16)
    expect(clampZoom(0.001, PDF_LIMITS)).toBe(0.25)
  })
  it('keeps the point under the pointer where it was', () => {
    // 200 px into the content at scroll 100 and pointer 50: after doubling, the same point is at the same place on screen.
    expect(anchoredScroll(100, 50, 2)).toBe(250)
    expect(anchoredScroll(0, 0, 3)).toBe(0)
  })
})
