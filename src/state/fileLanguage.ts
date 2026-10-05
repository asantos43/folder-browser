import { useSyncExternalStore } from 'react'
import type { Language } from '@core/filekind.ts'

/**
 * The language a user picked for a file whose language the viewer got wrong (the status bar's "Select Language Mode"), by `snapshotId:path`. It lasts as
 * long as the window does: the same file shown again keeps it, and a file is never changed on disk by it.
 */
const picked = new Map<string, Language>()
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((l) => l())
const subscribe = (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener))

export const fileLanguage = {
  get: (key: string): Language | undefined => picked.get(key),
  /** `undefined` goes back to the language the viewer detects. */
  set(key: string, language: Language | undefined): void {
    if (language === undefined) picked.delete(key)
    else picked.set(key, language)
    tell()
  },
  use: (key: string): Language | undefined => useSyncExternalStore(subscribe, () => picked.get(key)),
  clear(): void {
    picked.clear()
    tell()
  },
}

/** The file on screen that is shown as text: which one, in what language, and whether the user picked it. The tab registers it while it is shown; the status bar reads it. */
export interface ShownSource {
  key: string
  language: Language
  detected: Language
}
let shown: ShownSource | null = null
export const shownSource = {
  set(next: ShownSource): () => void {
    shown = next
    tell()
    return () => {
      if (shown === next) {
        shown = null
        tell()
      }
    }
  },
  get: () => shown,
  use: (): ShownSource | null => useSyncExternalStore(subscribe, () => shown),
}
