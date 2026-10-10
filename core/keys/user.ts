import { compileWhen, type WhenContext } from '../commands/when.ts'
import type { KeyLike } from '../shortcuts.ts'
import { eventChord, formatChord, normalizeChord } from './chord.ts'
import { isReserved } from './reserved.ts'
import { platformChord, type KeyCommand } from './table.ts'

export const USER_KEYS_LIMIT = 256 * 1024
export interface UserKey { key: string; command: string; when?: string }
export interface KeyWarning { entry: number; message: string }
export interface KeyConflict { key: string; commands: string[] }
export interface KeysSnapshot { entries: UserKey[]; warnings: KeyWarning[] }
export type KeysResult = { ok: boolean; warnings: KeyWarning[] }
export type KeysPortableResult = KeysResult | { error: string } | { canceled: true } | { token: number; preview: KeysSnapshot & { conflicts: KeyConflict[] } }

/** Invalid entries are isolated; an invalid document never yields partial bindings. */
export function validateUserKeys(value: unknown, commands: readonly KeyCommand[], mac: boolean): KeysSnapshot {
  const entries: UserKey[] = [], warnings: KeyWarning[] = []
  const warn = (entry: number, message: string) => warnings.push({ entry, message })
  if (!Array.isArray(value)) { warn(-1, 'Expected a list of keybindings'); return { entries, warnings } }
  if (new TextEncoder().encode(JSON.stringify(value)).length > USER_KEYS_LIMIT) { warn(-1, 'Keybindings exceed 256 KB'); return { entries, warnings } }
  const ids = new Set(commands.map(command => command.id))
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { warn(index, 'Expected an entry'); continue }
    let valid = true
    const bad = (message: string) => { valid = false; warn(index, message) }
    if (typeof item.key !== 'string') bad('key must be a chord string')
    else try { normalizeChord(item.key, mac) } catch { bad('Invalid key chord') }
    const removal = typeof item.command === 'string' && item.command.startsWith('-')
    const id = removal ? item.command.slice(1) : item.command
    if (typeof id !== 'string' || !ids.has(id)) bad('Unknown command')
    if (item.when !== undefined) {
      if (removal) bad('A removal cannot have when')
      else try { compileWhen(item.when) } catch { bad('Invalid when expression') }
    }
    if (valid && !removal && isReserved(item.key, mac)) bad('Reserved key chord')
    if (valid) entries.push({ key: item.key, command: item.command, ...(item.when === undefined ? {} : { when: item.when }) })
  }
  return { entries, warnings }
}

export function parseUserKeys(text: string, commands: readonly KeyCommand[], mac: boolean): KeysSnapshot {
  if (new TextEncoder().encode(text).length > USER_KEYS_LIMIT) return { entries: [], warnings: [{ entry: -1, message: 'Keybindings exceed 256 KB' }] }
  try { return validateUserKeys(JSON.parse(text), commands, mac) }
  catch { return { entries: [], warnings: [{ entry: -1, message: 'Invalid keybindings JSON' }] } }
}

interface Binding { id: string; key: string; when?: string; condition?: (context: WhenContext) => boolean; user?: boolean }

/** Prove separation for conjunctions of boolean/string literals; other expressions conservatively conflict. */
function separated(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const literals = (expression: string) => {
    const terms = expression.split('&&').map(term => term.trim())
    return terms.map(term => /^(!?)([\w.-]+)$/.exec(term) ?? /^([\w.-]+)\s*(==|!=)\s*'([^']*)'$/.exec(term))
  }
  const left = literals(a), right = literals(b)
  if (left.some(term => !term) || right.some(term => !term)) return false
  return left.some(x => right.some(y => {
    if (!x || !y) return false
    if (x.length === 3 && y.length === 3) return x[2] === y[2] && x[1] !== y[1]
    if (x.length === 4 && y.length === 4 && x[1] === y[1]) return x[2] === '==' && y[2] === '==' ? x[3] !== y[3] : x[2] !== y[2] && x[3] === y[3]
    return false
  }))
}

export function mergeUserKeys(commands: readonly KeyCommand[], value: unknown, mac: boolean) {
  const { entries, warnings } = validateUserKeys(value, commands, mac)
  const bindings = new Map<string, Binding[]>()
  const conditions = new Map<string, (context: WhenContext) => boolean>()
  for (const command of commands) for (const qualified of command.keys ?? []) {
    const key = platformChord(qualified, mac)
    if (key === undefined) continue
    const chord = normalizeChord(key, mac)
    bindings.set(chord, [...(bindings.get(chord) ?? []), { id: command.id, key }])
  }
  for (const entry of entries) {
    const chord = normalizeChord(entry.key, mac), previous = bindings.get(chord) ?? []
    if (entry.command.startsWith('-')) {
      bindings.set(chord, previous.filter(binding => binding.user || binding.id !== entry.command.slice(1)))
      continue
    }
    let condition = entry.when ? conditions.get(entry.when) : undefined
    if (entry.when && !condition) { condition = compileWhen(entry.when); conditions.set(entry.when, condition) }
    bindings.set(chord, [...previous.filter(binding => binding.user && (binding.id !== entry.command || binding.when !== entry.when)), { id: entry.command, key: entry.key, when: entry.when, condition, user: true }])
  }
  const conflicts: KeyConflict[] = []
  const byId = new Map<string, Binding[]>()
  for (const list of bindings.values()) {
    if (list.some((a, i) => list.slice(i + 1).some(b => a.id !== b.id && !separated(a.when, b.when)))) conflicts.push({ key: list[0].key, commands: [...new Set(list.map(binding => binding.id))] })
    for (const binding of list) byId.set(binding.id, [...(byId.get(binding.id) ?? []), binding])
  }
  const ids = (list: Binding[]) => [...new Set(list.map(binding => binding.id))]
  const table = {
    lookup(event: KeyLike, context?: WhenContext): readonly string[] {
      const list = bindings.get(eventChord(event)) ?? []
      // Without context the main process must not forward even a sole conditional binding.
      if (context === undefined && list.some(binding => binding.condition)) return []
      return ids(list.filter(binding => !binding.condition || (context !== undefined && binding.condition(context))))
    },
    get(key: string): readonly string[] { return ids(bindings.get(normalizeChord(key, mac)) ?? []) },
    shortcut(id: string, style: 'display' | 'accelerator' = 'display'): string | undefined {
      const list = byId.get(id), binding = list?.find(binding => binding.user) ?? list?.[0]
      return binding ? formatChord(binding.key, mac, style) : undefined
    },
    accelerator(id: string): string | undefined {
      const list = byId.get(id), binding = list?.find(binding => binding.user) ?? list?.[0]
      if (!binding) return undefined
      const chord = bindings.get(normalizeChord(binding.key, mac)) ?? []
      return ids(chord).length === 1 && !chord.some(item => item.condition) ? formatChord(binding.key, mac, 'accelerator') : undefined
    },
  }
  return { table, conflicts, warnings }
}
