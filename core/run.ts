/** Command templates are data, never a shell command line. Safe to import in the renderer. */
export interface RunCommand { id: string; name: string; program: string; args: string[]; timeoutMs?: number; cwd?: string }
export interface RunContext { file: string; dir: string; name: string }
export interface Invocation { program: string; args: string[]; cwd?: string }
export const COMMAND_LIMIT = 100
const bytes = new TextEncoder()
const bounded = (v: unknown, max = 4096): v is string => typeof v === 'string' && !v.includes('\0') && v.length <= max && (v.length <= max / 3 || bytes.encode(v).length <= max)
export const absoluteProgram = (v: string): boolean => v.startsWith('/') || /^[a-z]:[\\/]/i.test(v) || /^\\\\[^\\]+\\[^\\]+/.test(v)
export const validProgram = (v: unknown): v is string => bounded(v) && !!v.trim() && (absoluteProgram(v) || (!/[\\/:]/.test(v) && v !== '.' && v !== '..' && !v.startsWith('~')))

export function parseCommandTemplate(value: unknown): RunCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid command')
  const v = value as Record<string, unknown>
  if (!bounded(v.id, 128) || !/^[\w-]+$/.test(v.id) || !bounded(v.name, 256) || !v.name.trim() || !validProgram(v.program)) throw new Error('Invalid command name or program: use an absolute path or a PATH name')
  if (!Array.isArray(v.args) || v.args.length > 64 || !v.args.every(a => bounded(a))) throw new Error('Use at most 64 arguments of 4 KB, without NUL')
  if (v.timeoutMs !== undefined && (typeof v.timeoutMs !== 'number' || !Number.isSafeInteger(v.timeoutMs) || v.timeoutMs < 1 || v.timeoutMs > 2_147_483_647)) throw new Error('Invalid timeout')
  if (v.cwd !== undefined && (!bounded(v.cwd) || (v.cwd !== '{dir}' && !absoluteProgram(v.cwd)))) throw new Error('Working directory must be absolute or {dir}')
  return { id: v.id, name: v.name, program: v.program, args: [...v.args] as string[], ...(v.cwd === undefined ? {} : { cwd: v.cwd as string }), ...(v.timeoutMs === undefined ? {} : { timeoutMs: v.timeoutMs as number }) }
}

export function normalizeCommands(value: unknown): { value: RunCommand[]; warning?: string } {
  if (!Array.isArray(value)) return { value: [], warning: 'Invalid command list; discarded' }
  const commands: RunCommand[] = [], ids = new Set<string>()
  let invalid = Math.max(0, value.length - COMMAND_LIMIT)
  for (const item of value.slice(0, COMMAND_LIMIT)) {
    try { const command = parseCommandTemplate(item); if (ids.has(command.id)) throw new Error('Duplicate id'); ids.add(command.id); commands.push(command) } catch { invalid++ }
  }
  return { value: commands, ...(invalid ? { warning: `${invalid} invalid or excess commands discarded` } : {}) }
}

export function buildInvocation(command: RunCommand, context: RunContext): Invocation {
  // Templates were validated on ingestion; expansion remains bounded and never recursively expands tokens.
  const substitute = (arg: string) => {
    const result = arg.replace(/\{(file|dir|name)\}/g, (_token, key: keyof RunContext) => context[key])
    if (!bounded(result)) throw new Error('Expanded argument exceeds 4 KB or contains NUL')
    return result
  }
  if (!absoluteProgram(context.file) || !absoluteProgram(context.dir)) throw new Error('File and directory must be absolute')
  return { program: command.program, args: command.args.map(substitute), ...(command.cwd === undefined ? {} : { cwd: substitute(command.cwd) }) }
}
