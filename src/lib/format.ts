import type { Language } from '@/i18n/index.ts'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function formatDate(iso: string, language: Language): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** The last part of a path, with either kind of slash. */
export const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/**
 * A date for a narrow place, as a file manager writes it: the time when it is today, the day and the month when it is this year, with the year when it is not. (The full date
 * is for a tooltip: `formatDate`.) `now` is a parameter so that the answer can be tested.
 */
export function shortDate(iso: string, language: Language, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return ''
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  if (sameDay) return new Intl.DateTimeFormat(language, { timeStyle: 'short' }).format(date)
  if (date.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(date)
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}
