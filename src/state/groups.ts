import { createContext, useContext, useSyncExternalStore } from 'react'
import type { GroupId } from './workspace.ts'

/** The editor group a view is drawn in (the first, when there is no other): what the view registers itself for. */
export const GroupContext = createContext<GroupId>(0)
export const useGroup = (): GroupId => useContext(GroupContext)

let focused: GroupId = 0
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((l) => l())
const subscribe = (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener))

/** The group that has the focus (the workbench tells it). What Find, Copy, Print and the status bar act on is what the views of this group registered. */
export const focusedGroup = {
  get: (): GroupId => focused,
  set(group: GroupId): void {
    if (focused === group) return
    focused = group
    tell()
  },
}

/**
 * Something that the view on screen registers while it is shown and the rest of the application reads (the Find target, the text to print, the language of the file): one slot
 * for each group, and `get` answers for the group that has the focus.
 */
export function createGroupSlot<T>() {
  const slots = new Map<GroupId, T>()
  return {
    /** The view registers itself; the answer takes it away again (only if it is still the one there). */
    set(value: T, group: GroupId = 0): () => void {
      slots.set(group, value)
      tell()
      return () => {
        if (slots.get(group) === value) {
          slots.delete(group)
          tell()
        }
      }
    },
    get: (): T | null => slots.get(focused) ?? null,
    use: (): T | null => useSyncExternalStore(subscribe, () => slots.get(focused) ?? null),
  }
}
