import { useSyncExternalStore } from 'react'
import type { SortKey } from '@core/fs/sort.ts'
import { readStored, writeStored } from '@/lib/storage.ts'

/** A setting kept on this computer that more than one part of the interface reads and changes (word wrap, formatting): a value, and a hook. */
export interface Setting<T> {
  get: () => T
  set: (value: T) => void
  /** Reads the value again from storage (a test that cleared it). */
  reload: () => void
  use: () => T
}

export function createSetting<T>(key: string, fallback: T, valid: (value: unknown) => value is T): Setting<T> {
  const listeners = new Set<() => void>()
  let value = readStored(key, fallback, valid)
  const tell = () => listeners.forEach((l) => l())
  return {
    get: () => value,
    set: (next) => {
      value = next
      writeStored(key, next)
      tell()
    },
    reload: () => {
      value = readStored(key, fallback, valid)
      tell()
    },
    use: () => useSyncExternalStore((listener) => (listeners.add(listener), () => void listeners.delete(listener)), () => value),
  }
}

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'

/** Long lines of a text file wrap at the edge of the window (VS Code's Word Wrap, Alt+Z). Off by default, as in VS Code. */
export const wordWrap = createSetting('wordWrap', false, isBoolean)
/** An SVG file is shown as a picture or as its source: the last choice is kept (as a picture at first). */
export const svgView = createSetting<'image' | 'code'>('svgView', 'image', (v): v is 'image' | 'code' => v === 'image' || v === 'code')
/** A Markdown file is shown formatted or as its text: the last choice is kept (formatted at first). */
export const markdownView = createSetting<'formatted' | 'text'>('markdownView', 'formatted', (v): v is 'formatted' | 'text' => v === 'formatted' || v === 'text')
/** A Markdown page is as wide as the window, not the reading column of 880 px (so that a code block or a table needs no scroll bar). Off by default. */
export const markdownWide = createSetting('markdownWide', false, isBoolean)
/** Long lines of a code block in a Markdown page wrap instead of scrolling sideways. Off by default: a block keeps its columns. */
export const markdownWrapCode = createSetting('markdownWrapCode', false, isBoolean)
/** At start, without a file to open, the snapshots and files that were open when the application was closed are opened again (VS Code does the same). */
export const reopenSession = createSetting('reopenSession', true, isBoolean)
/** Hidden files and folders (a name that starts with a dot) are shown in the tree. Off by default, as in a file manager. */
export const showHidden = createSetting('showHidden', false, isBoolean)
/** What the files of a folder are ordered by (folders stay first): the name, the date they changed, or the size. */
export const sortKey = createSetting<SortKey>('sortKey', 'name', (v): v is SortKey => v === 'name' || v === 'modified' || v === 'size')
/** The order of the key turned round: Z to A, the newest and the largest first. */
export const sortDescending = createSetting('sortDescending', false, isBoolean)
/** Source files that a formatter can lay out again (HTML, CSS, JavaScript, JSON, XML) are shown formatted. On by default: a saved page is usually minified. */
export const formatSource = createSetting('formatSource', true, isBoolean)
