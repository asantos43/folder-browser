import type { EditorState, Text } from '@codemirror/state'
import type { EditSave, FbApi, FileVersion, LineEnding } from '@core/api.ts'

/**
 * The text of an editor tab: the editor's state (so a tab that is left and shown again has its changes, its undo history and its place), the text that was saved (to tell
 * whether it has changes), what the file was like on the disk when it was read or last saved (to notice that someone else changed it), and its line ending and byte order mark.
 * Kept by the key of the tab while the tab is open.
 */
export interface EditorBuffer {
  state: EditorState
  saved: Text
  version: FileVersion
  eol: LineEnding
  bom: boolean
}

const buffers = new Map<string, EditorBuffer>()

export const editorBuffers = {
  get: (key: string): EditorBuffer | undefined => buffers.get(key),
  set: (key: string, buffer: EditorBuffer): void => void buffers.set(key, buffer),
  delete: (key: string): void => void buffers.delete(key),
  /** A tab has a new key (its file was renamed or moved): it keeps its text. */
  move: (from: string, to: string): void => {
    const buffer = buffers.get(from)
    if (!buffer || from === to) return
    buffers.delete(from)
    buffers.set(to, buffer)
  },
  /** Lets go of the buffers of the tabs that are not open any more. */
  keep: (open: ReadonlySet<string>): void => {
    for (const key of [...buffers.keys()]) if (!open.has(key)) buffers.delete(key)
  },
  clear: (): void => buffers.clear(),
}

/** The buffer has changes that are not saved. */
export const hasChanges = (buffer: EditorBuffer): boolean => !(buffer.state.doc.length === buffer.saved.length && buffer.state.doc.eq(buffer.saved))

/**
 * Writes the text of a tab to its file (`overwrite`: although the file changed on disk, as the user chose). What was saved is the text as it was when the call was made: what is
 * typed while the file is being written is still a change. Nothing changes in the buffer unless the file was written.
 */
export async function saveBuffer(api: Pick<FbApi, 'edit'>, rootId: string, path: string, key: string, overwrite = false): Promise<EditSave | { ok: false; error: 'no-buffer' }> {
  const buffer = buffers.get(key)
  if (!buffer) return { ok: false, error: 'no-buffer' }
  const doc = buffer.state.doc
  const result = await api.edit.save(rootId, path, doc.toString(), buffer.version, { eol: buffer.eol, bom: buffer.bom, overwrite })
  const now = buffers.get(key)
  if (result.ok && now) {
    now.saved = doc
    now.version = result.version
  }
  return result
}
