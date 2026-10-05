/** A zoom is a scale (1 = 100 %), or a way to fit the content to the room there is. `auto` (pictures, PDFs) is "fit, but never above 100 %". */
export type ZoomMode = number | 'fit-width' | 'fit-page' | 'auto'

export interface Size {
  width: number
  height: number
}

export interface Limits {
  min: number
  max: number
}

export const IMAGE_LIMITS: Limits = { min: 0.05, max: 16 }
export const PDF_LIMITS: Limits = { min: 0.25, max: 4 }

/** The steps of the zoom in and zoom out buttons, as a viewer offers them. */
export const STEPS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 3, 4, 5, 8, 16]

/** The choices of the zoom box (besides the fit modes). */
export const PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

export const clampZoom = (scale: number, { min, max }: Limits): number => Math.min(max, Math.max(min, scale))

/** The next step above (`1`) or below (`-1`) the scale, inside the limits. A scale between two steps goes to the nearer one in that direction. */
export function stepZoom(scale: number, direction: 1 | -1, limits: Limits): number {
  const eps = 1e-6
  const steps = STEPS.filter((s) => s >= limits.min - eps && s <= limits.max + eps)
  const next = direction === 1 ? steps.find((s) => s > scale + eps) : [...steps].reverse().find((s) => s < scale - eps)
  return clampZoom(next ?? (direction === 1 ? limits.max : limits.min), limits)
}

/** How much a turn of the wheel with Control held zooms: smooth, and the same going in and out. */
export const wheelZoom = (scale: number, deltaY: number, limits: Limits): number => clampZoom(scale * Math.exp(-deltaY * 0.0015), limits)

/** The scale a mode means for content of `content` size in a room of `room` size (`padding` on every side). */
export function resolveScale(mode: ZoomMode, content: Size, room: Size, limits: Limits, padding = 0): number {
  if (typeof mode === 'number') return clampZoom(mode, limits)
  if (content.width <= 0 || content.height <= 0) return 1
  const byWidth = (room.width - 2 * padding) / content.width
  const byHeight = (room.height - 2 * padding) / content.height
  const fit = mode === 'fit-width' ? byWidth : Math.min(byWidth, byHeight)
  const scale = mode === 'auto' ? Math.min(1, fit) : fit
  return clampZoom(Number.isFinite(scale) && scale > 0 ? scale : 1, limits)
}

export const formatPercent = (scale: number): string => `${Math.round(scale * 100)}%`

/** What a person types in the zoom box: `150`, `150%`, `1,5` is not a percentage. Null when it is not a usable number. */
export function parsePercent(text: string, limits: Limits): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(text)
  if (!match) return null
  const value = Number(match[1]) / 100
  return value > 0 ? clampZoom(value, limits) : null
}

/** The scroll position that keeps the point under the pointer where it was after the content is scaled by `ratio`. */
export const anchoredScroll = (scroll: number, pointer: number, ratio: number): number => (scroll + pointer) * ratio - pointer
