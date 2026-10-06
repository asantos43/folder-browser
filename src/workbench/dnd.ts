import { useSyncExternalStore } from 'react'

/** What a tab says when it is dragged (its key), and what a file of the tree says (a `DraggedFile` as JSON): the editor's drop zones and the tabs read them. */
export const TAB_DRAG = 'application/x-wsnp-tab'
export const FILE_DRAG = 'application/x-folder-browser-file'

/** A file of the tree that is being dragged: the root it is in, its path there, and what is needed to open it (its name and size). */
export interface DraggedFile {
  rootId: string
  path: string
  name: string
  size: number
}

/** What is being dragged, when it is a tab or a file of the tree: the editor groups show where it can be dropped (a layer over each of them, which a frame under it cannot take the events from). */
let current: 'tab' | 'file' | null = null
/** The key of the tab being dragged (the data of a drag cannot be read before the drop). */
let tabKey: string | undefined
const listeners = new Set<() => void>()
const set = (next: 'tab' | 'file' | null, key?: string) => {
  tabKey = key
  if (current === next) return
  current = next
  listeners.forEach((l) => l())
}
export const dragging = {
  start: (kind: 'tab' | 'file', key?: string) => set(kind, key),
  end: () => set(null),
  get: () => current,
  tab: () => tabKey,
  use: () => useSyncExternalStore((listener) => (listeners.add(listener), () => void listeners.delete(listener)), () => current),
}
// A drag whose source went away (a tab that moved to another group is drawn again) never says it ended: a drop, or the end of any drag, does.
if (typeof window !== 'undefined') {
  window.addEventListener('dragend', () => set(null), true)
  window.addEventListener('drop', () => set(null), true)
}

/** The file a drag carries, when it carries one (what the tree set), checked for its shape. */
export function draggedFile(data: DataTransfer): DraggedFile | null {
  try {
    const raw = JSON.parse(data.getData(FILE_DRAG)) as Partial<DraggedFile>
    return typeof raw.rootId === 'string' && typeof raw.path === 'string' && typeof raw.name === 'string' && typeof raw.size === 'number' ? { rootId: raw.rootId, path: raw.path, name: raw.name, size: raw.size } : null
  } catch {
    return null
  }
}
