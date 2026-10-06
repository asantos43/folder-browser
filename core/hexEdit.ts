/**
 * The bytes of a file being edited in the hexadecimal view: the bytes, which of them were changed (to mark them), and the history to undo and redo. Pure: no file, no window.
 * Every change is one edit, "these bytes at this place became those" (an overwrite, an insert and a delete are all that), so an edit and its undo are the same operation.
 */
export interface HexEdit {
  at: number
  removed: Uint8Array
  /** For each removed byte, whether it was marked as changed before. */
  removedChanged: Uint8Array
  inserted: Uint8Array
}

export interface HexDoc {
  bytes: Uint8Array
  /** One entry per byte: 1 when it was written, inserted or moved by an edit that is still in force. */
  changed: Uint8Array
  undo: HexEdit[]
  redo: HexEdit[]
  /** How many edits were in force when the file was saved (it is not modified at that point of the history); -1 when that point is no longer in the history. */
  savedAt: number
}

export const createHexDoc = (bytes: Uint8Array): HexDoc => ({ bytes, changed: new Uint8Array(bytes.length), undo: [], redo: [], savedAt: 0 })

/** Whether the bytes are not what was saved. */
export const isModified = (doc: HexDoc): boolean => doc.undo.length !== doc.savedAt

/** The file was written: this point of the history is the saved one, and the bytes are no longer marked as changed. */
export function markSaved(doc: HexDoc): void {
  doc.savedAt = doc.undo.length
  doc.changed = new Uint8Array(doc.bytes.length)
  // (The marks of the history are of an earlier file: undo past this point brings back bytes that differ, which the next save writes.)
  for (const edit of [...doc.undo, ...doc.redo]) edit.removedChanged.fill(1)
}

function splice(doc: HexDoc, at: number, removeLength: number, insert: Uint8Array, insertChanged: Uint8Array | 1): void {
  const length = doc.bytes.length - removeLength + insert.length
  if (insert.length === removeLength) {
    doc.bytes.set(insert, at)
    if (insertChanged === 1) doc.changed.fill(1, at, at + insert.length)
    else doc.changed.set(insertChanged, at)
    return
  }
  const bytes = new Uint8Array(length)
  const changed = new Uint8Array(length)
  bytes.set(doc.bytes.subarray(0, at), 0)
  changed.set(doc.changed.subarray(0, at), 0)
  bytes.set(insert, at)
  if (insertChanged === 1) changed.fill(1, at, at + insert.length)
  else changed.set(insertChanged, at)
  bytes.set(doc.bytes.subarray(at + removeLength), at + insert.length)
  changed.set(doc.changed.subarray(at + removeLength), at + insert.length)
  doc.bytes = bytes
  doc.changed = changed
}

/**
 * Takes `removeLength` bytes at `at` out and puts `insert` in their place. With `coalesce` it is the second step of the same keystroke pair (the second digit of a byte): it replaces
 * what the edit before it put there, so one undo takes back both. (Never across a save.)
 */
export function replaceBytes(doc: HexDoc, at: number, removeLength: number, insert: Uint8Array, coalesce = false): void {
  if (at < 0 || at + removeLength > doc.bytes.length) return
  const last = doc.undo.at(-1)
  if (coalesce && last && last.at === at && last.inserted.length === removeLength && doc.savedAt !== doc.undo.length) {
    splice(doc, at, removeLength, insert, 1)
    last.inserted = insert.slice()
    doc.redo = []
    return
  }
  const edit: HexEdit = { at, removed: doc.bytes.slice(at, at + removeLength), removedChanged: doc.changed.slice(at, at + removeLength), inserted: insert.slice() }
  splice(doc, at, removeLength, insert, 1)
  // Past the saved point of the history, the saved point is gone.
  if (doc.savedAt > doc.undo.length) doc.savedAt = -1
  doc.undo.push(edit)
  doc.redo = []
}

export const overwriteByte = (doc: HexDoc, at: number, value: number, coalesce = false): void => replaceBytes(doc, at, 1, Uint8Array.of(value & 255), coalesce)
/** A new byte before the one at `at` (at the end, `at` is the length). */
export const insertByte = (doc: HexDoc, at: number, value: number, coalesce = false): void => replaceBytes(doc, at, coalesce ? 1 : 0, Uint8Array.of(value & 255), coalesce)
/** The bytes from `from` to `to`, both included, are taken out. */
export const removeBytes = (doc: HexDoc, from: number, to: number): void => replaceBytes(doc, from, Math.min(doc.bytes.length - 1, to) - from + 1, new Uint8Array(0))

/** Takes back the last edit; the place it was made, for the cursor, or null when there is nothing to undo. */
export function undo(doc: HexDoc): number | null {
  const edit = doc.undo.pop()
  if (!edit) return null
  splice(doc, edit.at, edit.inserted.length, edit.removed, edit.removedChanged)
  doc.redo.push(edit)
  return edit.at
}

export function redo(doc: HexDoc): number | null {
  const edit = doc.redo.pop()
  if (!edit) return null
  splice(doc, edit.at, edit.removed.length, edit.inserted, 1)
  doc.undo.push(edit)
  return edit.at
}
