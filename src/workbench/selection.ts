import { isUnder } from '@/state/workspace.ts'

/**
 * What an action on several rows is done to: a row whose folder (or ZIP file) is marked too is left out, since the action on the folder covers it
 * (deleting a folder and a file in it, or moving both, is the folder alone). Order is kept.
 */
export function topmost(paths: readonly string[]): string[] {
  const unique = [...new Set(paths)]
  return unique.filter((path) => !unique.some((other) => other !== path && isUnder(path, other)))
}

/** The paths from `from` to `to`, both included, in the order of the rows on screen (either way round); just `to` when `from` is not on screen. */
export function rangeBetween(rows: readonly string[], from: string | null, to: string): string[] {
  const a = from === null ? -1 : rows.indexOf(from)
  const b = rows.indexOf(to)
  if (b < 0) return []
  if (a < 0) return [to]
  return rows.slice(Math.min(a, b), Math.max(a, b) + 1)
}
