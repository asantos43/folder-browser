import fsp from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import { INNER } from '../vpath.ts'
import { resolveInside } from './guard.ts'
import { nameProblem } from './names.ts'

/** Why an operation was not done. The interface turns each into words; nothing is half done (a failed move leaves the item where it was). */
export type OpError =
  | 'invalid-name'
  | 'exists'
  | 'not-found'
  | 'not-folder'
  | 'outside'
  | 'into-itself'
  | 'same-place'
  | 'denied'
  | 'unsupported'
  | 'trash-failed'
  /** A ZIP that cannot be written back faithfully (ZIP64, encryption, a method or names that cannot be kept). */
  | 'read-only'
  /** The ZIP was changed by something else while it was being written: nothing was done. */
  | 'changed'
  | 'too-large'
  | 'failed'
export type OpResult = { ok: true; path: string } | { ok: false; error: OpError }

const fail = (error: OpError): OpResult => ({ ok: false, error })
const join = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name)

function errorOf(err: unknown): OpError {
  switch ((err as NodeJS.ErrnoException).code) {
    case 'EEXIST':
    case 'ENOTEMPTY':
      return 'exists'
    case 'ENOENT':
      return 'not-found'
    case 'ENOTDIR':
      return 'not-folder'
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'denied'
    default:
      return 'failed'
  }
}

/** A folder of the disk inside the root, by its path relative to it (`''` is the root): its real path, or why not. */
async function folderAt(root: string, relative: string): Promise<{ real: string } | { error: OpError }> {
  if (relative.includes(INNER)) return { error: 'unsupported' }
  // The root itself is given as it is spelled (`resolveInside` answers it unchanged), but everything else here is a real path: a root that is, or is under, a symbolic link
  // (macOS: the temporary folder is /var, a link to /private/var) would never be seen to contain what is in it, and a folder could be "moved into itself" as far as the check goes.
  const real = relative === '' ? await fsp.realpath(root).catch(() => null) : await resolveInside(root, relative)
  if (!real) {
    // Not there at all is one answer; there, but out of the root (a `..`, a link that leaves it), another.
    const lexical = !relative.includes('\\') && !relative.startsWith('/') && !relative.split('/').some((p) => p === '..' || p === '.')
    const exists = lexical && (await fsp.lstat(path.join(root, ...relative.split('/').filter(Boolean))).then(() => true, () => false))
    return { error: lexical && !exists ? 'not-found' : 'outside' }
  }
  const stat = await fsp.stat(real).catch(() => null)
  return stat?.isDirectory() ? { real } : { error: stat ? 'not-folder' : 'not-found' }
}

interface Entry {
  /** Where it is on the disk: the folder it is in (real), and its own name. A symbolic link is the link itself, never what it points to. */
  parent: string
  name: string
  full: string
  stat: Stats
  /** The folder's path relative to the root. */
  parentRelative: string
}

/** An existing item (not the root, not inside a ZIP) found by its parent, so that a symbolic link is the link and not its target. */
async function entryAt(root: string, relative: string): Promise<Entry | { error: OpError }> {
  if (relative === '' || relative.includes(INNER)) return { error: 'unsupported' }
  const parts = relative.split('/')
  const name = parts.at(-1)!
  if (name === '' || name === '.' || name === '..' || name.includes('\\') || name.includes('\0')) return { error: 'outside' }
  const parentRelative = parts.slice(0, -1).join('/')
  const parent = await folderAt(root, parentRelative)
  if ('error' in parent) return parent
  const full = path.join(parent.real, name)
  const stat = await fsp.lstat(full).catch(() => null)
  return stat ? { parent: parent.real, name, full, stat, parentRelative } : { error: 'not-found' }
}

/**
 * Renames without ever replacing: a file is hard-linked to its new name (which fails if the name is taken, atomically) and the old name removed; where that cannot be done (a
 * folder, a file system with no links) the name is looked for first, and then the item is renamed. A change of case alone is allowed where the file system sees both names as
 * one (macOS, Windows).
 */
async function moveWithoutReplacing(from: string, to: string, source: Stats): Promise<OpError | null> {
  const taken = await fsp.lstat(to).catch(() => null)
  if (taken) {
    const sameItem = taken.ino === source.ino && taken.dev === source.dev && path.dirname(from) === path.dirname(to) && from.toLowerCase() === to.toLowerCase()
    if (!sameItem) return 'exists'
    await fsp.rename(from, to)
    return null
  }
  try {
    if (source.isFile()) {
      try {
        await fsp.link(from, to)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EEXIST') return 'exists'
        if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV' && code !== 'EMLINK' && code !== 'ENOSYS') throw err
        await fsp.rename(from, to)
        return null
      }
      await fsp.unlink(from)
      return null
    }
    await fsp.rename(from, to)
    return null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') return await copyThenRemove(from, to)
    return errorOf(err)
  }
}

/** A move across file systems: copied (nothing replaced, links kept as links), and only then is the original removed. A copy that fails is removed and the original is left. */
async function copyThenRemove(from: string, to: string): Promise<OpError | null> {
  try {
    await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true })
  } catch (err) {
    await fsp.rm(to, { recursive: true, force: true }).catch(() => undefined)
    return errorOf(err)
  }
  try {
    await fsp.rm(from, { recursive: true })
    return null
  } catch (err) {
    return errorOf(err)
  }
}

/** A new empty file or folder in `parent` (a folder of the root, `''` for the root itself). Never replaces: a name that is taken is `exists`. */
export async function createEntry(root: string, parent: string, name: string, kind: 'file' | 'dir'): Promise<OpResult> {
  if (nameProblem(name)) return fail('invalid-name')
  const dir = await folderAt(root, parent)
  if ('error' in dir) return fail(dir.error)
  const target = path.join(dir.real, name)
  try {
    if (kind === 'dir') await fsp.mkdir(target)
    else await (await fsp.open(target, 'wx')).close()
    return { ok: true, path: join(parent, name) }
  } catch (err) {
    return fail(errorOf(err))
  }
}

/** The same item under another name, in the same folder. */
export async function renameEntry(root: string, relative: string, newName: string): Promise<OpResult> {
  if (nameProblem(newName)) return fail('invalid-name')
  const entry = await entryAt(root, relative)
  if ('error' in entry) return fail(entry.error)
  if (entry.name === newName) return fail('same-place')
  const error = await moveWithoutReplacing(entry.full, path.join(entry.parent, newName), entry.stat)
  return error ? fail(error) : { ok: true, path: join(entry.parentRelative, newName) }
}

/** The item into another folder of the same root, under its own name. A folder cannot go into itself, and nothing is replaced. */
export async function moveEntry(root: string, relative: string, toFolder: string): Promise<OpResult> {
  const entry = await entryAt(root, relative)
  if ('error' in entry) return fail(entry.error)
  const dest = await folderAt(root, toFolder)
  if ('error' in dest) return fail(dest.error)
  if (dest.real === entry.parent) return fail('same-place')
  if (entry.stat.isDirectory() && (dest.real === entry.full || dest.real.startsWith(entry.full + path.sep))) return fail('into-itself')
  const error = await moveWithoutReplacing(entry.full, path.join(dest.real, entry.name), entry.stat)
  return error ? fail(error) : { ok: true, path: join(toFolder, entry.name) }
}

/**
 * A name for a copy that is free in `dir`: the name itself when it is, else `name (2)`, `name (3)`… with the number before the extension (`a (2).txt`, `archive (2).tar.gz`)
 * and at the end for a folder or a name with no extension. Nothing is ever replaced: a copy keeps both.
 */
async function freeName(dir: string, name: string, folder: boolean): Promise<string> {
  const taken = async (candidate: string) => (await fsp.lstat(path.join(dir, candidate)).catch(() => null)) !== null
  if (!(await taken(name))) return name
  const tar = /\.tar\.[a-z0-9]+$/i.exec(name)
  const dot = tar ? tar.index : name.lastIndexOf('.')
  const split = !folder && dot > 0 ? dot : name.length
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${name.slice(0, split)} (${n})${name.slice(split)}`
    if (!(await taken(candidate))) return candidate
  }
  return `${name} (${Date.now()})`
}

/**
 * A copy of an item in another folder of the same root, or in the folder it is in (a duplicate), under its own name or, if that is taken, a numbered one (`a (2).txt`):
 * nothing is replaced. A folder is copied with all that is in it, symbolic links as links and never through their targets, times kept; a folder cannot be copied into itself.
 * A copy that fails half way is removed.
 */
export async function copyEntry(root: string, relative: string, toFolder: string): Promise<OpResult> {
  const entry = await entryAt(root, relative)
  if ('error' in entry) return fail(entry.error)
  const dest = await folderAt(root, toFolder)
  if ('error' in dest) return fail(dest.error)
  if (entry.stat.isDirectory() && (dest.real === entry.full || dest.real.startsWith(entry.full + path.sep))) return fail('into-itself')
  const name = await freeName(dest.real, entry.name, entry.stat.isDirectory())
  const target = path.join(dest.real, name)
  try {
    await fsp.cp(entry.full, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true })
    return { ok: true, path: join(toFolder, name) }
  } catch (err) {
    await fsp.rm(target, { recursive: true, force: true }).catch(() => undefined)
    return fail(errorOf(err))
  }
}

/**
 * Removes an item: to the trash (`trash` is the system's, handed in: this module knows no Electron), or for good. A symbolic link is removed as the link. A trash that
 * cannot take the item is `trash-failed`, and the caller decides whether to ask for a permanent delete.
 */
export async function removeEntry(root: string, relative: string, how: 'trash' | 'forever', trash: (file: string) => Promise<void>): Promise<OpResult> {
  const entry = await entryAt(root, relative)
  if ('error' in entry) return fail(entry.error)
  if (how === 'trash') {
    try {
      await trash(entry.full)
      return { ok: true, path: relative }
    } catch {
      return fail('trash-failed')
    }
  }
  try {
    await fsp.rm(entry.full, { recursive: true })
    return { ok: true, path: relative }
  } catch (err) {
    return fail(errorOf(err))
  }
}
