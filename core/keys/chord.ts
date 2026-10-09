import type { KeyLike } from '../shortcuts.ts'

export interface Chord { key: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }
const aliases: Record<string, string> = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', space: ' ', plus: '+' }
const named = ['Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]

/** Event keys retain their case except single characters, matching the old dispatcher. */
export function eventChord(e: KeyLike): string {
  return `${e.control ? 'C' : ''}${e.meta ? 'M' : ''}${e.shift ? 'S' : ''}${e.alt ? 'A' : ''}:${e.key.length === 1 ? e.key.toLowerCase() : e.key}`
}

export function parseChord(text: string, mac: boolean): Chord {
  const invalid = () => new Error(`Invalid key chord: ${JSON.stringify(text)}`)
  if (typeof text !== 'string' || !text.trim()) throw invalid()
  if (text.trim().endsWith('+') && text.trim() !== '+' && !text.trim().endsWith('++')) throw invalid()
  // A literal plus is the final key in Mod++ (or use the spelling Plus).
  const parts = text.trim() === '+' ? ['+'] : text.trim().endsWith('++') ? [...text.trim().slice(0, -2).split('+'), '+'] : text.trim().split('+')
  const raw = parts.pop()!.trim()
  const alias = Object.hasOwn(aliases, raw.toLowerCase()) ? aliases[raw.toLowerCase()] : undefined
  const key = alias ?? named.find((key) => key.toLowerCase() === raw.toLowerCase()) ?? (raw.length === 1 ? raw.toLowerCase() : '')
  if (!key) throw invalid()
  const chord: Chord = { key, control: false, meta: false, shift: false, alt: false }
  for (const part of parts) {
    const name = part.trim().toLowerCase()
    const modifier = name === 'mod' ? (mac ? 'meta' : 'control') : name === 'ctrl' || name === 'control' ? 'control' : name === 'cmd' || name === 'meta' || name === 'command' ? 'meta' : name === 'shift' ? 'shift' : name === 'alt' || name === 'option' ? 'alt' : null
    if (!modifier || chord[modifier]) throw invalid()
    chord[modifier] = true
  }
  return chord
}

export function normalizeChord(text: string, mac: boolean): string { return eventChord(parseChord(text, mac)) }

export function formatChord(text: string, mac: boolean, style: 'display' | 'accelerator' = 'display'): string {
  const chord = parseChord(text, mac)
  const key = chord.key === ' ' ? 'Space' : chord.key.startsWith('Arrow') ? chord.key.slice(5) : chord.key.length === 1 ? chord.key.toUpperCase() : chord.key
  if (mac && style === 'display') return `${chord.control ? '⌃' : ''}${chord.alt ? '⌥' : ''}${chord.shift ? '⇧' : ''}${chord.meta ? '⌘' : ''}${key}`
  return [...(chord.control ? ['Ctrl'] : []), ...(chord.meta ? ['Cmd'] : []), ...(chord.alt ? ['Alt'] : []), ...(chord.shift ? ['Shift'] : []), key].join('+')
}
