/** The tabs visited, in order, and where the user is in them: what Go Back and Go Forward (the arrows of the title bar) walk through. */
export interface History {
  list: string[]
  at: number
}

export const emptyHistory: History = { list: [], at: -1 }
const LIMIT = 50

/** A tab came to the front: it is added after the current place, and what was ahead is forgotten, as in a browser. */
export function visit(history: History, key: string): History {
  if (history.list[history.at] === key) return history
  const list = [...history.list.slice(0, history.at + 1), key].slice(-LIMIT)
  return { list, at: list.length - 1 }
}

/** Where a step of `direction` goes: the nearest place that is still open and is not the tab on screen, or null. */
export function step(history: History, direction: 1 | -1, open: ReadonlySet<string>, active: string | null): number | null {
  for (let i = history.at + direction; i >= 0 && i < history.list.length; i += direction) {
    if (open.has(history.list[i]) && history.list[i] !== active) return i
  }
  return null
}
