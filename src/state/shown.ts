import { createGroupSlot } from './groups.ts'

/** The text the source tab on screen shows (laid out or as saved), for Print: the tab registers it while it is shown (in the group it is in). */
const slot = createGroupSlot<() => string>()
export const shownText = {
  set: (read: () => string, group?: 0 | 1): (() => void) => slot.set(read, group),
  get: (): string | null => slot.get()?.() ?? null,
}
