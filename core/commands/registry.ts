import { compileWhen, type WhenContext } from './when.ts'

export interface CommandDef {
  id: string
  title: string
  category: string
  when?: string
  keys?: string[]
  menu?: { menu: string; group: string; order: number }
  palette?: boolean
}

export type HandlerMap<Ids extends string> = { [Id in Ids]: () => void }
export type CommandHandlers<Ids extends string> = HandlerMap<Ids>

interface StoredCommand { definition: Readonly<CommandDef>; condition?: (context: WhenContext) => boolean }

export function createRegistry() {
  const commands = new Map<string, StoredCommand>()
  return {
    register(definition: CommandDef): void {
      if (!definition || typeof definition.id !== 'string' || !definition.id.trim()) throw new TypeError('Command id must be a non-empty string')
      const colon = definition.id.indexOf(':')
      if (colon >= 0 && (colon === 0 || colon === definition.id.length - 1 || definition.id.indexOf(':', colon + 1) !== -1)) {
        throw new TypeError(`Plugin command id must be <plugin id>:<name>: ${definition.id}`)
      }
      if (commands.has(definition.id)) throw new Error(`Command id already registered: ${definition.id}`)
      const condition = definition.when === undefined ? undefined : compileWhen(definition.when)
      const frozen = Object.freeze({ ...definition, ...(definition.keys ? { keys: Object.freeze([...definition.keys]) as unknown as string[] } : {}), ...(definition.menu ? { menu: Object.freeze({ ...definition.menu }) } : {}) })
      commands.set(definition.id, { definition: frozen, condition })
    },
    unregister(id: string): boolean { return commands.delete(id) },
    get(id: string): Readonly<CommandDef> | undefined { return commands.get(id)?.definition },
    list(): ReadonlyArray<Readonly<CommandDef>> { return [...commands.values()].map((item) => item.definition) },
    available(context: WhenContext): ReadonlyArray<Readonly<CommandDef>> {
      const result: Readonly<CommandDef>[] = []
      for (const item of commands.values()) if (!item.condition || item.condition(context)) result.push(item.definition)
      return result
    },
  }
}
