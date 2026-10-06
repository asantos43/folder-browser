import type { EditSave, FbApi, FileVersion } from '@core/api.ts'
import { isModified, markSaved, type HexDoc } from '@core/hexEdit.ts'

/** The bytes of a hexadecimal tab that is edited, by its key, with what the file was like on disk when they were read (as `EditorBuffer` is for a text). */
export interface HexBuffer {
  doc: HexDoc
  version: FileVersion
}

const buffers = new Map<string, HexBuffer>()

export const hexBuffers = {
  get: (key: string): HexBuffer | undefined => buffers.get(key),
  set: (key: string, buffer: HexBuffer): void => void buffers.set(key, buffer),
  delete: (key: string): void => void buffers.delete(key),
  move: (from: string, to: string): void => {
    const buffer = buffers.get(from)
    if (!buffer || from === to) return
    buffers.delete(from)
    buffers.set(to, buffer)
  },
  keep: (open: ReadonlySet<string>): void => {
    for (const key of [...buffers.keys()]) if (!open.has(key)) buffers.delete(key)
  },
  clear: (): void => buffers.clear(),
}

export const hexChanged = (buffer: HexBuffer): boolean => isModified(buffer.doc)

/** Writes the bytes of a tab to its file; the buffer is the saved one afterwards unless it was changed while it was being written. */
export async function saveHexBuffer(api: Pick<FbApi, 'edit'>, rootId: string, path: string, key: string, overwrite = false): Promise<EditSave | { ok: false; error: 'no-buffer' }> {
  const buffer = buffers.get(key)
  if (!buffer) return { ok: false, error: 'no-buffer' }
  const edits = buffer.doc.undo.length
  const redoable = buffer.doc.redo.length
  const result = await api.edit.saveBytes(rootId, path, buffer.doc.bytes.slice(), buffer.version, { overwrite })
  const now = buffers.get(key)
  if (result.ok && now) {
    now.version = result.version
    if (now.doc.undo.length === edits && now.doc.redo.length === redoable) markSaved(now.doc)
  }
  return result
}
