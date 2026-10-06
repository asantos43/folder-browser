import fs from 'node:fs/promises'
import path from 'node:path'

/** One thing in the trash, as the trash records it. */
export interface TrashItem {
  /** The name it has in the trash (what `restore` takes). */
  name: string
  /** Where it was, when the trash says (the freedesktop trash writes it, macOS does not). */
  originalPath?: string
  /** When it was thrown away, as the trash wrote it (local time, no zone). */
  deletedAt?: string
  kind: 'dir' | 'file'
  size: number
}

export type RestoreResult = { restored: string } | { error: 'no-item' | 'unknown-origin' | 'exists' | 'failed'; message?: string }

/**
 * The folder that holds the trashed files, where the trash is a folder: `$XDG_DATA_HOME/Trash/files` (default `~/.local/share/Trash/files`) on Linux, `~/.Trash` on macOS. The Recycle
 * Bin of Windows is not a folder to read, so there is none (null) and the interface opens the system's own.
 */
export function trashFolderOf(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (platform === 'linux') return path.join(env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local', 'share'), 'Trash', 'files')
  if (platform === 'darwin') return path.join(home, '.Trash')
  return null
}

/** The `Path=` and `DeletionDate=` of a `.trashinfo` file (freedesktop.org Trash specification). */
export function parseTrashInfo(text: string): { originalPath?: string; deletedAt?: string } {
  const out: { originalPath?: string; deletedAt?: string } = {}
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key === 'Path') {
      try {
        const decoded = decodeURIComponent(value)
        if (path.isAbsolute(decoded)) out.originalPath = decoded
      } catch {
        // a path that is not valid is not used
      }
    } else if (key === 'DeletionDate') out.deletedAt = value
  }
  return out
}

/** A name that is one part of a path, in the trash folder and nowhere else. */
const plain = (name: string): boolean => name !== '' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name)

/** The trash: listing it, putting something back where it was, and emptying it. */
export class Trash {
  private readonly files: string
  /** The folder of the `.trashinfo` files, where the trash has one (the freedesktop trash: `info`, beside `files`). */
  private readonly info: string | null

  constructor(files: string, hasInfo = path.basename(files) === 'files') {
    this.files = files
    this.info = hasInfo ? path.join(path.dirname(files), 'info') : null
  }

  async list(): Promise<TrashItem[]> {
    const names = await fs.readdir(this.files).catch(() => [])
    const items = await Promise.all(
      names.map(async (name): Promise<TrashItem | null> => {
        const stat = await fs.lstat(path.join(this.files, name)).catch(() => null)
        if (!stat) return null
        const record = this.info ? parseTrashInfo(await fs.readFile(path.join(this.info, `${name}.trashinfo`), 'utf8').catch(() => '')) : {}
        return { name, ...record, kind: stat.isDirectory() ? 'dir' : 'file', size: stat.isDirectory() ? 0 : stat.size }
      }),
    )
    return items.filter((i): i is TrashItem => i !== null).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '') || a.name.localeCompare(b.name))
  }

  /** Puts an item back where it was. Never over something that is there now, and never when the trash does not say where it was. */
  async restore(name: string): Promise<RestoreResult> {
    if (!plain(name)) return { error: 'no-item' }
    const from = path.join(this.files, name)
    if (!(await fs.lstat(from).catch(() => null))) return { error: 'no-item' }
    const record = this.info ? parseTrashInfo(await fs.readFile(path.join(this.info, `${name}.trashinfo`), 'utf8').catch(() => '')) : {}
    if (!record.originalPath) return { error: 'unknown-origin' }
    if (await fs.lstat(record.originalPath).catch(() => null)) return { error: 'exists' }
    try {
      await fs.mkdir(path.dirname(record.originalPath), { recursive: true })
      try {
        await fs.rename(from, record.originalPath)
      } catch (err) {
        // Another disk: copy, then remove.
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
        await fs.cp(from, record.originalPath, { recursive: true, errorOnExist: true, force: false })
        await fs.rm(from, { recursive: true, force: true })
      }
      if (this.info) await fs.rm(path.join(this.info, `${name}.trashinfo`), { force: true })
      return { restored: record.originalPath }
    } catch (err) {
      return { error: 'failed', message: (err as Error).message }
    }
  }

  /** Deletes everything in the trash for good; how many items there were. */
  async empty(): Promise<number> {
    const names = await fs.readdir(this.files).catch(() => [])
    for (const name of names) await fs.rm(path.join(this.files, name), { recursive: true, force: true })
    if (this.info) for (const name of await fs.readdir(this.info).catch(() => [])) await fs.rm(path.join(this.info, name), { recursive: true, force: true })
    return names.length
  }
}
