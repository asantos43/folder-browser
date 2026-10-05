/** Folders first, then each group in name order with numbers as numbers (`file2` before `file10`), as VS Code's Explorer sorts. */
export function sortEntries<T extends { name: string; kind: string }>(entries: T[]): T[] {
  const rank = (e: T) => (e.kind === 'dir' ? 0 : 1)
  return entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
