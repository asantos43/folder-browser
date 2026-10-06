import { EditorState, Text } from '@codemirror/state'
import type { EditError } from '@core/api.ts'
import type { Language } from '@core/filekind.ts'
import { editableExtensions } from '@/views/codeTheme.ts'
import { editorBuffers, type EditorBuffer } from './editors.ts'

export type BufferLoad = { state: 'ready'; buffer: EditorBuffer; restored: boolean } | { state: 'refused'; error: EditError }

/**
 * The text buffer of a tab: the changes of an earlier session that were not saved (a draft) come first, with the file as it is on disk as what is saved; else the file. The buffer is
 * kept by the key of the tab (`editorBuffers`). The source editor and the table both start from here, so a file edited in one is the same text in the other.
 */
export async function loadEditorBuffer(rootId: string, path: string, tabKey: string, language: Language, wrap: boolean): Promise<BufferLoad | null> {
  const draft = await window.fb?.drafts.get(rootId, path).catch(() => null)
  const result = await window.fb?.edit.open(rootId, path)
  if (!result) return null
  const extensions = editableExtensions(language, wrap)
  if (draft && draft.kind === 'text' && (result.ok || result.error === 'no-file')) {
    const onDisk = result.ok ? result.text : ''
    const same = result.ok && draft.text === result.text && draft.base.mtimeMs === result.version.mtimeMs && draft.base.size === result.version.size
    if (!same) {
      const state = EditorState.create({ doc: draft.text, extensions })
      // The version is the one the changes began from: if the file changed on disk since, Save notices.
      const buffer: EditorBuffer = { state, saved: Text.of(onDisk.split('\n')), version: draft.base, eol: draft.eol ?? 'lf', bom: draft.bom ?? false }
      editorBuffers.set(tabKey, buffer)
      return { state: 'ready', buffer, restored: true }
    }
    void window.fb?.drafts.delete(rootId, path)
  }
  if (!result.ok) return { state: 'refused', error: result.error }
  const state = EditorState.create({ doc: result.text, extensions })
  const buffer: EditorBuffer = { state, saved: state.doc, version: result.version, eol: result.eol, bom: result.bom }
  editorBuffers.set(tabKey, buffer)
  return { state: 'ready', buffer, restored: false }
}
