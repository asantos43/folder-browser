import type { CompiledPlugin } from './compile.ts'

export const activationKinds = ['settings', 'keys', 'languages', 'themes', 'texts', 'commands', 'menus', 'execution'] as const
export type ActivationKind = typeof activationKinds[number]
export interface ActivationContext {
  readonly enabled: boolean
  /** Commands without exec stay visible, but the host must not dispatch them. */
  readonly disabledCommands: ReadonlyMap<string, string>
}
export interface ActivationAdapter<Handle> {
  /** Pure validation/staging, including ownership conflicts; no live mutations.
   * Handles are immutable, reusable snapshots, with no subscriptions/resources.
   * Even disabled contributions must be validated here.
   * The command/menu gate receives only its strict contribution projection,
   * never exec templates or keymapKeys; handlers are supplied by the host.
   */
  prepare(owner: string, compiled: CompiledPlugin, context: ActivationContext): Handle
  /** Synchronous owner replacement. Never execute a plugin during publication. */
  commit(handle: Handle): void
  /** Synchronous, idempotent and restricted to this owner's entries. */
  remove(owner: string): void
}
export type ActivationAdapters<Handles extends Record<ActivationKind, unknown>> = {
  [Kind in ActivationKind]: ActivationAdapter<Handles[Kind]>
} & {
  /** Mandatory shared notification barrier for ALL eight registries.
   * Call operation exactly once, synchronously; buffer all subscriber callbacks
   * until it returns, discard them if it throws. Notifications must not throw
   * into this operation. No nested per-registry transactions during commits.
   * Synchronous code alone does not prevent a registry subscriber seeing a
   * partial publication: concrete adapters must implement this barrier.
   */
  publish(operation: () => void): void
}
export interface RollbackFailure { readonly adapter: ActivationKind; readonly cause: unknown }
export class ActivationError extends Error {
  readonly owner: string
  readonly adapter: ActivationKind | 'payload'
  readonly phase: 'prepare' | 'commit' | 'remove'
  readonly rollbackFailures: readonly RollbackFailure[]
  constructor(owner: string, adapter: ActivationKind | 'payload', phase: ActivationError['phase'], cause: unknown, rollbackFailures: readonly RollbackFailure[] = []) {
    super(`Plugin ${owner}: ${adapter} ${phase} failed`, { cause })
    this.name = 'ActivationError'
    this.owner = owner; this.adapter = adapter; this.phase = phase
    this.rollbackFailures = Object.freeze([...rollbackFailures])
  }
}

/** No IO, timers or handlers in the payload. Host adapters own all registries.
 * Input is the validated compiler/cache generation; take a private frozen copy
 * so the caller or a host adapter cannot mutate a saved rollback generation.
 * Only the current handles and one candidate are retained for each owner.
 */
export function createActivation<Handles extends Record<ActivationKind, unknown>>(adapters: ActivationAdapters<Handles>) {
  type Generation = { compiled: CompiledPlugin; handles: Handles; enabled: boolean }
  const current = new Map<string, Generation>()
  let busy = false
  function exclusive(operation: () => void): void {
    if (busy) throw new Error('Reentrant plugin activation')
    busy = true
    try { operation() } finally { busy = false }
  }
  function restore(owner: string, previous: Generation | undefined, touched: readonly ActivationKind[]): RollbackFailure[] {
    const failures: RollbackFailure[] = []
    for (const kind of [...touched].reverse()) {
      // Also undo the adapter that added an entry and then threw. Try restore
      // even when remove fails, and never let one failure skip another adapter.
      try { adapters[kind].remove(owner) } catch (cause) { failures.push({ adapter: kind, cause }) }
      if (previous && (previous.enabled || kind === 'settings')) {
        try { adapters[kind].commit(previous.handles[kind]) } catch (cause) { failures.push({ adapter: kind, cause }) }
      }
    }
    return failures
  }
  function replace(owner: string, compiled: CompiledPlugin, enabled: boolean): void {
    try {
      compiled = structuredClone(compiled) // Reject functions, including payload handlers.
      const freeze = (value: unknown): void => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
        for (const child of Object.values(value)) freeze(child)
        Object.freeze(value)
      }
      freeze(compiled)
    } catch (cause) { throw new ActivationError(owner, 'payload', 'prepare', cause) }
    if (!owner || compiled.pluginId !== owner || compiled.contribution.pluginId !== owner) {
      throw new ActivationError(owner, 'payload', 'prepare', new Error('Compiled owner mismatch'))
    }
    const previous = current.get(owner)
    const handles = {} as Handles
    const disabledCommands = new Map(compiled.commands.filter(command => !command.exec).map(command => [command.id, 'Command has no exec']))
    const context: ActivationContext = { enabled, disabledCommands }
    for (const kind of activationKinds) {
      try { handles[kind] = adapters[kind].prepare(owner, compiled, context) }
      catch (cause) { throw new ActivationError(owner, kind, 'prepare', cause) }
    }
    const candidate: Generation = { compiled, handles, enabled }
    adapters.publish(() => {
      const touched: ActivationKind[] = []
      for (const kind of activationKinds) {
        touched.push(kind)
        try {
          if (enabled || kind === 'settings') adapters[kind].commit(handles[kind])
          else adapters[kind].remove(owner)
        } catch (cause) {
          throw new ActivationError(owner, kind, 'commit', cause, restore(owner, previous, touched))
        }
      }
      current.set(owner, candidate)
    })
  }
  return {
    /** enabled=false registers disabled schemas without activating other types. */
    activate(owner: string, compiled: CompiledPlugin, options: { enabled?: boolean } = {}): void {
      exclusive(() => replace(owner, compiled, options.enabled ?? true))
    },
    update(owner: string, compiled: CompiledPlugin): void {
      exclusive(() => replace(owner, compiled, current.get(owner)?.enabled ?? true))
    },
    deactivate(owner: string): void {
      exclusive(() => {
        const previous = current.get(owner)
        if (previous?.enabled) replace(owner, previous.compiled, false)
      })
    },
    remove(owner: string): void {
      exclusive(() => {
        const previous = current.get(owner)
        if (!previous) return
        adapters.publish(() => {
          const touched: ActivationKind[] = []
          for (const kind of activationKinds) {
            touched.push(kind)
            try { adapters[kind].remove(owner) }
            catch (cause) { throw new ActivationError(owner, kind, 'remove', cause, restore(owner, previous, touched)) }
          }
          current.delete(owner)
        })
      })
    },
  }
}
