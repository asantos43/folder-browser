import fs from 'node:fs'
import path from 'node:path'

/** The files opened lately, kept in one small JSON file of the user's own profile (the only thing about them the viewer stores). */
export class RecentFiles {
  private paths: string[] = []
  private readonly file: string
  private readonly max: number

  constructor(file: string, max = 10) {
    this.file = file
    this.max = max
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Array.isArray(raw)) this.paths = raw.filter((p): p is string => typeof p === 'string').slice(0, max)
    } catch {
      // no list yet, or one that cannot be read: start empty
    }
  }

  list(): string[] {
    return [...this.paths]
  }

  add(filePath: string): void {
    this.paths = [filePath, ...this.paths.filter((p) => p !== filePath)].slice(0, this.max)
    this.save()
  }

  clear(): void {
    this.paths = []
    this.save()
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.paths))
    } catch {
      // a list that cannot be saved is not worth stopping for
    }
  }
}
