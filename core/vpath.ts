/**
 * A file inside a ZIP inside a snapshot has a path of its own: the ZIP's path, `!/`, the entry's name (`assets/files/a.zip!/docs/readme.txt`),
 * and a ZIP inside that ZIP goes on the same way. A file of the snapshot that really has `!/` in its name is taken as itself first.
 */
export const INNER = '!/'
export const MAX_DEPTH = 4

export const innerPath = (outer: string, entry: string): string => `${outer}${INNER}${entry}`

/** The parts of a path: the file of the snapshot, then the entries to open one inside the other. */
export const partsOf = (path: string): string[] => path.split(INNER)

export const isInner = (path: string): boolean => path.includes(INNER)

/** What a breadcrumb trail shows for a path: a folder level for every `/`, the ZIP's name then its entry's path for every `!/`. */
export const trailOf = (path: string): string[] => partsOf(path).flatMap((part) => part.split('/').filter(Boolean))

/**
 * The listings that must be open for a file to be visible in a tree that opens folders and ZIP files one by one: every folder above it, and every ZIP it is in,
 * outermost first. `a/b.zip!/c/d.txt` needs `a`, `a/b.zip` and `a/b.zip!/c`.
 */
export function listingsAbove(path: string): string[] {
  const parts = partsOf(path)
  const out: string[] = []
  let base = ''
  parts.forEach((part, i) => {
    const segments = part.split('/')
    segments.forEach((_, j) => {
      if (i === parts.length - 1 && j === segments.length - 1) return
      out.push(base + segments.slice(0, j + 1).join('/'))
    })
    base += `${part}${INNER}`
  })
  return out
}
