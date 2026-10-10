import type { createRegistry } from '../commands/registry.ts'
import type { createKeyTable } from '../keys/table.ts'
import { assertPluginChord } from '../keys/reserved.ts'
import { normalizeChord } from '../keys/chord.ts'
import type { KeyConflict } from '../keys/user.ts'
import type { SettingsRegistry } from '../settings/registry.ts'
import type { Contribution } from './contract.ts'
import type { createMenuRegistry } from './menus.ts'
import { validateContribution } from './types.ts'

export interface ContributionRegistries {
  commands: ReturnType<typeof createRegistry>
  keys: ReturnType<typeof createKeyTable>
  settings: SettingsRegistry
  menus: ReturnType<typeof createMenuRegistry>
  mac: boolean
  /** Trusted host handlers, never read from declarative contribution data. */
  handlers: ReadonlyMap<string, () => void>
  /** The user's effective table wins over a plugin default. */
  userKeys?: { get(chord: string): readonly string[] }
}
export interface Handle {
  readonly pluginId: string
  readonly commands: readonly string[]
  readonly keys: readonly string[]
  readonly settings: readonly string[]
  readonly menuItems: readonly string[]
  readonly conflicts: readonly KeyConflict[]
}
// Scope ownership to the actual command registry, independent of wrapper-object identity.
const installed = new WeakMap<ContributionRegistries['commands'], Map<string, Handle>>()

/** Validate all data, references and collisions before touching any live registry. */
export function applyContribution(registries: ContributionRegistries, input: Contribution | unknown): Handle {
  const contribution = validateContribution(input)
  const { pluginId } = contribution
  const state = installed.get(registries.commands) ?? new Map<string, Handle>()
  if (state.has(pluginId)) throw new Error(`Plugin already applied: ${pluginId}`)
  const commandIds = (contribution.commands ?? []).map(command => command.id)
  for (const command of contribution.commands ?? []) {
    if (registries.commands.get(command.id)) throw new Error(`Command already registered: ${command.id}`)
    if (registries.keys.shortcut(command.id) !== undefined) throw new Error(`Command already has keys: ${command.id}`)
    if (typeof registries.handlers.get(command.id) !== 'function') throw new Error(`Missing command handler: ${command.id}`)
  }
  for (const setting of contribution.settings ?? []) if (registries.settings.get(setting.id)) throw new Error(`Setting already registered: ${setting.id}`)
  for (const item of contribution.menuItems ?? []) {
    if (registries.menus.get(item.id)) throw new Error(`Menu item already registered: ${item.id}`)
    if (!commandIds.includes(item.command)) throw new Error(`Unknown menu command: ${item.command}`)
  }
  const conflicts: KeyConflict[] = [], accepted: NonNullable<Contribution['keys']>[number][] = []
  const planned = new Map<string, string[]>()
  for (const key of contribution.keys ?? []) {
    assertPluginChord(key.key, true); assertPluginChord(key.key, false)
    if (!commandIds.includes(key.command)) throw new Error(`Unknown key command: ${key.command}`)
    const chord = normalizeChord(key.key, registries.mac)
    const existing = [...new Set([...(registries.userKeys?.get(key.key) ?? []), ...registries.keys.get(key.key), ...(planned.get(chord) ?? [])])]
    if (existing.some(id => id !== key.command)) { conflicts.push({ key: key.key, commands: [...existing, key.command] }); continue }
    planned.set(chord, [key.command]); accepted.push(key)
  }
  const handle: Handle = Object.freeze({ pluginId,
    commands: Object.freeze(commandIds), keys: Object.freeze([...new Set(accepted.map(key => key.command))]),
    settings: Object.freeze((contribution.settings ?? []).map(setting => setting.id)),
    menuItems: Object.freeze((contribution.menuItems ?? []).map(item => item.id)),
    conflicts: Object.freeze(conflicts.map(conflict => Object.freeze({ ...conflict, commands: Object.freeze(conflict.commands) as unknown as string[] }))),
  })
  // Arm each undo before calling the writer: a writer may mutate and then throw.
  const undo: (() => void)[] = []
  try {
    registries.settings.transaction(() => {
      for (const command of contribution.commands ?? []) {
        undo.push(() => { registries.commands.unregister(command.id) })
        registries.commands.register(command, registries.handlers.get(command.id))
      }
      for (const key of accepted) {
        undo.push(() => { registries.keys.remove(key.command) })
        registries.keys.add(key.command, key.key)
      }
      for (const setting of contribution.settings ?? []) registries.settings.defineSetting(setting)
      for (const item of contribution.menuItems ?? []) {
        undo.push(() => { registries.menus.remove(item.id) })
        registries.menus.add(item)
      }
    })
  } catch (error) {
    for (const rollback of undo.reverse()) rollback()
    throw error
  }
  state.set(pluginId, handle); installed.set(registries.commands, state)
  return handle
}

/** Remove only this plugin's installed entries. Unknown/already removed ids are harmless. */
export function removeContribution(registries: ContributionRegistries, pluginId: string): void {
  const state = installed.get(registries.commands), handle = state?.get(pluginId)
  if (!handle) return
  registries.settings.transaction(() => {
    for (const id of handle.settings) registries.settings.remove(id)
    for (const id of handle.menuItems) registries.menus.remove(id)
    for (const id of handle.keys) registries.keys.remove(id)
    for (const id of handle.commands) registries.commands.unregister(id)
  })
  state!.delete(pluginId)
}
