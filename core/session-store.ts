import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 256 * 1024

/**
 * What was open at the end of the last session (the paths of the snapshots and files, never contents), in one small JSON file of the user's own profile.
 * It is the main process's file, written whole and renamed into place at every change, so it is there whenever the application ends: the window's
 * local storage is written a few seconds after a change and not always before the process exits.
 */
export class SessionStore {
  private readonly file: string

  constructor(file: string) {
    this.file = file
  }

  /** What was kept, or null: nothing kept, or a file that cannot be read or is too large. The caller checks its shape. */
  load(): unknown {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      return raw.length <= MAX_BYTES ? (JSON.parse(raw) as unknown) : null
    } catch {
      return null
    }
  }

  /** Keeps `value`, or forgets everything with null. Too large, or unwritable, is not worth stopping for. */
  save(value: unknown): void {
    try {
      if (value === null || value === undefined) return void fs.rmSync(this.file, { force: true })
      const text = JSON.stringify(value)
      if (text.length > MAX_BYTES) return
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const partial = `${this.file}.${process.pid}.part`
      fs.writeFileSync(partial, text)
      fs.renameSync(partial, this.file)
    } catch {
      // a session that cannot be saved is not worth stopping for
    }
  }
}
