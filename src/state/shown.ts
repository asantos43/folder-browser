/** The text the source tab on screen shows (laid out or as saved), for Print: the tab registers it while it is shown. */
let current: (() => string) | null = null
export const shownText = {
  set(read: () => string): () => void {
    current = read
    return () => {
      if (current === read) current = null
    }
  },
  get: (): string | null => current?.() ?? null,
}
