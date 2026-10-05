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
