import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { FileVersion, LineEnding } from './fs/edit.ts'

/**
 * The changes of a file that were not saved, kept in the application's own folder so that they are still there after the application is closed, or after it crashes (a "hot exit":
 * the tab comes back as it was, with its changes, and is saved or discarded when the user decides). A draft is of a file by the folder that was opened and the path in it, and has
 * what the file was like when the changes began (`base`), to notice at the next Save that the disk changed meanwhile.
 */
export interface DraftMeta {
  version: 1
  /** The folder that was opened (the path the user opened, not a real path) and the path of the file in it. */
  rootPath: string
  path: string
  kind: 'text' | 'bytes'
  base: FileVersion
  /** Of a text draft: how its lines end and whether it has the byte order mark. */
  eol?: LineEnding
  bom?: boolean
  /** Of a new text (Untitled-N): its language (a `Language` of `core/filekind.ts`) and whether the user chose it. A draft without them is plain text, not chosen. */
  language?: string
  manual?: boolean
  /** ISO 8601: when the draft was last written. */
  at: string
}

export type Draft = DraftMeta & ({ kind: 'text'; text: string } | { kind: 'bytes'; bytes: Uint8Array })

/** The biggest draft kept (a bigger text is not worth a copy; the editor edits 5 MB, the hex view 16 MiB). */
export const DRAFT_LIMIT = 64 * 2 ** 20

const isVersion = (v: unknown): v is FileVersion => typeof v === 'object' && v !== null && Number.isFinite((v as FileVersion).mtimeMs) && Number.isFinite((v as FileVersion).size)

export class DraftStore {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  private idOf(rootPath: string, relative: string): string {
    return crypto.createHash('sha256').update(`${rootPath}\0${relative}`).digest('hex').slice(0, 32)
  }

  private write(file: string, data: string | Uint8Array): void {
    fs.mkdirSync(this.dir, { recursive: true })
    const partial = `${file}.${process.pid}.part`
    fs.writeFileSync(partial, data)
    fs.renameSync(partial, file)
  }

  /** Keeps a draft (replacing the one of the same file). False when it is too large or cannot be written: a draft that cannot be kept is not worth stopping for. */
  put(draft: Draft): boolean {
    try {
      const size = draft.kind === 'text' ? draft.text.length : draft.bytes.length
      if (size > DRAFT_LIMIT) return false
      const id = this.idOf(draft.rootPath, draft.path)
      const { kind, ...rest } = draft
      const meta: Record<string, unknown> = { ...rest, kind }
      delete meta.bytes
      // The bytes first, then the meta that says they are there: a crash between leaves no half draft.
      if (draft.kind === 'bytes') this.write(path.join(this.dir, `${id}.bin`), draft.bytes)
      else fs.rmSync(path.join(this.dir, `${id}.bin`), { force: true })
      this.write(path.join(this.dir, `${id}.json`), JSON.stringify(meta))
      return true
    } catch {
      return false
    }
  }

  private readMeta(id: string): (DraftMeta & { text?: string }) | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8')) as Partial<DraftMeta> & { text?: unknown }
      if (raw.version !== 1 || typeof raw.rootPath !== 'string' || typeof raw.path !== 'string' || (raw.kind !== 'text' && raw.kind !== 'bytes') || !isVersion(raw.base) || typeof raw.at !== 'string') return null
      if (raw.kind === 'text' && typeof raw.text !== 'string') return null
      // The optional fields of a new text: whatever is not of the right type is let go (the draft stays valid).
      if (typeof raw.language !== 'string' || raw.language.length > 40) delete raw.language
      if (typeof raw.manual !== 'boolean') delete raw.manual
      return raw as DraftMeta & { text?: string }
    } catch {
      return null
    }
  }

  get(rootPath: string, relative: string): Draft | null {
    const id = this.idOf(rootPath, relative)
    const meta = this.readMeta(id)
    if (!meta || meta.rootPath !== rootPath || meta.path !== relative) return null
    if (meta.kind === 'text') return { ...meta, kind: 'text', text: meta.text! }
    try {
      const bytes = fs.readFileSync(path.join(this.dir, `${id}.bin`))
      const { text: _text, ...rest } = meta
      return { ...rest, kind: 'bytes', bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) }
    } catch {
      return null
    }
  }

  delete(rootPath: string, relative: string): void {
    const id = this.idOf(rootPath, relative)
    fs.rmSync(path.join(this.dir, `${id}.json`), { force: true })
    fs.rmSync(path.join(this.dir, `${id}.bin`), { force: true })
  }

  /** What is kept (without the contents), the oldest first. */
  list(): DraftMeta[] {
    let names: string[] = []
    try {
      names = fs.readdirSync(this.dir).filter((n) => n.endsWith('.json'))
    } catch {
      return []
    }
    const metas: DraftMeta[] = []
    for (const name of names) {
      const meta = this.readMeta(name.slice(0, -5))
      if (!meta) continue
      const { text: _text, ...rest } = meta
      metas.push(rest)
    }
    return metas.sort((a, b) => a.at.localeCompare(b.at))
  }

  /** Forgets the drafts that were last written more than `days` ago, and what is left over that is not a draft. */
  prune(days: number, now = Date.now()): void {
    let names: string[] = []
    try {
      names = fs.readdirSync(this.dir)
    } catch {
      return
    }
    for (const name of names) {
      const file = path.join(this.dir, name)
      try {
        if (name.endsWith('.part')) fs.rmSync(file, { force: true })
        else if (name.endsWith('.json')) {
          const meta = this.readMeta(name.slice(0, -5))
          if (!meta) fs.rmSync(file, { force: true })
          else if (now - Date.parse(meta.at) > days * 86_400_000) this.delete(meta.rootPath, meta.path)
        }
      } catch {
        // a file that cannot be removed is left
      }
    }
  }

  clear(): void {
    fs.rmSync(this.dir, { recursive: true, force: true })
  }
}
