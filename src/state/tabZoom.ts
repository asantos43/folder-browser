import { clampZoom, stepZoom, type Limits } from '@/views/zoom.ts'

/** The zoom of a tab (a page of a snapshot, a text): 100 % is 1, and the steps are those of a browser's. Each tab has its own. */
export const TAB_LIMITS: Limits = { min: 0.25, max: 5 }

export const stepTabZoom = (zoom: number, direction: 1 | -1): number => stepZoom(zoom, direction, TAB_LIMITS)
export const tabZoomOf = (zooms: Readonly<Record<string, number>>, key: string | null | undefined): number => (key ? clampZoom(zooms[key] ?? 1, TAB_LIMITS) : 1)

/** The zooms of the tabs that are still open (a closed tab forgets its zoom), and none that is 100 %. */
export function pruneZooms(zooms: Readonly<Record<string, number>>, open: ReadonlySet<string>): Record<string, number> {
  const kept = Object.entries(zooms).filter(([key, zoom]) => open.has(key) && zoom !== 1)
  return kept.length === Object.keys(zooms).length ? (zooms as Record<string, number>) : Object.fromEntries(kept)
}
