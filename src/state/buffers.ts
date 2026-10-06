import type { DraftIn, EditSave, FbApi } from '@core/api.ts'
import { editorBuffers, hasChanges, saveBuffer } from './editors.ts'
import { hexBuffers, hexChanged, saveHexBuffer } from './hexBuffers.ts'

/**
 * The text of an editor tab and the bytes of a hexadecimal tab are kept apart (`editorBuffers`, `hexBuffers`), by the key of the tab; what the workbench does with a tab that has
 * changes (save, throw the changes away, follow a rename, keep a draft) is the same for both, and goes through here.
 */
export const hasBuffer = (key: string): boolean => editorBuffers.get(key) !== undefined || hexBuffers.get(key) !== undefined

export function bufferChanged(key: string): boolean {
  const text = editorBuffers.get(key)
  if (text) return hasChanges(text)
  const bytes = hexBuffers.get(key)
  return bytes ? hexChanged(bytes) : false
}

export function dropBuffer(key: string): void {
  editorBuffers.delete(key)
  hexBuffers.delete(key)
}

export function moveBuffer(from: string, to: string): void {
  editorBuffers.move(from, to)
  hexBuffers.move(from, to)
}

export function keepBuffers(open: ReadonlySet<string>): void {
  editorBuffers.keep(open)
  hexBuffers.keep(open)
}

export function saveAnyBuffer(api: Pick<FbApi, 'edit'>, rootId: string, path: string, key: string, overwrite = false): Promise<EditSave | { ok: false; error: 'no-buffer' }> {
  return hexBuffers.get(key) ? saveHexBuffer(api, rootId, path, key, overwrite) : saveBuffer(api, rootId, path, key, overwrite)
}

/** What a draft of the tab would hold (null: nothing, or no changes). */
export function draftOf(key: string): DraftIn | null {
  const text = editorBuffers.get(key)
  if (text) return hasChanges(text) ? { kind: 'text', text: text.state.doc.toString(), base: text.version, eol: text.eol, bom: text.bom } : null
  const bytes = hexBuffers.get(key)
  return bytes && hexChanged(bytes) ? { kind: 'bytes', bytes: bytes.doc.bytes.slice(), base: bytes.version } : null
}
