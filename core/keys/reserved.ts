import { builtinKeyCommands } from '../commands/builtin.ts'
import { normalizeChord } from './chord.ts'
import { platformChord } from './table.ts'

/** Built-in application keys and focused editing/system keys cannot be claimed by plugins. */
export const reservedChords = [
  ...builtinKeyCommands.flatMap((command) => command.keys),
  'Mod+X', 'Mod+V', 'Mod+A', 'Mod+Z', 'Mod+Shift+Z', 'nonmac:Ctrl+Y',
  'Mod+Q', 'mac:Mod+H', 'mac:Mod+Alt+H', 'Alt+F4', 'F11', 'mac:Ctrl+Mod+F',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
  'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowUp', 'Shift+ArrowDown',
  'Shift+Home', 'Shift+End', 'Shift+PageUp', 'Shift+PageDown',
  'Ctrl+ArrowLeft', 'Ctrl+ArrowRight', 'Ctrl+Shift+ArrowLeft', 'Ctrl+Shift+ArrowRight',
  'mac:Alt+ArrowLeft', 'mac:Alt+ArrowRight', 'mac:Alt+Shift+ArrowLeft', 'mac:Alt+Shift+ArrowRight',
  'mac:Mod+ArrowLeft', 'mac:Mod+ArrowRight', 'mac:Mod+ArrowUp', 'mac:Mod+ArrowDown',
  'mac:Mod+Shift+ArrowLeft', 'mac:Mod+Shift+ArrowRight', 'mac:Mod+Shift+ArrowUp', 'mac:Mod+Shift+ArrowDown',
  'Mod+Home', 'Mod+End', 'Mod+Shift+Home', 'Mod+Shift+End',
  'Backspace', 'Delete', 'Ctrl+Backspace', 'Ctrl+Delete', 'mac:Alt+Backspace', 'mac:Alt+Delete',
  'Enter', 'Tab', 'Shift+Tab', 'Escape',
  // The defaultKeymap/historyKeymap installed by src/views/codeTheme.ts.
  'Alt+ArrowUp', 'Alt+ArrowDown', 'Alt+Shift+ArrowUp', 'Alt+Shift+ArrowDown',
  'Mod+Enter', 'Mod+/', 'Mod+Alt+\\', 'Mod+D', 'Ctrl+M', 'Alt+L', 'Ctrl+I',
  'Mod+Shift+K', 'Ctrl+Shift+Z',
  'mac:Ctrl+B', 'mac:Ctrl+F', 'mac:Ctrl+P', 'mac:Ctrl+N',
  'mac:Ctrl+A', 'mac:Ctrl+E', 'mac:Ctrl+H', 'mac:Ctrl+D', 'mac:Ctrl+K',
  'mac:Ctrl+O', 'mac:Ctrl+T', 'mac:Ctrl+V', 'mac:Ctrl+Shift+V',
] as const

function reservedFor(mac: boolean): ReadonlySet<string> {
  return new Set(reservedChords.flatMap((qualified) => {
    const chord = platformChord(qualified, mac)
    return chord === undefined ? [] : [normalizeChord(chord, mac)]
  }))
}
const macReserved = reservedFor(true)
const otherReserved = reservedFor(false)
export function isReserved(chord: string, mac: boolean): boolean {
  return (mac ? macReserved : otherReserved).has(normalizeChord(chord, mac))
}
export function assertPluginChord(chord: string, mac: boolean): void {
  if (isReserved(chord, mac)) throw new Error(`Reserved key chord cannot be taken by a plugin: ${chord}`)
}
