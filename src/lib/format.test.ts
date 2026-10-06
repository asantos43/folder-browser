import { describe, expect, it } from 'vitest'
import { shortDate } from './format.ts'

describe('shortDate', () => {
  const now = new Date(2026, 9, 6, 15, 30)
  const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).toISOString()
  it('says the time for today, the day and month for this year, and the year too for an earlier one', () => {
    expect(shortDate(local(2026, 9, 6, 9, 5), 'en', now)).toMatch(/^9:05\s?AM$/)
    expect(shortDate(local(2026, 2, 14), 'en', now)).toBe('Mar 14')
    expect(shortDate(local(2024, 11, 25), 'en', now)).toBe('Dec 25, 2024')
  })
  it('follows the language', () => {
    expect(shortDate(local(2026, 2, 14), 'pt-BR', now)).toMatch(/^14 de mar\.?$/)
    expect(shortDate(local(2026, 9, 6, 9, 5), 'pt-BR', now)).toBe('09:05')
  })
  it('is empty for what is not a date, and for the beginning of time (a file the system did not date)', () => {
    expect(shortDate('', 'en', now)).toBe('')
    expect(shortDate('nonsense', 'en', now)).toBe('')
    expect(shortDate(new Date(0).toISOString(), 'en', now)).toBe('')
  })
  it('does not call yesterday evening today', () => {
    expect(shortDate(local(2026, 9, 5, 23, 59), 'en', now)).toBe('Oct 5')
  })
})
