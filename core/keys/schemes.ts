import { normalizeChord } from './chord.ts'
import { isReserved } from './reserved.ts'
import { platformChord, type KeyCommand } from './table.ts'
import { mergeUserKeys, type KeyWarning } from './user.ts'

/** Structural subset of CompiledPlugin; no install-time module is loaded here. */
export interface KeyPackage {
  commands: readonly { id: string; defaultKeys: readonly string[] }[]
  keySchemes: readonly { id: string; label: string }[]
  keymaps: readonly { command: string; key: string; source: { keymapId: string; keymapLabel: string } }[]
}
export interface SchemeSelection { owner: string; id: string }

/** Detached owner catalog. Replacement/removal never mutates core commands. */
export class KeySchemes {
  private packages = new Map<string, KeyPackage>()
  private selected?: SchemeSelection
  /** Detached catalog checkpoint for a synchronous main publication batch. */
  fork(): KeySchemes {
    const result = new KeySchemes()
    result.packages = new Map(this.packages)
    result.selected = this.selected && { ...this.selected }
    return result
  }
  set(owner: string, value: KeyPackage): void {
    this.packages.set(owner, {
      commands: value.commands.map(command => ({ ...command, defaultKeys: [...command.defaultKeys] })),
      keySchemes: value.keySchemes.map(scheme => ({ ...scheme })),
      keymaps: value.keymaps.map(binding => ({ ...binding, source: { ...binding.source } })),
    })
  }
  remove(owner: string): void { this.packages.delete(owner) }
  select(selection?: SchemeSelection): void { this.selected = selection && { ...selection } }
  list() {
    return [...this.packages].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .flatMap(([owner, value]) => value.keySchemes.map(scheme => ({ owner, ...scheme })))
  }
  compose(core: readonly KeyCommand[], user: unknown, mac: boolean) {
    const warnings: KeyWarning[] = []
    const commands = new Map(core.map(command => [command.id, { id: command.id, keys: [...(command.keys ?? [])] }]))
    const packages = [...this.packages].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    const coreIds = new Set(core.map(command => command.id))
    for (const [owner, value] of packages) for (const command of value.commands) {
      if (command.id.startsWith(`${owner}:`) && !commands.has(command.id)) commands.set(command.id, { id: command.id, keys: [] })
    }
    const bindings = new Map<string, { owner: string; command: string; key: string }>()
    const add = (owner: string, command: string, qualified: string) => {
      const key = platformChord(qualified, mac)
      if (key === undefined) return
      const warn = (message: string) => warnings.push({ entry: -1, message: `${owner}: ${message}` })
      if (!commands.has(command) || (!coreIds.has(command) && !command.startsWith(`${owner}:`))) { warn(`Unknown or foreign command ${command}`); return }
      let chord: string
      try {
        chord = normalizeChord(key, mac)
        if (isReserved(key, mac)) { warn(`Reserved key chord ${key}`); return }
      } catch { warn(`Invalid key chord ${key}`); return }
      const previous = bindings.get(chord)
      if (previous && previous.owner !== owner) { warn(`Key conflict ${key}; ${previous.owner} wins over ${owner}`); return }
      bindings.set(chord, { owner, command, key })
    }
    for (const [owner, value] of packages) {
      for (const command of value.commands) for (const key of command.defaultKeys) add(owner, command.id, key)
      if (this.selected?.owner === owner && value.keySchemes.some(scheme => scheme.id === this.selected?.id)) {
        for (const binding of value.keymaps) if (binding.source.keymapId === this.selected.id) add(owner, binding.command, binding.key)
      }
    }
    if (this.selected) {
      const { owner, id } = this.selected
      const value = this.packages.get(owner)
      if (!value?.keySchemes.some(scheme => scheme.id === id)) warnings.push({ entry: -1, message: `Key scheme unavailable: ${owner}/${id}; using defaults` })
    }
    // A selected plugin binding replaces the lower-priority core binding on its chord.
    for (const command of commands.values()) command.keys = command.keys.filter(key => {
      const chord = platformChord(key, mac)
      return chord === undefined || !bindings.has(normalizeChord(chord, mac))
    })
    for (const binding of bindings.values()) commands.get(binding.command)!.keys.unshift(binding.key)
    const active = [...commands.values()]
    const merged = mergeUserKeys(active, user, mac)
    return { ...merged, commands: active, warnings: [...warnings, ...merged.warnings] }
  }
}
