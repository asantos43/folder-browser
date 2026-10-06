import { useSyncExternalStore } from 'react'

/** What Cut and Copy took in the tree: the rows (paths of a root), waiting for a Paste. It is the application's own, not the system's. */
export interface FileClip {
  rootId: string
  paths: string[]
  mode: 'copy' | 'cut'
}

let clip: FileClip | null = null
const listeners = new Set<() => void>()

export const fileClipboard = {
  get: (): FileClip | null => clip,
  set(next: FileClip | null): void {
    clip = next
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

/** The clip, and a new render when it changes (the rows that were cut are dimmed, and Paste is offered while there is something to paste). */
export const useFileClip = (): FileClip | null => useSyncExternalStore(fileClipboard.subscribe, fileClipboard.get)
