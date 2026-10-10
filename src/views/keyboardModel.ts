import type { CommandDef } from '@core/commands/registry.ts'
import { builtinKeyCommands } from '@core/commands/builtin.ts'
import { platformChord } from '@core/keys/table.ts'
import { eventChord, formatChord } from '@core/keys/chord.ts'
import type { KeyLike } from '@core/shortcuts.ts'
import { mergeUserKeys, type UserKey } from '@core/keys/user.ts'
import { normalizeSearch } from './SettingsView.tsx'

export type KeyboardEntry = { id: string; title: string; category: string; key: string; changed: boolean; search: string }
export function indexKeyboard(commands: readonly Readonly<CommandDef>[], entries: readonly UserKey[], mac: boolean, translate: (key: string) => string): KeyboardEntry[] {
  const table = mergeUserKeys(builtinKeyCommands, entries, mac).table
  const changed = new Set(entries.map(entry => entry.command.replace(/^-/, '')))
  return commands.map(command => {
    const title = translate(command.title), category = translate(`menu.${command.category}`), key = table.shortcut(command.id) ?? ''
    return { id: command.id, title, category, key, changed: changed.has(command.id), search: normalizeSearch(`${title} ${command.id} ${key}`) }
  })
}
export function filterKeyboard(entries: readonly KeyboardEntry[], query: string, onlyModified: boolean): KeyboardEntry[] {
  const needle = normalizeSearch(query.trim())
  return entries.filter(entry => entry.search.includes(needle) && (!onlyModified || entry.changed))
}
export function restoreCommand(entries: readonly UserKey[], id: string): UserKey[] {
  return entries.filter(entry => entry.command !== id && entry.command !== `-${id}`)
}
export function replaceCommand(entries: readonly UserKey[], id: string, key: string | undefined, mac: boolean): UserKey[] {
  const next = restoreCommand(entries, id)
  for (const qualified of builtinKeyCommands.find(command => command.id === id)?.keys ?? []) {
    const chord = platformChord(qualified, mac)
    if (chord) next.push({ key: chord, command: `-${id}` })
  }
  if (key) next.push({ key, command: id })
  return next
}
export function recordedChord(event: KeyLike, mac: boolean): string | undefined {
  if (['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified'].includes(event.key)) return
  const [modifiers, ...parts] = eventChord(event).split(':')
  const key = parts.join(':')
  const chord = [...(modifiers.includes('C') ? ['Ctrl'] : []), ...(modifiers.includes('M') ? ['Cmd'] : []), ...(modifiers.includes('A') ? ['Alt'] : []), ...(modifiers.includes('S') ? ['Shift'] : []), key === ' ' ? 'Space' : key === '+' ? 'Plus' : key].join('+')
  try { return formatChord(chord, mac, 'accelerator') } catch { return }
}
