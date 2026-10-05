import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FileSource } from './sources.ts'

/**
 * A file that could run as a program when another application (or the system) opens it: it is never handed over. (A snapshot can hold anything a page linked
 * to, and the person choosing "Open with…" has no way to tell a harmless download from one of these by its icon.)
 */
const RISKY = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|wsf|wsh|jar|app|command|desktop|sh|bash|lnk|url|reg|appimage|run|bin|dll|so|dylib)$/i
export const isRiskyName = (name: string): boolean => RISKY.test(name)

/** A name that is safe to write in a folder of our own: the last part of the path, without separators or control characters. */
export function plainName(name: string): string {
  const last = name.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const clean = [...last].map((ch) => (ch.charCodeAt(0) < 32 || '<>:"|?*'.includes(ch) ? '_' : ch)).join('').replace(/^\.+/, '_').replace(/[. ]+$/, '').slice(0, 120)
  return clean || 'file'
}

export type Staged = { dir: string; file: string } | { error: 'no-file' | 'risky' }

export const STAGE_PREFIX = 'wsnp-open-'

/**
 * A copy of a file of a snapshot (or of an entry of a ZIP in it) in a folder of its own under `tempRoot`, read-only, for an application the user chose.
 * The caller removes the folder (`fs.rm(dir)`) when the application is done or at quit; `sweepStaged` removes what a crash left.
 */
export async function stageFile(registry: FileSource, id: string, name: string, tempRoot: string): Promise<Staged> {
  const base = plainName(name)
  if (isRiskyName(base)) return { error: 'risky' }
  const stream = await registry.stream(id, name)
  if (!stream) return { error: 'no-file' }
  const dir = await fs.promises.mkdtemp(path.join(tempRoot, STAGE_PREFIX))
  const file = path.join(dir, base)
  try {
    await pipeline(stream, fs.createWriteStream(file, { mode: 0o600 }))
    await fs.promises.chmod(file, 0o400)
    return { dir, file }
  } catch (err) {
    await removeStaged(dir)
    throw err
  }
}

/**
 * Removes the folder of a staged copy. The copy is read-only, and Windows will not delete a read-only file: it is made writable first.
 * (Synchronous too, for quit, where nothing waits.)
 */
export async function removeStaged(dir: string): Promise<void> {
  for (const name of await fs.promises.readdir(dir).catch(() => [])) await fs.promises.chmod(path.join(dir, name), 0o600).catch(() => undefined)
  await fs.promises.rm(dir, { recursive: true, force: true })
}
export function removeStagedSync(dir: string): void {
  try {
    for (const name of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, name), 0o600)
  } catch {
    // already gone
  }
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Removes the folders of files staged more than `maxAgeMs` ago (a session that ended badly left them). */
export async function sweepStaged(tempRoot: string, maxAgeMs: number, now = Date.now()): Promise<number> {
  let removed = 0
  for (const entry of await fs.promises.readdir(tempRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !entry.name.startsWith(STAGE_PREFIX)) continue
    const dir = path.join(tempRoot, entry.name)
    const stat = await fs.promises.stat(dir).catch(() => undefined)
    if (stat && now - stat.mtimeMs > maxAgeMs) {
      await removeStaged(dir)
      removed++
    }
  }
  return removed
}
