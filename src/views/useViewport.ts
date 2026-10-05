import { useEffect, useState, type RefObject } from 'react'
import type { Size } from './zoom.ts'

/** The size of an element, kept up to date (the room a picture or a page has to fit in). */
export function useSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setSize((old) => (old.width === el.clientWidth && old.height === el.clientHeight ? old : { width: el.clientWidth, height: el.clientHeight }))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** Zoom kept per tab, so a tab shown again is as it was left (only one file view is mounted at a time). */
const kept = new Map<string, unknown>()
export function keptState<T>(key: string, fallback: T): T {
  return kept.has(key) ? (kept.get(key) as T) : fallback
}
export const keepState = (key: string, value: unknown): void => void kept.set(key, value)
