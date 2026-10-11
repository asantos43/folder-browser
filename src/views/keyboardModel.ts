import type { CommandDef } from '@core/commands/registry.ts'
import { platformChord, type KeyCommand } from '@core/keys/table.ts'
import { eventChord, formatChord, normalizeChord } from '@core/keys/chord.ts'
import type { ContributionsSnapshot } from '@/plugins/contributions.ts'
import { i18nRegistry } from '@/i18n/index.ts'
import type { KeyLike } from '@core/shortcuts.ts'
import { mergeUserKeys, type UserKey } from '@core/keys/user.ts'
import { normalizeSearch } from './SettingsView.tsx'

export type KeyboardEntry = { id: string; title: string; category: string; key: string; changed: boolean; search: string }
export type KeyboardCommand = Omit<Readonly<CommandDef>, 'keys'> & KeyCommand & { owner?: string }
export function pluginKeyboardLabel(owner: string, label: string): string {
  const scoped = `${owner}.${label}`, resolved = i18nRegistry.resolve(scoped)
  return resolved === scoped ? label : resolved
}
export function activeKeyboardCommands(builtins: readonly Readonly<CommandDef>[], contributions: ContributionsSnapshot, mac: boolean): KeyboardCommand[] {
  return [
    ...builtins.map(command => ({ ...command, keys: (command.keys ?? []).filter(key => {
      const chord = platformChord(key, mac)
      return chord === undefined || !contributions.keyIndex.has(normalizeChord(chord, mac))
    }) })),
    ...contributions.commands.values(),
  ]
}
export function indexKeyboard(commands: readonly KeyboardCommand[], entries: readonly UserKey[], mac: boolean, translate: (key: string) => string): KeyboardEntry[] {
  const table = mergeUserKeys(commands, entries, mac).table
  const changed = new Set(entries.map(entry => entry.command.replace(/^-/, '')))
  return commands.map(command => {
    const title = command.owner ? pluginKeyboardLabel(command.owner, command.title) : translate(command.title)
    const category = command.owner ? pluginKeyboardLabel(command.owner, command.category) : translate(`menu.${command.category}`)
    const key = table.shortcut(command.id) ?? ''
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
export function replaceCommand(commands: readonly KeyCommand[], entries: readonly UserKey[], id: string, key: string | undefined, mac: boolean): UserKey[] {
  const next = restoreCommand(entries, id)
  // Resolved plugin keys omit defaults already removed by the user. Keep those
  // removals on subsequent edits rather than bringing the defaults back.
  const removals = new Set(entries.filter(entry => entry.command === `-${id}`).map(entry => entry.key))
  for (const qualified of commands.find(command => command.id === id)?.keys ?? []) {
    const chord = platformChord(qualified, mac)
    if (chord) removals.add(chord)
  }
  for (const chord of removals) next.push({ key: chord, command: `-${id}` })
  if (key) next.push({ key, command: id })
  return next
}
/** Inspect occupants before the user's new binding replaces lower-priority defaults. */
export function keyboardConflicts(commands: readonly KeyCommand[], entries: readonly UserKey[], id: string, key: string, mac: boolean): string[] {
  return mergeUserKeys(commands, restoreCommand(entries, id), mac).table.get(key).filter(other => other !== id)
}
export function recordedChord(event: KeyLike, mac: boolean): string | undefined {
  if (['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified'].includes(event.key)) return
  const [modifiers, ...parts] = eventChord(event).split(':')
  const key = parts.join(':')
  const chord = [...(modifiers.includes('C') ? ['Ctrl'] : []), ...(modifiers.includes('M') ? ['Cmd'] : []), ...(modifiers.includes('A') ? ['Alt'] : []), ...(modifiers.includes('S') ? ['Shift'] : []), key === ' ' ? 'Space' : key === '+' ? 'Plus' : key].join('+')
  try { return formatChord(chord, mac, 'accelerator') } catch { return }
}
