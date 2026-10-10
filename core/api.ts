import type { OpError, OpResult } from './fs/ops.ts'
import type { ImportPreview } from './settings/portable.ts'
import type { Draft } from './drafts.ts'
import type { EditBytesOpen, EditError, EditOpen, EditSave, FileVersion, LineEnding } from './fs/edit.ts'
import type { ExtractResult } from './extract.ts'
import type { PlacesData } from './places.ts'
import type { FileListResult, ListResult, RootInfo } from './roots.ts'
import type { RestoreResult } from './trash.ts'
import type { SnapshotInfo } from './snapshots.ts'
import type { ZipEntryInfo } from './zip.ts'
import type { IntegrityReport, Issue } from './validate/index.ts'

/** What the main process offers the interface (through the preload). Plain data only: nothing here can read an archive. */
export type OpenResult =
  | { ok: true; snapshot: SnapshotInfo; /** The file was open already: show its tab. */ already: boolean; /** The folder it is in, opened to browse with it: a snapshot is a file of a folder (not given when it was opened from the tree of that folder). */ folder?: RootInfo }
  /** A folder or a ZIP file opened to browse (`open`: the file the user named, when it was a file of a folder: its tab opens too). */
  | { ok: true; root: RootInfo; already: boolean; open?: { path: string; size: number } }
  | { ok: false; path: string; issues: Issue[]; omitted: number }

export type ReadResult = { bytes: Uint8Array } | { error: 'no-snapshot' | 'no-file' | 'too-large' }
/** A window of a file's bytes, and the whole file's size. */
export type RangeResult = { bytes: Uint8Array; size: number } | { error: 'no-snapshot' | 'no-file' | 'too-large' }
/** A document of a root, ready to be drawn in a frame at `url` (`fb-doc://<token>/`): by the library `flavour` (core/docs.ts). */
export type DocOpen = { token: string; url: string; flavour: 'docx' | 'pptx' | 'odf' } | { error: 'no-file' | 'too-large' | 'unsupported' }
/** What an operation on the files of a folder answers (`core/fs/ops.ts`): the new path of the item, or why nothing was done. */
/** What the interface hands over to be kept as a draft, and what it is told of a kept one. */
export type DraftIn = { kind: 'text'; text: string; base: FileVersion; eol: LineEnding; bom: boolean; /** Of a new text (Untitled-N) only. */ language?: string; manual?: boolean } | { kind: 'bytes'; bytes: Uint8Array; base: FileVersion }
export interface DraftEntry {
  rootPath: string
  path: string
  kind: 'text' | 'bytes'
  at: string
}
export type { Draft }
export type { OpError, OpResult, EditBytesOpen, EditError, EditOpen, EditSave, FileVersion, LineEnding }
export type SaveResult = { saved: true; path: string } | { saved: false; reason: 'cancelled' | 'error'; message?: string }
export type IntegrityEvent = { id: string; state: 'running'; done: number; total: number } | { id: string; state: 'done'; report: IntegrityReport }

export type ZipList = { entries: ZipEntryInfo[]; truncated: boolean } | { error: 'no-snapshot' | 'no-file' | 'too-large' | 'not-zip' }
export type { DirEntry, FileListResult, ListResult, RootInfo } from './roots.ts'
export type { Place, PlacesData, PlaceKind } from './places.ts'
export type { RestoreResult } from './trash.ts'
export type { ExtractResult, ZipEntryInfo }
/** What to print: the page of a snapshot, a picture of it, or a text (as the tab shows it). */
export type PrintRequest = { kind: 'snapshot'; id: string } | { kind: 'image'; id: string; path: string } | { kind: 'html'; id: string; path: string } | { kind: 'document'; id: string; path: string } | { kind: 'text'; title: string; text: string; /** The name of the file, for the PDF's. */ name?: string }
export type PrintResult = { printed: true } | { printed: false; reason: 'cancelled' | 'error' | 'unsupported'; message?: string }

/** What came of "Open with…": the system asked which application to use, or why not. */
export interface ChooserApp {
  id: string
  name: string
  /** The icon as a data URL, when one was found. */
  iconUrl?: string
  /** Registered for the file's type (the dialog's "Recommended Apps"). */
  recommended: boolean
}
/** The choice the viewer shows itself (Linux: a program cannot put the desktop's own chooser in front of its window): the file's type and the applications. */
export interface Chooser {
  token: string
  name: string
  mime: string
  mimeLabel: string
  apps: ChooserApp[]
}
export type OpenWithResult =
  | { opened: true; /** False when the system has no chooser and the default application was used. */ chooser: boolean }
  | { opened: false; reason: 'cancelled' | 'unsafe' | 'no-file' | 'error'; message?: string }
  /** Nothing opened yet: the interface shows this choice, and answers with `openWithApp` or `openWithCancel`. */
  | { choose: Chooser }

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  /** The licence of the application (LICENSE), and the notices of the libraries inside it (THIRD-PARTY-NOTICES.md). */
  licence: string
  notices: string
}

/** A video or a sound opened to be played: its address, for the media element, and what it is. */
export type MediaOpen = { token: string; url: string; kind: 'video' | 'audio'; mime: string; size: number } | { error: 'no-file' | 'too-large' | 'unsupported' }

export type SettingsNotice = { id: string; message: string }
export type SettingsPortableResult = { error: string } | { canceled: true } | { changed: string[] } | { preview: ImportPreview; token: number; needsConfirm: boolean }
export interface FbApi {
  keys: { get(): import('./keys/user.ts').KeysSnapshot; set(entries: readonly import('./keys/user.ts').UserKey[]): void; onChanged(listener: (snapshot: import('./keys/user.ts').KeysSnapshot) => void): () => void }
  settings: { all(): Record<string, unknown>; notices(): readonly SettingsNotice[]; set(pairs: readonly (readonly [string, unknown])[]): void; reset(ids: readonly string[]): void; export(): Promise<SettingsPortableResult>; previewImport(): Promise<SettingsPortableResult>; applyImport(token: number, confirmed: boolean, safetyConfirmed: boolean): Promise<SettingsPortableResult>; resetAll(confirmed: boolean): Promise<SettingsPortableResult>; showFile(): Promise<SettingsPortableResult>; onChanged(listener: (ids: readonly string[]) => void): () => void }
  platform: string
  /** The colours of the title bar (the native window buttons are drawn with them on Windows and Linux). */
  setTitleBar(colors: { color: string; symbolColor: string }): void
  /** A command from the native menu (macOS). */
  onCommand(listener: (command: string) => void): () => void
  /** The path of a file dropped on the window (the page itself never sees paths). */
  pathForFile(file: File): string
  /** Tells the main process the interface is listening; answers with what the command line asked to open. */
  ready(): Promise<OpenResult[]>
  /** The file picker (a `.wsnp`, or a ZIP); opens what is chosen. */
  openDialog(): Promise<OpenResult[]>
  /** The folder picker; opens the folder as a root of the tree. */
  openFolderDialog(): Promise<OpenResult[]>
  /** Asks for ZIP files and opens them to browse (a folder picker cannot choose a file on Linux and Windows). */
  openZipDialog(): Promise<OpenResult[]>
  /** Opens a folder (or a ZIP file) of an open folder as a root of its own, so that the Files of the Explorer start in it. */
  openAsRoot(rootId: string, path: string): Promise<OpenResult[]>
  /** Of a root: makes a file playable (`fb-media://`), by ranges. A file of the disk is served as it is; an entry of a ZIP is copied first, to a folder of its own (up to 2 GB). */
  media: { open(id: string, path: string): Promise<MediaOpen>; release(token: string): Promise<void> }
  /** Changes the disk, in a folder that was opened (never in a ZIP, a snapshot or the trash): `path`s are relative to the root. Nothing is ever replaced; a name that is taken is refused. */
  fs: {
    create(id: string, parent: string, name: string, kind: 'file' | 'dir'): Promise<OpResult>
    rename(id: string, path: string, name: string): Promise<OpResult>
    move(id: string, path: string, toFolder: string): Promise<OpResult>
    /** A copy in a folder (also the one it is in); its name is numbered (`a (2).txt`) when the name is taken. The answer has the path of the copy. */
    copy(id: string, path: string, toFolder: string): Promise<OpResult>
    /** `trash`: to the system's trash. `forever`: gone for good (asked only after the trash refused, or by the user). */
    remove(id: string, path: string, how: 'trash' | 'forever'): Promise<OpResult>
  }
  /** Editing the text files of a folder that was opened (phase 3). The text has `\n` for every line ending; the file's own ending and byte order mark are kept in `eol` and `bom` and put back when it is saved. */
  edit: {
    open(id: string, path: string): Promise<EditOpen>
    /** Writes the text whole, through a temporary file renamed over the file. `base` is what `open` (or the last save) said the file was like: if the disk has something else, the answer is `changed` and nothing is written, unless `overwrite`. */
    save(id: string, path: string, text: string, base: FileVersion, options: { eol: LineEnding; bom: boolean; overwrite?: boolean }): Promise<EditSave>
    /** The bytes of a file of a folder (up to 16 MiB), to be edited in the hexadecimal view, and what the file was like. */
    openBytes(id: string, path: string): Promise<EditBytesOpen>
    saveBytes(id: string, path: string, bytes: Uint8Array, base: FileVersion, options: { overwrite?: boolean }): Promise<EditSave>
    saveBytesAs(name: string, bytes: Uint8Array): Promise<SaveResult>
    /** Asks where, and writes the text there (Save As of an editor, which has the text and not the file). */
    saveAs(name: string, text: string, options: { eol: LineEnding; bom: boolean }): Promise<SaveResult>
  }
  /** Changes that were not saved, kept in the application's own folder (`core/drafts.ts`), so that they are there after the application is closed or crashes. A draft is of a file of a folder that was opened. */
  drafts: {
    put(rootId: string, path: string, draft: DraftIn): Promise<boolean>
    get(rootId: string, path: string): Promise<Draft | null>
    delete(rootId: string, path: string): Promise<void>
    /** The drafts that are kept, whatever folder they are in (the interface opens the folder and the file of each at the start). */
    list(): Promise<DraftEntry[]>
    /** Forgets all of them (the setting that keeps them was turned off). */
    clear(): Promise<void>
  }
  /** How many tabs have changes that are not saved: the window asks before it closes while there are some (`onCloseRequested`). */
  setUnsaved(count: number): void
  /** The user chose to close the window although it has unsaved changes (or has none left). */
  leave(): void
  onCloseRequested(listener: () => void): () => void
  /** An office document of a root or a snapshot (docx, pptx, odt, ods, odp, xlsx, xls…): makes its page, which draws it in a sandboxed frame with no network. The token lives as long as the tab. */
  docs: { open(id: string, path: string): Promise<DocOpen>; release(token: string): Promise<void> }
  /** Opens a `.wsnp` of a folder (a file of the disk, by its path in the root) as a snapshot. */
  openInRoot(id: string, path: string): Promise<OpenResult[]>
  /** What is directly in a folder of a root, a ZIP of it, or a folder of that ZIP (`path` is relative to the root; `''` is the root itself). */
  listDir(id: string, path: string): Promise<ListResult>
  /** Every file of a folder or ZIP that is open, by relative path, for Go to File (`hidden`: the ones that start with a dot too). */
  listFiles(id: string, hidden: boolean): Promise<FileListResult>
  openPaths(paths: string[]): Promise<OpenResult[]>
  /** Files the system asked for while the app runs (double-click, a second launch, `open-file`). */
  onOpened(listener: (results: OpenResult[]) => void): () => void
  close(id: string): Promise<void>
  /** A whole file of a snapshot, for a tab. */
  readFile(id: string, path: string): Promise<ReadResult>
  /** `length` bytes (at most 1 MiB) of a file of a folder from `offset`, with the file's size: the hex view reads a big file by pages. */
  readRange(id: string, path: string, offset: number, length: number): Promise<RangeResult>
  /** Asks where to save a file of a snapshot and writes it there, streamed. */
  saveFileAs(id: string, path: string): Promise<SaveResult>
  /** Starts the integrity pass (SHA-256 of every file); progress and the result arrive through `onIntegrity`. */
  verify(id: string): Promise<void>
  onIntegrity(listener: (event: IntegrityEvent) => void): () => void
  /** A click on a link to a file of the snapshot that a tab can show: open it in a tab. */
  onOpenFile(listener: (target: { snapshotId: string; path: string }) => void): () => void
  /** A click on a link to a file that cannot be shown (a PDF, a ZIP…): the Save As dialog was offered, and this is how it ended. */
  onSaved(listener: (saved: { name: string; result: SaveResult }) => void): () => void
  /** Opens a web address in the default browser (http, https and mailto only). */
  openExternal(url: string): Promise<void>
  /** The signers the user trusts, by the fingerprint of their key (wsnp-format/MANIFEST-SIGNING.md). */
  signers: { list(): Promise<Record<string, { name?: string }>>; trust(fingerprint: string, name?: string): Promise<void>; forget(fingerprint: string): Promise<void> }
  /** The version, what it runs on, its licence and the notices of the libraries inside it, for the About window. */
  appInfo(): Promise<AppInfo>
  /** A ZIP in a snapshot (a file of it, or an entry of a ZIP in it, `zip!/entry`): what is in it. */
  zipList(id: string, path: string): Promise<ZipList>
  /** Extracts the named entries (a folder means all under it): one file asks for a file name, the rest for a folder. */
  zipExtract(id: string, path: string, names: string[], options?: { folder?: boolean }): Promise<ExtractResult>
  /** What the page of a snapshot has selected goes to the clipboard; false when nothing is selected. */
  copyFromPage(id: string): Promise<boolean>
  /** Finds text in the page of a snapshot: selects and shows the next (or previous) match, and says how many there are. `reset` starts from the top. */
  findInPage(id: string, query: string, options: { caseSensitive: boolean; backwards: boolean; reset: boolean; count: boolean }): Promise<{ found: boolean; count: number }>
  /** Selects all the text of the page of a snapshot. */
  selectAllInPage(id: string): Promise<void>
  /** A right click in the page of a snapshot: where (in the interface's own coordinates) and whether the page has a selection. */
  onPageContext(listener: (at: { snapshotId: string; x: number; y: number; hasSelection: boolean }) => void): () => void
  /** Removes the selection the search left in the page. */
  clearFindInPage(id: string): Promise<void>
  print(request: PrintRequest): Promise<PrintResult>
  /** Asks where to save a PDF of what `print` would print, and writes it there. */
  savePdf(request: PrintRequest): Promise<SaveResult>
  /** A ZIP saved by PageKeep was converted to show it: asks where to save the `.wsnp`, after the file passes the checks of the format. */
  saveConverted(id: string): Promise<SaveResult>
  /** Opens a file of a snapshot with an application the system asks the user to choose (a copy of the file is handed over, read-only). */
  openWith(id: string, path: string): Promise<OpenWithResult>
  /** Opens a copy of a file in the default application of its type, with no choice. */
  openDefault(id: string, path: string): Promise<OpenWithResult>
  /** The application chosen in the viewer's own chooser; `always` makes it the default for the type. */
  openWithApp(token: string, appId: string, always: boolean): Promise<OpenWithResult>
  /** The chooser was closed without a choice: the copy made for it is removed. */
  openWithCancel(token: string): Promise<void>
  /** Puts text on the clipboard. */
  copyText(text: string): Promise<void>
  /** Shows the snapshot's file, or a file of a root (the ZIP that holds it, for an entry of a ZIP), in the system's file manager. */
  reveal(id: string, path?: string): Promise<void>
  recent: { list(): Promise<string[]>; clear(): Promise<void> }
  /** The side bar's places: the well-known folders, the volumes, the folders opened lately and the ones the user pinned. */
  places: {
    list(): Promise<PlacesData>
    /** Opens the trash as a root (on Windows, the system's Recycle Bin opens instead and nothing is returned). */
    openTrash(): Promise<OpenResult[]>
    /** Pins a folder of a root (`path` is relative to it). False when it is not a folder of the disk, or the list is full. */
    addFavorite(rootId: string, path: string): Promise<boolean>
    removeFavorite(folder: string): Promise<void>
    moveFavorite(folder: string, to: number): Promise<void>
    clearRecentFolders(): Promise<void>
  }
  /** Of a root that is the trash: puts an item (a top-level row) back where it was, or deletes everything in it for good. */
  trash: { restore(rootId: string, name: string): Promise<RestoreResult>; empty(rootId: string): Promise<number> }
  /** The tabs open at the end of the last session (names only), kept by the main process; `save(null)` forgets. */
  session: { load(): Promise<unknown>; save(value: unknown): Promise<void> }
}
