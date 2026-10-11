import { boundedArgument, COMMAND_LIMIT, commandsForFile, parseCommandTemplate, type RunArg, type RunCommand } from '../run.ts'
import { compiledPluginSettings } from './settings.ts'
import type { CompiledPlugin } from './compile.ts'
import { CATALOG_BYTE_LIMIT, GENERATION_BYTE_LIMIT, PAYLOAD_BYTE_LIMIT } from './runtime-types.ts'

type ExecutablePlugin = Pick<CompiledPlugin, 'pluginId' | 'openWith' | 'commands' | 'configuration'>
type Owner = { version: string; compiled: ExecutablePlugin; validators: ReadonlyMap<string, (value: unknown) => boolean>; generation: number }
export type SettingsReader = (owner: string, key: string) => unknown

/** Main-owned data catalog. Registering, listing and removing never starts a process. */
export class ExecutableCatalog {
  private owners = new Map<string, Owner>()
  private entries: readonly RunCommand[] = []
  private serial = 0
  private readonly readSetting: SettingsReader
  constructor(readSetting: SettingsReader = () => undefined) { this.readSetting = readSetting }

  /** Validate the prospective aggregate without mutating the live catalog. */
  validate(version: string, source: ExecutablePlugin): void {
    const staged = new ExecutableCatalog(this.readSetting)
    staged.owners = new Map(this.owners); staged.entries = this.entries; staged.serial = this.serial
    staged.replace(version, source)
  }
  private batching = false
  transaction(operation: () => void): void {
    if (this.batching) throw new Error('Nested executable transaction')
    const owners = new Map(this.owners), entries = this.entries, serial = this.serial
    this.batching = true
    try { operation() } catch (error) { this.owners = owners; this.entries = entries; this.serial = serial; throw error } finally { this.batching = false }
  }

  replace(version: string, source: ExecutablePlugin): void {
    if (!boundedArgument(version, 128) || !version) throw new Error('Invalid executable version')
    if (!boundedArgument(source.pluginId, 64) || !/^[\w.-]+$/.test(source.pluginId)) throw new Error('Invalid executable owner')
    const compiled = structuredClone(source)
    // The compiler retains local configuration keys; the settings adapter uses owner-qualified ids.
    compiled.configuration = compiled.configuration.map(setting => ({ ...setting, id: setting.id.includes(':') ? setting.id : `${compiled.pluginId}:${setting.id}` }))
    if (new TextEncoder().encode(JSON.stringify(compiled)).length > PAYLOAD_BYTE_LIMIT) throw new Error('Executable payload exceeds 2 MiB')
    const owner: Owner = { version, compiled, validators: compiledPluginSettings(compiled).validators, generation: this.serial + 1 }
    const next = new Map(this.owners); next.set(compiled.pluginId, owner)
    if (next.size > 100) throw new Error('Executable catalog exceeds 100 owners')
    let totalBytes = 0
    for (const data of next.values()) totalBytes += new TextEncoder().encode(JSON.stringify(data.compiled)).length
    if (totalBytes > GENERATION_BYTE_LIMIT) throw new Error('Executable generation exceeds 32 MiB')
    const entries = this.materialize(next)
    const index = { owners: [...next].map(([id, data]) => [id, data.version]), entries: entries.map(({ id, name, owner, version, extensions, disabledReason }) => ({ id, name, owner, version, extensions, disabledReason })) }
    if (new TextEncoder().encode(JSON.stringify(index)).length > CATALOG_BYTE_LIMIT) throw new Error('Executable catalog exceeds 1 MiB')
    if (new TextEncoder().encode(JSON.stringify(entries)).length > GENERATION_BYTE_LIMIT) throw new Error('Executable generation exceeds 32 MiB')
    this.serial++; this.owners = next; this.entries = entries
  }
  remove(owner: string): void {
    if (this.owners.delete(owner)) { this.serial++; this.entries = this.entries.filter(entry => entry.owner !== owner) }
  }
  list(file?: string): RunCommand[] {
    // Values are refreshed from the validated, in-memory main settings reader, never from disk.
    const entries = this.entries.map(entry => this.resolve(entry))
    return file === undefined ? entries : commandsForFile(entries, file)
  }
  get(id: string): RunCommand | undefined {
    const entry = this.entries.find(entry => entry.id === id)
    return entry && this.resolve(entry)
  }
  private resolve(entry: RunCommand): RunCommand {
    if (entry.disabledReason) return entry
    const owner = this.owners.get(entry.owner!)!
    const settings: Record<string, string> = Object.create(null)
    for (const arg of entry.typedArgs ?? []) if (arg.kind === 'setting' && !Object.hasOwn(settings, arg.key)) {
      const id = `${entry.owner}:${arg.key}`
      const declaration = owner.compiled.configuration.find(setting => setting.id === id)
      const configured = this.readSetting(entry.owner!, arg.key)
      const value = configured === undefined ? declaration?.property.default : configured
      if (!declaration || !owner.validators.get(id)?.(value)) return { ...entry, disabledReason: `Invalid setting: ${arg.key}` }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return { ...entry, disabledReason: `Setting cannot be an argument: ${arg.key}` }
      const text = typeof value === 'string' ? value : typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
      if (!boundedArgument(text)) return { ...entry, disabledReason: `Setting argument exceeds 4 KB: ${arg.key}` }
      settings[arg.key] = text
    }
    return { ...entry, settings }
  }
  private materialize(owners: ReadonlyMap<string, Owner>): readonly RunCommand[] {
    const entries: RunCommand[] = [], ids = new Set<string>()
    const add = (owner: string, data: Owner, id: string, name: string, program: string | undefined, args: readonly RunArg[], extensions?: readonly string[]) => {
      if (!id.startsWith(`${owner}:`) || ids.has(id)) throw new Error('Invalid or duplicate executable id')
      if (entries.length >= COMMAND_LIMIT) throw new Error('Executable catalog exceeds 100 entries')
      const template = parseCommandTemplate({ id, name, program: program ?? 'disabled', args: [] })
      if (args.length > 64) throw new Error('Use at most 64 arguments')
      for (const arg of args) {
        if (arg.kind === 'text') { if (!boundedArgument(arg.value)) throw new Error('Argument exceeds 4 KB') }
        else if (arg.kind === 'setting') {
          if (!data.validators.has(`${owner}:${arg.key}`)) throw new Error('Setting must belong to executable owner')
        } else if (!['file', 'dir', 'name'].includes(arg.kind)) throw new Error('Invalid argument marker')
      }
      if (extensions?.some(ext => !/^\.[a-z0-9][a-z0-9._+-]*$/.test(ext))) throw new Error('Invalid executable extension')
      ids.add(id)
      entries.push(Object.freeze({ ...template, owner, version: data.version, generation: data.generation, typedArgs: Object.freeze(args.map(arg => Object.freeze({ ...arg }))), extensions: extensions && Object.freeze([...extensions]), ...(program === undefined ? { disabledReason: 'Command has no exec' } : {}) }))
    }
    for (const [owner, data] of owners) {
      for (const entry of data.compiled.openWith) add(owner, data, entry.id, entry.label, entry.program, entry.args, entry.extensions)
      for (const entry of data.compiled.commands) add(owner, data, entry.id, entry.title, entry.exec?.program, entry.exec?.args ?? [])
    }
    return Object.freeze(entries)
  }
}
