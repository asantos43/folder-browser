import type { Text } from '@codemirror/state'
import type { FileVersion, RootInfo } from '@core/api.ts'
import { canProbe, mediaKind, viewKind } from '@core/filekind.ts'
import { basename } from '@/lib/format.ts'
import { editorBuffers, hasChanges } from '@/state/editors.ts'
import { fileLanguage } from '@/state/fileLanguage.ts'
import { moveEditorBuffer } from '@/state/untitled.ts'
import { fileKey, type Action } from '@/state/workspace.ts'

/** What the conversion of a saved new text needs from the workbench (so that it can be tested without one). */
export interface SavedUntitledDeps {
  /** The folders and ZIP files that are open, by id. */
  roots: Readonly<Record<string, RootInfo>>
  /** Opens the folder at this path of the disk as a root (the user just chose to save there); null when it could not be opened. */
  openFolder(folder: string): Promise<RootInfo | null>
  /** The version of the file that was just written (null: it could not be read). */
  readVersion(rootId: string, path: string): Promise<FileVersion | null>
  dispatch(action: Action): void
  /** The zoom and the like, kept by the key of a tab, follow the tab. */
  moveKeyed(from: string, to: string): void
  /** The new text, if it was the one chosen for a comparison, is now the file. */
  chosenAfter(from: string, rootId: string, path: string): void
  /** What was read of the file before is old now. */
  forgetRead(rootId: string, path: string): void
  /** The draft of the new text (`@untitled`) is not needed any more. */
  releaseDraft(key: string): void
}

/**
 * `converted: false`: the file was written but the tab stays a new text (text is marked saved; the folder could not be opened or the file could not be read back).
 * `text: false`: the name says the file is not a text (a picture…): the tab opens as that kind of file and the text is let go.
 */
export type Converted = { converted: true; key: string; text: boolean } | { converted: false }

const separators = /[\\/]+/g
const normal = (path: string): string => path.replace(separators, '/').replace(/(.)\/$/, '$1')
const caseless = (path: string): boolean => /^[A-Za-z]:/.test(path) || path.startsWith('//')

/** The open folder that contains `file` (the most specific one) and the path of the file within it; null when no open folder contains it. ZIP files and the trash are not folders to write to. */
export function rootOf(roots: Readonly<Record<string, RootInfo>>, file: string): { rootId: string; path: string } | null {
  const target = normal(file)
  let best: { rootId: string; path: string; length: number } | null = null
  for (const root of Object.values(roots)) {
    if (root.kind !== 'folder' || root.trash) continue
    const base = normal(root.path)
    const prefix = base.endsWith('/') ? base : `${base}/`
    const same = caseless(base) ? target.toLowerCase().startsWith(prefix.toLowerCase()) : target.startsWith(prefix)
    if (same && target.length > prefix.length && (!best || prefix.length > best.length)) best = { rootId: root.id, path: target.slice(prefix.length), length: prefix.length }
  }
  return best ? { rootId: best.rootId, path: best.path } : null
}

/** The folder a file is in (as the disk spells it; the top of a disk keeps its slash). */
export function folderOf(file: string): string {
  const at = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  const folder = file.slice(0, at)
  return at <= 0 ? file.slice(0, 1) : /^[A-Za-z]:$/.test(folder) ? `${folder}${file[at]}` : folder
}

/** Whether the name says a text: the tab of the file is then an editor (an unknown type is looked at, as any file of a folder is). */
export const isTextName = (name: string): boolean => !mediaKind(undefined, name) && (viewKind(undefined, name, 0) === 'text' || canProbe(undefined, name, 0))

/**
 * The new text `key` (Untitled-N) was written to `savedPath`, the text being `doc`: its tab becomes the tab of the file, the same one the tree opens. In this order: the folder
 * that holds the file (an open one, else the folder is opened: the user chose that place), the tab (`untitled-saved`), the text with its undo history, the zoom and the comparison,
 * the language (the extension decides; a name with none keeps the one the text had; one the user picked stays), the version of the file and the mark of changes, the draft.
 */
export async function convertSavedUntitled(key: string, savedPath: string, doc: Text, deps: SavedUntitledDeps): Promise<Converted> {
  const buffer = editorBuffers.get(key)
  if (!buffer) return { converted: false }
  // The file is written whatever comes next: the text is as saved as it was.
  buffer.saved = doc
  const name = basename(savedPath)
  const text = isTextName(name)
  let found = rootOf(deps.roots, savedPath)
  if (!found) {
    const opened = await deps.openFolder(folderOf(savedPath))
    if (opened) found = { rootId: opened.id, path: name }
  }
  if (!found) return { converted: false }
  const version = text ? await deps.readVersion(found.rootId, found.path) : null
  if (text && !version) return { converted: false }
  const { rootId, path } = found
  const to = fileKey(rootId, path)
  deps.dispatch({ type: 'untitled-saved', key, rootId, path })
  deps.moveKeyed(key, to)
  deps.chosenAfter(key, rootId, path)
  deps.forgetRead(rootId, path)
  deps.releaseDraft(key)
  if (!text) {
    // Not a text: the tab shows the file as its kind, and the text goes.
    editorBuffers.delete(key)
    fileLanguage.set(key, undefined)
    deps.dispatch({ type: 'dirty', key: to, dirty: false })
    return { converted: true, key: to, text: false }
  }
  const lang = buffer.lang
  buffer.version = version!
  // What a file's view reads the language by: `<root>:<path>` (not the key of the tab).
  const languageKey = `${rootId}:${path}`
  moveEditorBuffer(key, to, languageKey)
  // A name with an extension has the language of the file; one without keeps what the text had. (A language the user picked was kept by `moveEditorBuffer`.)
  if (/[^./\\]\.[^./\\]+$/.test(name)) {
    if (!lang?.manual) fileLanguage.set(languageKey, undefined)
  } else if (lang && !lang.manual && lang.language !== 'plain') fileLanguage.set(languageKey, lang.language)
  deps.dispatch({ type: 'dirty', key: to, dirty: hasChanges(buffer) })
  return { converted: true, key: to, text: true }
}
