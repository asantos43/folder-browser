import fs from 'node:fs'
import path from 'node:path'

/** The folders the user pinned to the side bar, kept in one small JSON file of the user's own profile (their paths, in the order they were pinned). */
export class FavoriteFolders {
  private paths: string[] = []
  private readonly file: string
  private readonly max: number

  constructor(file: string, max = 50) {
    this.file = file
    this.max = max
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Array.isArray(raw)) this.paths = raw.filter((p): p is string => typeof p === 'string' && p.length < 4096).slice(0, max)
    } catch {
      // no list yet, or one that cannot be read: start empty
    }
  }

  list(): string[] {
    return [...this.paths]
  }

  has(folder: string): boolean {
    return this.paths.includes(folder)
  }

  /** Pins a folder; one that is pinned already stays where it is. False when the list is full. */
  add(folder: string): boolean {
    if (this.paths.includes(folder)) return true
    if (this.paths.length >= this.max) return false
    this.paths = [...this.paths, folder]
    this.save()
    return true
  }

  remove(folder: string): void {
    this.paths = this.paths.filter((p) => p !== folder)
    this.save()
  }

  /** Moves a pinned folder to a place in the list (to reorder). */
  move(folder: string, to: number): void {
    const from = this.paths.indexOf(folder)
    if (from < 0) return
    const rest = this.paths.filter((p) => p !== folder)
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, folder)
    this.paths = rest
    this.save()
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      // Written by a temporary name and renamed into place, so a crash never leaves half a list.
      const partial = `${this.file}.${process.pid}.part`
      fs.writeFileSync(partial, JSON.stringify(this.paths))
      fs.renameSync(partial, this.file)
    } catch {
      // a list that cannot be saved is not worth stopping for
    }
  }
}
