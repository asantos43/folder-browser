/**
 * The renderer-side view of the plugin generation for menu/palette/dispatch:
 * the commands and menu items that plugins contribute, indexed by id and kept
 * stable until the next generation applies. The main process sends a frozen
 * snapshot through the runtime (`src/plugins/runtime.ts`); this module mirrors
 * the parts the palette, the menubar and the keyboard dispatcher need.
 *
 * The store has three access patterns:
 *  - `getSnapshot()` returns the current state (stable reference until the next
 *    apply), suitable for `useSyncExternalStore`.
 *  - `subscribe(listener)` is called once per generation, after the state is
 *    replaced; subscribers must not throw.
 *  - `applyContributions(snapshot)` is the single entry point that the runtime
 *    uses; it rebuilds the maps atomically and notifies subscribers once.
 *
 * Owners that are not enabled keep their settings definitions (consumed by the
 * runtime) but contribute no commands or menu items here: a disabled plugin is
 * invisible to menus and the palette.
 *
 * Keys and command conditions are parsed once at application, with no IPC.
 * Keys are looked up in
 * memory by callers (the workbench's `run` falls back to it after the built-in
 * keytable returns null).
 */
import type { PluginGeneration } from '@core/plugins/summary.ts'
import { normalizeChord } from '@core/keys/chord.ts'
import { compileWhen, type WhenContext } from '@core/commands/when.ts'

export interface PluginCommandView {
  readonly id: string
  readonly owner: string
  readonly title: string
  readonly category: string
  /** True when the runtime says the command may run. Until phase 3 the renderer never executes it. */
  readonly enabled: boolean
  readonly disabledReason?: string
  readonly when?: string
  readonly palette: boolean
  readonly keys: readonly string[]
  readonly matchesContext: (context: WhenContext) => boolean
}

export interface PluginMenuView {
  readonly id: string
  readonly command: string
  readonly owner: string
  /** A `menubar/<id>` destination from the contribution contract. */
  readonly point: string
  readonly group: string
  readonly order: number
  readonly when?: string
}

export interface ContributionsSnapshot {
  readonly version: number
  readonly commands: ReadonlyMap<string, PluginCommandView>
  readonly menuItems: ReadonlyMap<string, PluginMenuView>
  readonly keyIndex: ReadonlyMap<string, string>
  readonly keySchemes: ReadonlyMap<string, { readonly id: string; readonly owner: string; readonly label: string }>
  /** True when at least one enabled owner has a menu item for the `menubar/tools` destination. */
  readonly hasToolsItems: boolean
}

interface MutableSnapshot {
  version: number
  commands: Map<string, PluginCommandView>
  menuItems: Map<string, PluginMenuView>
  keyIndex: Map<string, string>
  keySchemes: Map<string, { id: string; owner: string; label: string }>
  hasToolsItems: boolean
}

const EMPTY: ContributionsSnapshot = Object.freeze({ version: 0, commands: new Map(), menuItems: new Map(), keyIndex: new Map(), keySchemes: new Map(), hasToolsItems: false })

let state: ContributionsSnapshot = EMPTY
const listeners = new Set<() => void>()

function build(snapshot: PluginGeneration): MutableSnapshot {
  const commands = new Map<string, PluginCommandView>()
  const menuItems = new Map<string, PluginMenuView>()
  const keyIndex = new Map<string, string>()
  const keySchemes = new Map<string, { id: string; owner: string; label: string }>()
  const mac = typeof window !== 'undefined' && window.fb?.platform === 'darwin'
  let hasToolsItems = false
  for (const plugin of snapshot.plugins) {
    if (!plugin.enabled) continue
    for (const scheme of plugin.keySchemes ?? []) {
      const id = `${plugin.owner}/${scheme.id}`
      keySchemes.set(id, { id, owner: plugin.owner, label: scheme.label })
    }
    const resolvedKeys = new Map((plugin.resolvedKeys ?? []).map(entry => [entry.id, entry.keys ?? []]))
    // Older test harnesses build plugins with no `commands` / `menuItems` yet;
    // the runtime tolerates the missing fields, and so does the store.
    for (const command of plugin.commands ?? []) {
      commands.set(command.id, {
        id: command.id,
        owner: plugin.owner,
        title: command.title,
        category: command.category,
        enabled: command.enabled,
        ...(command.disabledReason !== undefined ? { disabledReason: command.disabledReason } : {}),
        ...(command.when !== undefined ? { when: command.when } : {}),
        palette: command.palette !== false,
        keys: resolvedKeys.get(command.id) ?? [],
        matchesContext: command.when ? compileWhen(command.when) : () => true,
      })
    }
    // Host entries are already platform-filtered and conflict-resolved. Never
    // resurrect defaults when an entry is absent (unbound or rejected).
    for (const entry of plugin.resolvedKeys ?? []) {
      if (!commands.get(entry.id)?.enabled) continue
      for (const key of entry.keys ?? []) {
        const chord = normalizeChord(key, mac)
        if (!keyIndex.has(chord)) keyIndex.set(chord, entry.id)
      }
    }
    for (const item of plugin.menuItems ?? []) {
      menuItems.set(item.id, {
        id: item.id,
        command: item.command,
        owner: plugin.owner,
        point: item.point,
        group: item.group,
        order: item.order,
        ...(item.when !== undefined ? { when: item.when } : {}),
      })
      if (item.point === 'menubar/tools') hasToolsItems = true
    }
  }
  return { version: snapshot.version, commands, menuItems, keyIndex, keySchemes: new Map([...keySchemes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), hasToolsItems }
}

/**
 * Replaces the store contents with the commands and menu items contributed by
 * the given generation. Owners absent from the snapshot are removed; the same
 * owner id with different contents is replaced. Subscribers are notified once
 * after the state is updated (the runtime never calls this twice per
 * application, so a single notification matches the publish barrier).
 */
export function applyContributions(snapshot: PluginGeneration): void {
  state = Object.freeze(build(snapshot))
  for (const listener of listeners) { try { listener() } catch { /* Subscribers must not undo a committed generation. */ } }
}

/** Drop everything (used by tests and by the disposal of the runtime). */
export function resetContributions(): void {
  if (state === EMPTY) return
  state = EMPTY
  for (const listener of listeners) { try { listener() } catch { /* Subscribers must not undo a committed empty state. */ } }
}

export function getSnapshot(): ContributionsSnapshot { return state }

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Used by `useSyncExternalStore` directly. */
export function getContributionsVersion(): number { return state.version }
