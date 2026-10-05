export interface FindOptions {
  caseSensitive: boolean
}

/** How many matches there are, and which one is current (1 for the first; 0 when there is none). */
export interface FindState {
  count: number
  index: number
}

/** A target whose answers are at hand (the editor, plain HTML): the views that have to ask another process answer later. */
export type SyncFindTarget = Omit<FindTarget, 'search' | 'step'> & { search(query: string, options: FindOptions): FindState; step(direction: 1 | -1): FindState }

export const NONE: FindState = { count: 0, index: 0 }

/** What Find needs of a view: a search from the top, stepping between matches, and letting go. Each kind of view has its own (the editor, the PDF, a page, plain HTML). */
export interface FindTarget {
  search(query: string, options: FindOptions): FindState | Promise<FindState>
  step(direction: 1 | -1): FindState | Promise<FindState>
  clear(): void
  /** The text selected in the view, when the browser's own selection cannot tell (a virtualised editor). */
  selectedText?(): string
  /** Selects all the text of the view (the editor draws only some lines, so the page's own Select All would not reach the rest). */
  selectAll?(): void
}

/** Where the positions of `needle` in `text` are (not overlapping), at most `cap`. */
export function indexesOf(text: string, needle: string, caseSensitive: boolean, cap = 100_000): number[] {
  if (!needle) return []
  const hay = caseSensitive ? text : text.toLowerCase()
  const find = caseSensitive ? needle : needle.toLowerCase()
  const found: number[] = []
  for (let at = hay.indexOf(find); at >= 0 && found.length < cap; at = hay.indexOf(find, at + find.length)) found.push(at)
  return found
}

export const wrap = (index: number, count: number): number => ((index % count) + count) % count

/** The view of the file on screen that Find and Copy act on: the source editor or the PDF registers itself while it is shown. */
let current: FindTarget | null = null
export const fileTarget = {
  set(target: FindTarget): () => void {
    current = target
    return () => {
      if (current === target) current = null
    }
  },
  get: (): FindTarget | null => current,
}
