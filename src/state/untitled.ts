import { EditorState } from '@codemirror/state'
import { editableExtensions } from '@/views/codeTheme.ts'
import { editorBuffers, type EditorBuffer } from './editors.ts'

/**
 * The text buffer of a new text file (Untitled-N), kept by the key of its tab. Nothing is saved, so whatever text it starts with (`text`: the draft of an earlier session) is a
 * change; it starts empty when the tab is new.
 */
export function newUntitledBuffer(key: string, wrap: boolean, text = ''): EditorBuffer {
  const state = EditorState.create({ doc: text, extensions: editableExtensions('plain', wrap) })
  const buffer: EditorBuffer = { state, saved: EditorState.create({ doc: '' }).doc, version: { mtimeMs: 0, size: 0 }, eol: 'lf', bom: false }
  editorBuffers.set(key, buffer)
  return buffer
}
