import type { ActivationAdapters, ActivationAdapter, ActivationKind } from '../core/plugins/activation.ts'
import type { GenerationHandle, GenerationStore, MainMenuRegistry } from '../core/plugins/generation.ts'
import type { ExecutableCatalog } from '../core/plugins/executables.ts'
import type { SettingsRegistry } from '../core/settings/registry.ts'
import type { KeysHost } from './keys-host.ts'
import { createRegistry } from '../core/commands/registry.ts'
import { createLanguageIndex, type LanguageRegistry } from '../core/languages/registry.ts'
import { setPluginLanguageIndex } from '../core/filekind.ts'

type Compiled = Parameters<ActivationAdapter<unknown>['prepare']>[1]
type Context = Parameters<ActivationAdapter<unknown>['prepare']>[2]
export interface MainAdapterDependencies {
  registry: SettingsRegistry
  keys: KeysHost
  languages: LanguageRegistry
  runCatalogue: ExecutableCatalog
  /** The lazy host creates this pure store; this module has no eager plugin imports. */
  generation: GenerationStore
  /** Package version comes from the installed index, not from CompiledPlugin. */
  version(owner: string): string
  commands?: ReturnType<typeof createRegistry>
  /** The lazy host creates the real menu registry alongside the generation. */
  menus: MainMenuRegistry
}
export interface MainActivationHandle {
  readonly owner: string
  readonly compiled: Compiled
  readonly generation: GenerationHandle
  readonly version: string
}
type Handles = Record<ActivationKind, MainActivationHandle>
const kinds: readonly ActivationKind[] = ['settings', 'keys', 'languages', 'themes', 'texts', 'commands', 'menus', 'execution']
function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}

/** Concrete synchronous adapters. Registration never supplies an executable handler. */
export function createMainAdapters(deps: MainAdapterDependencies) {
  const { registry, keys, languages, runCatalogue, generation } = deps
  const commands = deps.commands ?? createRegistry(), menus = deps.menus
  const installed = Object.fromEntries(kinds.map(kind => [kind, new Map<string, MainActivationHandle>()])) as Record<ActivationKind, Map<string, MainActivationHandle>>
  const prepared = new WeakMap<Compiled, { context: Context; handle: MainActivationHandle }>()
  const issued = new WeakSet<MainActivationHandle>()
  let publishing = false
  function prepare(owner: string, compiled: Compiled, context: Context): MainActivationHandle {
    const cached = prepared.get(compiled)
    if (cached?.context === context && cached.handle.owner === owner) return cached.handle
    const staged = generation.stage(owner, compiled, context)
    // Validation is shared by all eight prepares, including disabled contributions.
    const projection = staged.plugin
    const commandIds = new Set(compiled.commands.map(command => command.id))
    const strict = staged.contribution
    for (const command of strict.commands ?? []) {
      if (!commandIds.has(command.id)) throw new Error('Command projection mismatch')
      if (commands.get(command.id) && !installed.commands.get(owner)?.compiled.commands.some(item => item.id === command.id)) throw new Error('Command owned by another registration')
    }
    if (commandIds.size !== (strict.commands ?? []).length) throw new Error('Command projection mismatch')
    for (const item of strict.menuItems ?? []) if (menus.get(item.id) && !installed.menus.get(owner)?.compiled.contribution.menuItems.some(entry => entry.id === item.id)) throw new Error('Menu owned by another registration')
    for (const definition of staged.definitions) if (registry.get(definition.id) && !installed.settings.get(owner)?.generation.definitions.some(item => item.id === definition.id)) throw new Error('Setting owned by another registration')
    // Validate even when the eventual generation is settings-only.
    languages.validate({ pluginId: owner, languages: compiled.languages })
    const version = deps.version(owner)
    runCatalogue.validate(version, { pluginId: owner, commands: compiled.commands, openWith: compiled.openWith, configuration: compiled.configuration })
    // Projection has already been detached; executable data stays in this private handle.
    const source = structuredClone(compiled)
    freeze(source)
    const handle = Object.freeze({ owner, compiled: source, generation: staged, version })
    if (projection.owner !== owner) throw new Error('Generation owner mismatch')
    prepared.set(compiled, { context, handle }); issued.add(handle)
    return handle
  }
  function clear(kind: ActivationKind, owner: string): void {
    const previous = installed[kind].get(owner)
    if (!previous) { if (kind === 'execution' && publishing) generation.resolveKeys(keys.resolvedEntries()); return }
    if (!publishing) throw new Error('Adapter removal requires publication')
    if (kind === 'settings') {
      for (const definition of previous.generation.definitions) registry.remove(definition.id)
      generation.remove(owner)
    } else if (kind === 'keys') keys.removePlugin(owner)
    else if (kind === 'languages') languages.remove(owner)
    else if (kind === 'commands') for (const command of previous.compiled.commands) commands.unregister(command.id)
    else if (kind === 'menus') for (const item of previous.compiled.contribution.menuItems) menus.remove(item.id)
    else if (kind === 'execution') runCatalogue.remove(owner)
    installed[kind].delete(owner)
    if (kind === 'execution' && publishing) generation.resolveKeys(keys.resolvedEntries())
  }
  function commit(kind: ActivationKind, handle: MainActivationHandle): void {
    if (!publishing) throw new Error('Adapter commit requires publication')
    if (!issued.has(handle)) throw new Error('Foreign main activation handle')
    const previous = installed[kind].get(handle.owner)
    // Arm ownership before a writer that may mutate and then throw.
    installed[kind].set(handle.owner, handle)
    if (kind === 'settings') {
      for (const definition of previous?.generation.definitions ?? []) registry.remove(definition.id)
      for (const definition of handle.generation.definitions) registry.defineSetting(definition)
      // A single owner projection covers all renderer contribution types; other
      // adapters publish their real main registries inside the same barrier.
      generation.commit(handle.generation)
    } else if (kind === 'keys') keys.setPlugin(handle.owner, handle.compiled)
    else if (kind === 'languages') languages.set({ pluginId: handle.owner, languages: handle.compiled.languages })
    else if (kind === 'commands') {
      for (const command of previous?.compiled.commands ?? []) commands.unregister(command.id)
      for (const command of handle.compiled.contribution.commands) commands.register(command)
    } else if (kind === 'menus') {
      for (const item of previous?.compiled.contribution.menuItems ?? []) menus.remove(item.id)
      for (const item of handle.compiled.contribution.menuItems) menus.add(item)
    } else if (kind === 'execution') {
      runCatalogue.replace(handle.version, { pluginId: handle.owner, commands: handle.compiled.commands, openWith: handle.compiled.openWith, configuration: handle.compiled.configuration })
      generation.resolveKeys(keys.resolvedEntries())
    }
  }
  const adapters = Object.fromEntries(kinds.map(kind => [kind, { prepare, commit: (handle: MainActivationHandle) => commit(kind, handle), remove: (owner: string) => clear(kind, owner) }])) as Omit<ActivationAdapters<Handles>, 'publish'>
  const complete: ActivationAdapters<Handles> = {
    ...adapters,
    publish(operation: () => void): void {
      if (publishing) throw new Error('Reentrant main publication')
      publishing = true
      const notifications = new Set<() => void>()
      const enqueue = (listener: () => void) => { notifications.add(listener) }
      const before = Object.fromEntries(kinds.map(kind => [kind, new Map(installed[kind])])) as typeof installed
      try {
        // Commits only use direct mutations; all registry transactions are here.
        generation.transaction(() => keys.transaction(() => registry.transaction(() => runCatalogue.transaction(() => languages.transaction(() => {
          operation()
          setPluginLanguageIndex(createLanguageIndex(languages))
        })), enqueue), enqueue), enqueue)
      } catch (error) {
        for (const kind of kinds) installed[kind] = before[kind]
        notifications.clear()
        publishing = false
        throw error
      }
      try {
        for (const listener of notifications) { try { listener() } catch { /* Notification errors cannot roll back committed state. */ } }
      } finally { publishing = false }
    },
  }
  return { adapters: complete, generation, commands, menus }
}
