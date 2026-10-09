import { builtinKeyCommands } from '../commands/builtin.ts'
import type { KeyLike } from '../shortcuts.ts'
import { eventChord, formatChord, normalizeChord } from './chord.ts'

export interface KeyCommand { readonly id: string; readonly keys?: readonly string[] }
const empty: readonly string[] = Object.freeze([])

/** Platform-qualified defaults are data; an unqualified chord applies on both systems. */
export function platformChord(chord: string, mac: boolean): string | undefined {
  if (chord.startsWith('mac:')) return mac ? chord.slice(4) : undefined
  if (chord.startsWith('nonmac:')) return mac ? undefined : chord.slice(7)
  return chord
}

export function createKeyTable(commands: readonly KeyCommand[], mac: boolean) {
  const bindings = new Map<string, readonly string[]>()
  const defaults = new Map<string, string[]>()
  for (const command of commands) for (const qualified of command.keys ?? []) {
    const chord = platformChord(qualified, mac)
    if (chord === undefined) continue
    const normalized = normalizeChord(chord, mac)
    const ids = bindings.get(normalized) ?? empty
    if (!ids.includes(command.id)) bindings.set(normalized, Object.freeze([...ids, command.id]))
    defaults.set(command.id, [...(defaults.get(command.id) ?? []), chord])
  }
  return {
    lookup(e: KeyLike): readonly string[] { return bindings.get(eventChord(e)) ?? empty },
    get(chord: string): readonly string[] { return bindings.get(normalizeChord(chord, mac)) ?? empty },
    shortcut(id: string, style: 'display' | 'accelerator' = 'display'): string | undefined {
      const chord = defaults.get(id)?.[0]
      return chord === undefined ? undefined : formatChord(chord, mac, style)
    },
    accelerator(id: string): string | undefined {
      const chord = defaults.get(id)?.[0]
      return chord !== undefined && bindings.get(normalizeChord(chord, mac))?.length === 1 ? formatChord(chord, mac, 'accelerator') : undefined
    },
    remove(id: string): void {
      defaults.delete(id)
      for (const [chord, ids] of bindings) {
        const remaining = ids.filter((candidate) => candidate !== id)
        if (remaining.length) bindings.set(chord, Object.freeze(remaining))
        else bindings.delete(chord)
      }
    },
  }
}

export const builtinKeyTables = { mac: createKeyTable(builtinKeyCommands, true), nonmac: createKeyTable(builtinKeyCommands, false) }
