import { EditorState, type ChangeSet } from '@codemirror/state'
import type { Language } from '@core/filekind.ts'
import { editableExtensions } from '@/views/codeTheme.ts'
import type { Detected } from './detectLanguage.ts'
import { editorBuffers, type EditorBuffer, type UntitledLanguage } from './editors.ts'
import { fileLanguage } from './fileLanguage.ts'

/** A new text starts as plain text, not detected, not chosen. */
export const PLAIN_TEXT: UntitledLanguage = { language: 'plain', detected: false, manual: false }

/** The text changed by this many characters (put in or taken out) at once is worth a look at its language; a key at a time is not. */
export const DETECT_CHANGE = 20
/** The wait after the last change before the text is looked at (a paste is one change; typing never gets here). */
export const DETECT_DELAY_MS = 300

/**
 * The text buffer of a new text file (Untitled-N), kept by the key of its tab. Nothing is saved, so whatever text it starts with (`text`: the draft of an earlier session) is a
 * change; it starts empty when the tab is new. `lang` is the language the draft kept (the choice of the user comes back as it was: `fileLanguage` is what the language picker reads).
 */
export function newUntitledBuffer(key: string, wrap: boolean, text = '', lang: UntitledLanguage = PLAIN_TEXT): EditorBuffer {
  const state = EditorState.create({ doc: text, extensions: editableExtensions(lang.language, wrap) })
  const buffer: EditorBuffer = { state, saved: EditorState.create({ doc: '' }).doc, version: { mtimeMs: 0, size: 0 }, eol: 'lf', bom: false, lang: { ...lang } }
  editorBuffers.set(key, buffer)
  fileLanguage.set(key, lang.manual ? lang.language : undefined)
  return buffer
}

/**
 * The new text `from` (`u:<n>`) was saved and its tab is now the file's `to` (`f:<root>:<path>`): the buffer goes to the new key with its undo history, a buffer the file's tab had is
 * replaced, and what only a new text has (`lang`) is dropped. The language the user picked stays picked. Nothing changes when `from` has no buffer or is `to`.
 */
export function moveEditorBuffer(from: string, to: string, languageKey: string = to): void {
  const buffer = editorBuffers.get(from)
  if (!buffer || from === to) return
  const picked = fileLanguage.get(from)
  delete buffer.lang
  editorBuffers.move(from, to)
  // `fileLanguage` is keyed by what a file's view uses (`<root>:<path>`, no `f:`), not by the key of the tab.
  fileLanguage.set(from, undefined)
  fileLanguage.set(languageKey, picked)
}

/** How many characters a change put in and took out. */
export function changeSize(changes: ChangeSet): number {
  let size = 0
  changes.iterChanges((from, to, _fromB, _toB, inserted) => void (size += to - from + inserted.length))
  return size
}

/**
 * The language after the text was looked at (`detection`, null when nothing convinces). A language the user chose never changes; one the text chose follows the text, and goes back
 * to plain text when the text stops convincing; plain text that nothing convinces stays as it is.
 */
export function nextLanguage(state: UntitledLanguage, detection: Detected | null): UntitledLanguage {
  if (state.manual) return state
  if (detection) return state.language === detection.language && state.detected ? state : { language: detection.language, detected: true, manual: false }
  return state.detected || state.language !== 'plain' ? PLAIN_TEXT : state
}

/** The language after the user picked one (`undefined`: Auto Detect, which looks at the text again). */
export function pickedLanguage(picked: Language | undefined, detection: Detected | null): UntitledLanguage {
  return picked === undefined ? nextLanguage(PLAIN_TEXT, detection) : { language: picked, detected: false, manual: true }
}
