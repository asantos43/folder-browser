/** What a folder can be ordered by. */
export type SortKey = 'name' | 'modified' | 'size'

interface Sortable {
  name: string
  kind: string
  size?: number
  /** ISO 8601. */
  modified?: string
}

const byName = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0)

/**
 * The order of the rows of a folder: folders first, always, then each group by the key. By name, numbers count as numbers (`file2` before `file10`) and case does not matter.
 * By date, the newest last (or first, when descending); by size, the smallest first (a folder has no size: folders stay in name order). A tie is settled by the name.
 * `descending` turns the key round, not the folders-first rule.
 */
export function compareEntries(key: SortKey = 'name', descending = false): (a: Sortable, b: Sortable) => number {
  const sign = descending ? -1 : 1
  const rank = (e: Sortable) => (e.kind === 'dir' ? 0 : 1)
  return (a, b) => {
    const group = rank(a) - rank(b)
    if (group) return group
    if (key === 'modified') {
      const t = (a.modified ?? '').localeCompare(b.modified ?? '')
      if (t) return sign * t
    } else if (key === 'size' && a.kind !== 'dir') {
      const s = (a.size ?? 0) - (b.size ?? 0)
      if (s) return sign * s
    }
    // Names go the way the key goes, except that a folder (which size does not tell apart) is in name order whatever.
    const n = byName(a.name, b.name)
    return key === 'name' ? sign * n : key === 'size' && a.kind === 'dir' ? n : sign * n
  }
}

/** Folders first and each level in name order, as VS Code's Explorer sorts (the order the main process lists in). */
export function sortEntries<T extends Sortable>(entries: T[]): T[] {
  return entries.sort(compareEntries('name', false))
}
