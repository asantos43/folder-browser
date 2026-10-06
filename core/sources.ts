import type { Readable } from 'node:stream'
import type { ByteRange } from './archive/reader.ts'
import type { RootRegistry } from './roots.ts'
import type { SnapshotRegistry } from './snapshots.ts'
import type { ZipArchive } from './zip.ts'

type Missing = { error: 'no-snapshot' | 'no-file' | 'too-large' }

/** What the callers that read files (a tab, Save As, Extract, Open With…) need of a source, whatever it is: a snapshot, or a folder or ZIP opened to browse. */
export interface FileSource {
  read(id: string, name: string, limit: number): Promise<{ bytes: Buffer } | Missing>
  stream(id: string, name: string, range?: ByteRange): Promise<Readable | undefined>
  zipAt(id: string, name: string): Promise<ZipArchive | { error: 'no-snapshot' | 'no-file' | 'too-large' | 'not-zip' }>
}

/** The two kinds of source behind one set of calls: an id that is a root's goes to the roots, any other to the snapshots. */
export class Sources implements FileSource {
  readonly snapshots: SnapshotRegistry
  readonly roots: RootRegistry
  constructor(snapshots: SnapshotRegistry, roots: RootRegistry) {
    this.snapshots = snapshots
    this.roots = roots
  }
  private from(id: string): FileSource {
    return this.roots.has(id) ? this.roots : this.snapshots
  }
  read(id: string, name: string, limit: number) {
    return this.from(id).read(id, name, limit)
  }
  stream(id: string, name: string, range?: ByteRange) {
    return this.from(id).stream(id, name, range)
  }
  zipAt(id: string, name: string) {
    return this.from(id).zipAt(id, name)
  }
  has(id: string): boolean {
    return this.roots.has(id) || this.snapshots.has(id)
  }
  async close(id: string): Promise<void> {
    if (this.roots.has(id)) await this.roots.close(id)
    else await this.snapshots.close(id)
  }
}
