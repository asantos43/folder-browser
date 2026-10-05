import type { ExtractResult } from './extract.ts'
import type { ListResult, RootInfo } from './roots.ts'
import type { SnapshotInfo } from './snapshots.ts'
import type { ZipEntryInfo } from './zip.ts'
import type { IntegrityReport, Issue } from './validate/index.ts'

/** What the main process offers the interface (through the preload). Plain data only: nothing here can read an archive. */
export type OpenResult =
  | { ok: true; snapshot: SnapshotInfo; /** The file was open already: show its tab. */ already: boolean }
  /** A folder or a ZIP file opened to browse (`open`: the file the user named, when it was a file of a folder: its tab opens too). */
  | { ok: true; root: RootInfo; already: boolean; open?: { path: string; size: number } }
  | { ok: false; path: string; issues: Issue[]; omitted: number }

export type ReadResult = { bytes: Uint8Array } | { error: 'no-snapshot' | 'no-file' | 'too-large' }
export type SaveResult = { saved: true; path: string } | { saved: false; reason: 'cancelled' | 'error'; message?: string }
export type IntegrityEvent = { id: string; state: 'running'; done: number; total: number } | { id: string; state: 'done'; report: IntegrityReport }

export type ZipList = { entries: ZipEntryInfo[]; truncated: boolean } | { error: 'no-snapshot' | 'no-file' | 'too-large' | 'not-zip' }
export type { DirEntry, ListResult, RootInfo } from './roots.ts'
export type { ExtractResult, ZipEntryInfo }
/** What to print: the page of a snapshot, a picture of it, or a text (as the tab shows it). */
export type PrintRequest = { kind: 'snapshot'; id: string } | { kind: 'image'; id: string; path: string } | { kind: 'html'; id: string; path: string } | { kind: 'text'; title: string; text: string; /** The name of the file, for the PDF's. */ name?: string }
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

export interface FbApi {
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
  /** What is directly in a folder of a root, a ZIP of it, or a folder of that ZIP (`path` is relative to the root; `''` is the root itself). */
  listDir(id: string, path: string): Promise<ListResult>
  openPaths(paths: string[]): Promise<OpenResult[]>
  /** Files the system asked for while the app runs (double-click, a second launch, `open-file`). */
  onOpened(listener: (results: OpenResult[]) => void): () => void
  close(id: string): Promise<void>
  /** A whole file of a snapshot, for a tab. */
  readFile(id: string, path: string): Promise<ReadResult>
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
  /** The signers the user trusts, by the fingerprint of their key (docs/MANIFEST-SIGNING.md). */
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
  /** The application chosen in the viewer's own chooser; `always` makes it the default for the type. */
  openWithApp(token: string, appId: string, always: boolean): Promise<OpenWithResult>
  /** The chooser was closed without a choice: the copy made for it is removed. */
  openWithCancel(token: string): Promise<void>
  /** Puts text on the clipboard. */
  copyText(text: string): Promise<void>
  /** Shows the snapshot's file, or a file of a root (the ZIP that holds it, for an entry of a ZIP), in the system's file manager. */
  reveal(id: string, path?: string): Promise<void>
  recent: { list(): Promise<string[]>; clear(): Promise<void> }
  /** The tabs open at the end of the last session (names only), kept by the main process; `save(null)` forgets. */
  session: { load(): Promise<unknown>; save(value: unknown): Promise<void> }
}
