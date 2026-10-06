# Architecture

How Folder Browser is built, and the safety rules of an app that **writes** to the user's files. It was started from WSNP Viewer 0.1.0, whose own decisions and
measurements (Electron, isolation of snapshots, ZIP reading, performance) are in [`WSNP-VIEWER-ARCHITECTURE.md`](WSNP-VIEWER-ARCHITECTURE.md) and still hold here. The plan is in [`../TODO.md`](../TODO.md).

## Stack

Electron 44 and TypeScript; React 19, Tailwind 4 (VS Code's Dark+ and Light+ as tokens), Vite 8; CodeMirror 6 for source, editing and (with `@codemirror/merge`) diff;
yauzl to read and yazl to write ZIPs; pdf.js for PDFs; vitest, happy-dom and Playwright for tests; oxlint; electron-builder.

## Layers

```
src/ (renderer, no Node)  ──window.fb (preload, contextBridge)──▶  electron/ (main: IPC, windows, protocols)  ──▶  core/ (plain TS, no Electron)
                                                                      │
                                                                      └─ wsnp://<id>/ (a snapshot, in an <iframe sandbox>)
```

- `core/` has no Electron import, so everything that reads, writes or decides is unit-tested without a window.
- The renderer imports from `core/` only types and pure modules (`@core/…`).
- The interface is served by the `fb-ui://` protocol with a strict CSP; a snapshot is served by `wsnp://<id>/` from the ZIP, without unzipping it.

## What a path is

| Form | Example | Meaning |
| --- | --- | --- |
| Disk path | `/home/me/notes/a.txt` | a file or a folder |
| Virtual path (`core/vpath.ts`) | `/home/me/a.zip!/docs/b.txt`, `/home/me/a.zip!/in.zip!/c.txt` | an entry in a ZIP, also nested (depth 4) |

A `.wsnp` is a ZIP too, but it opens as a snapshot; "Open as ZIP" lists its entries (read-only).

## Planned modules

| Module | Job |
| --- | --- |
| `core/fs/guard.ts` | The authorised roots. `resolveInside(root, path)` does `resolve` and `realpath`, and refuses what leaves the root (`..`, symlinks) |
| `core/fs/listDir.ts`, `hidden.ts` | One folder at a time (folders first); `isHidden(name)` is the one filter for disk and ZIP entries (a name that starts with a dot) |
| `core/fs/ops.ts` | create file/folder, rename, move, delete (trash): validate names (empty, separators, `.`/`..`, an existing sibling), never overwrite without asking, never move a folder into itself |
| `core/fs/writeAtomic.ts` | temporary file in the same folder, `fsync`, `rename`; compares the modified time that was read |
| `core/archive/edit.ts` | A list of operations on a ZIP (`add`, `replace`, `delete`, `rename`, `mkdir`), applied in **one pass**: read with `reader.ts`, write a new ZIP with `writer.ts` into a temporary file, rename over the original. A folder is an entry ending in `/`; renaming one changes the prefix of its entries. A nested ZIP is rewritten inside out. Refuses ZIP64, encrypted ZIPs and `.wsnp` |
| `core/diff.ts` | Whether two entries can be compared (both text, at most 5 MB) and loading both sides, from disk or a ZIP |
| `core/places.ts`, `core/trash.ts` | The list of places (Home, Documents, Downloads, Music, Pictures, Videos, Desktop, Trash, Computer, volumes, Recent Folders, Favourites), built from the paths the main process gives it and kept only if they exist; the Trash by system (freedesktop `Trash/files` + `.trashinfo`, macOS `~/.Trash`; Windows opens the system Recycle Bin) |
| `electron/media-protocol.ts` | `fb-media://<id>/`: serves a file the user opened with **Range** (206), reusing the logic of `core/serve.ts`; only paths inside the authorised roots, by an id the main process made, never a path in the URL |
| `src/workbench/contextMenu.ts` | `buildContextMenu(selection, ctx)`: a pure function from kind of file, origin (disk, ZIP, `.wsnp`) and selection to the menu |

## IPC (`core/api.ts`, `window.fb`)

Channels start with `fb:`. Every handler checks that the call comes from the interface's own top frame (`fromInterface`) and takes its arguments as `unknown` until they are
validated. New: `list-dir`, `stat`, `read-file`, `write-file`, `create-file`, `create-dir`, `rename`, `move`, `delete`, `zip-apply`, `settings-*`.

## Safety rules for writing

1. **Authorised roots.** The main process keeps the folders and ZIPs the user opened (dialog, drop, command line). A path outside them is refused, after `resolve` and `realpath`.
2. **Trash first.** Delete uses `shell.trashItem`, with a confirmation; permanent delete is a separate, confirmed choice.
3. **Atomic writes.** A file or a ZIP is written to a temporary file next to it, then renamed. If the file changed on disk since it was read (modified time, and for a ZIP its size), the user chooses to overwrite or reload.
4. **No silent overwrite.** Create, move and rename never replace: a name that is taken is refused (a file is hard-linked to its new name, which fails atomically if it exists, and then the old name is removed; where links cannot be made, the name is looked for first), and a folder is never moved into itself. (Phase 2: `core/fs/ops.ts`.)
5. **`.wsnp` is read-only inside**: editing its entries would invalidate the manifest and the signature. The whole file can be renamed, moved or deleted.
6. **Hostile archives.** Names in a ZIP go through `safeRelative`; ZIP64, ZIP encryption and unsupported methods stay read-only; sizes are checked against the directory; a ZIP read in memory is at most 256 MB.
7. **No shell.** Open With… launches an application with the arguments parsed from its `.desktop` file, never through a shell, and a name that could run as a program is not handed over.
8. **Media is served by id.** The `fb-media://` protocol never takes a path from the URL; it answers only for files the user opened, inside the authorised roots.
9. **No network.** The app makes no request; only a web link that the user clicks goes to the default browser.

## Changing the disk (phase 2)

*(`core/fs/names.ts`, `core/fs/ops.ts`, `RootRegistry.create/rename/move/remove`, the `fb:fs-*` channels, `ExplorerTree`, `MoveDialog`, the reducer's `path-changed` and `path-removed`.)* The interface names a root and paths inside it; the main process checks them again. `core/fs/ops.ts` knows no Electron: the trash is handed in (`shell.trashItem`). Rules, all tested: a name is checked by `nameProblem` (the same function in the interface, before asking, and in the main process, before doing; the interface passes `window.fb.platform` because a page has no `process`); the **parent** of an item is resolved with `resolveInside` and the item is then looked at with `lstat`, so that a symbolic link is renamed, moved and removed as the link and never through what it points to; nothing is replaced; a folder never goes into itself or into what is in it; the root, an entry of a ZIP (`!/`), a ZIP as the root and the trash are `unsupported` (phase 5 does the ZIPs). `copyEntry` is the same without the removal: a copy goes to a free name (`a (2).txt`, the number before the whole extension, `.tar.gz` too), so nothing is replaced even in the folder the item is in, with links kept as links and times kept; a folder is never copied into itself; a copy that fails half way is removed. A move across file systems is copied (links kept as links, nothing replaced) and only then removed; a copy that fails is removed. After a change the registry forgets the ZIPs it had in memory for that root.

The tree edits in the row (`NameInput`: Enter says the name, Esc or leaving gives up, a bad or taken name is said in words and the field stays). A delete asks (`ConfirmDialog`), tries the trash, and only if the trash refuses asks again for a permanent delete. After a change `Workbench` makes the tree read again (the listings it has stay on screen while they are read), and the tabs of an item follow it (`path-changed`: the key, the path, the place, the preview, the pin, the zoom and the tab of its bytes) or close with it (`path-removed`).

## Editing text (phase 3)

*(`core/fs/edit.ts`, `RootRegistry.edit/saveEdit`, `fb:edit-*`, `src/state/editors.ts`, `src/views/EditView.tsx`, the reducer's `dirty`, `ChoiceDialog`, the window's close guard in `electron/window.ts`.)* A text file of a **folder root** (not a ZIP root, the trash, an entry of a ZIP or a snapshot: `isEditable`) is edited. The main process reads it (`readForEdit`): UTF-8 only, no NUL byte, at most 5 MB; the text goes to the interface with `\n` for every line ending, plus `eol` and `bom`, and a `FileVersion` (modified time and size). The interface keeps, by the key of the tab, an **`EditorBuffer`**: the CodeMirror state (so changes, undo history and the place survive leaving the tab), the saved document and the version. Save sends the text, the version and the options to `saveEdited`, which looks at the disk first (`changed` unless the user chose to overwrite), writes a temporary file in the same folder (`.name.<random>.fbtmp`, mode kept, `fsync`) and renames it over the file (a link inside the root is written through; one that leaves it is refused); the buffer then takes the new version, and what was typed while it was written still counts as a change. The workspace keeps `dirty` (tabs with changes: the dot, the question when closing). Actions that close tabs go through a guard in `Workbench` (`close`, `close-others`, `close-right`, `close-all`, `root-closed`) that asks when a tab among them has changes; the window asks too (the interface tells the main process how many tabs have changes; the window's `close` is stopped and the interface answers). A read-only view (`TextView`, Markdown, CSV table) of a file that has a buffer shows the buffer's text. The end-to-end specs take the window down in `afterEach` (`destroy`), because a window with changes does not close.

### Unsaved changes (phase 3a)

*(`core/drafts.ts`, `src/state/drafts.ts`, `electron/snapshot-host.ts` `fb:draft-*`, `HexEditView`.)* A tab with changes writes a **draft** to `userData/drafts/` 1.2 s after the last change (`touchDraft`): a JSON file for text, a `.bin` for bytes, named by a hash of the root's path and the file's path, with the version (modified time and size) the changes were made on. A draft is deleted when the tab is no longer dirty (saved, reloaded, closed without saving) and pruned after 90 days. At the start `restoreDrafts` reopens a tab for each draft whose file still exists and hands the draft to `EditView` or `HexEditView`, which build the buffer from it (the disk text or bytes stay as the "saved" state, so the dot and the changed bytes are right) and keep the **old version**, so Save notices a file that changed meanwhile. With the setting `hotExit` on, a window close with changes flushes the drafts and then calls `leave`; off, the main process stops the close and the interface asks. Drafts are the one place where content the user did not save is written to disk, and only in the application's own folder.

### Editing bytes (phase 3a)

*(`core/hexEdit.ts`, `core/fs/edit.ts` `readBytesForEdit`/`saveEditedBytes`, `src/state/hexBuffers.ts`, `src/views/HexEditView.tsx`, `HexView`.)* `HexDoc` is the bytes plus the set of changed offsets and an undo and redo stack of splices (typing a byte's two digits is one step). Editing is for files of a **folder root** up to `HEX_EDIT_LIMIT` (16 MiB), read whole. The write is the same as for text (temporary file, fsync, mode, rename, version check), so `saveEdited` is now `saveEditedBytes` with the text encoded. The hex view draws only rows in view, so editing keeps that: an edit changes the document and the rows redraw; one virtual cell after the last byte lets bytes be appended.

## Places and favourites

*(Built in phase 1d: `core/places.ts`, `core/favorites.ts`, `core/trash.ts`, `electron/places-ipc.ts`, `src/workbench/PlacesView.tsx`.)* 
The side bar starts with a **Places** section: Home, Desktop, Documents, Downloads, Music, Pictures, Videos, Trash, Computer, mounted volumes, **Recent Folders** and the folders the user pinned (**Favourites**). A click is the user's choice, so
the folder becomes an authorised root; the app never authorises a folder on its own. Dragging files onto a place moves them there. Favourites and recent folders are kept in `favorites.json` and `recent-folders.json` in the app's folder (written whole, then renamed, like `session.json`).

## Office documents

*(Built in phase 1n: `core/docs.ts`, `electron/doc-protocol.ts`, `src/docs/`, `src/views/DocumentView.tsx`.)* Word, PowerPoint, OpenDocument and Excel files are drawn by libraries that exist already and have licences that allow it, not by code of ours: **docx-preview** (Apache-2.0) for `.docx`, **pptx-renderer** (Apache-2.0) for `.pptx`, **odr-core** (MPL-2.0, C++ compiled to WebAssembly) for `.odt`, `.ods`, `.odp`, `.odg`, `.xlsx`, `.xls`, `.doc`, `.ppt`. The services Gmail and Outlook use are not libraries (they run on the provider's servers) and would send the file away, which `PRIVACY.md` forbids.

A document is hostile input, so nothing is drawn in the interface's own page. `fb:doc-open` reads the file (up to 48 MB) and gives it an unguessable token; `fb-doc://<token>/` serves a page whose script (`/_v/<flavour>.js`, one per library, built by `vite.docs.config.ts`) fetches `/_file` and draws it. The interface shows that page in `<iframe sandbox="allow-scripts">` (an opaque origin: no `window.fb`, no storage, no access to the parent), and the page's own policy (`DOC_CSP`) is `default-src 'none'`, scripts of its own address only, `connect-src 'self' data:`, images and fonts from `data:`/`blob:`: no network. The session's request filter lets through only the frame the interface makes and what that frame asks of its own token. The page tells the interface how it went with `postMessage` (the interface listens to the message of that frame's window only). For a workbook, odr-core's first view is every sheet stacked with no names, so the page draws the sheets one at a time with a bar. The drawing is kept while the tab is not in front (the frame stays, laid out but invisible, because `pptx-renderer` measures its room), and is made when the tab is first shown. The zoom of the tab lays the frame out at 1/zoom of the room and scales it, as the page of a snapshot is; the page cannot zoom itself, so it says (`postMessage`) that the wheel or a zoom key was used with Control held (a frame inside it, which draws a view of an OpenDocument file, says so to the page, which says it on) and the interface zooms the tab. Find is the browser's own, run by the main process in the frame of the document (`pageFrame` knows `wsnp://` and `fb-doc://` frames; for an OpenDocument file, the frame inside the page): the page registers itself as the `fileTarget` while its tab is in front. Print and Save as PDF make a window that is never shown with a session of its own (`renderDocument`): it loads the page with `?print=1`, the page draws the whole document (for OpenDocument, the whole file written into the page instead of one view in a frame), and the page sets `window.__fbDocState` when it is drawn.

CSV and TSV are a table drawn by the interface itself from text it parsed (`core/csv.ts`): a cell is only ever a text node.

## Media

*(Built in phase 1e: `core/media.ts`, `electron/snapshot-host.ts` (`fb:media-open`), `src/views/MediaView.tsx`.)* A video or a sound of a **snapshot** is played too (decided by the developer; WSNP Viewer only offers it with Save As): the type is the one its manifest declares, the file is copied for the tab like an entry of a ZIP, and Previous/Next are not offered there (a snapshot has no folder listing).

Video and audio play in a tab (`MediaView`, the Chromium's `<video>` and `<audio>`), from the `fb-media://` protocol with Range so that seeking works on large files. An entry in a ZIP that is *stored* is streamed from the archive; a *deflated* one has no cheap seek, so it is
played from a temporary copy (`core/stage.ts`, removed at quit, up to 2 GB). What the Chromium cannot decode (for example HEVC) is said in words, with **Open With…** as the way out. The page of a media file runs nothing: it is a decoder and a set of controls.

## Editing and diff

The editor is CodeMirror 6 (the language modes the viewer already had, chosen by `core/filekind.ts`): history, search, `Ctrl+S`, a modified marker on the tab, a warning on close. Binary files and files over 5 MB are not edited (they open read-only or in
`OtherView`). Text is UTF-8. The diff is `MergeView` of `@codemirror/merge`, side by side or unified; either side may come from a ZIP.

## Tests

Unit tests next to the code in `core/` (guard with `..` and symlinks, ops, atomic write, `archive/edit` round trips and failures that leave the original untouched, hostile names); component tests (happy-dom) for the reducer of tabs,
the tree and `buildContextMenu`; end-to-end tests with Playwright against the real app (create, rename, move, delete, edit and save on disk and in a ZIP, diff, hidden files, `.wsnp`); packaging smoke test (`scripts/package-smoke.mjs`).
Fixtures are synthetic (`fixtures/`, including `hostile.ts`).
