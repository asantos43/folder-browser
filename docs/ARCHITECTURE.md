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
4. **No silent overwrite.** Move and rename to an existing name ask first; a folder is never moved into itself.
5. **`.wsnp` is read-only inside**: editing its entries would invalidate the manifest and the signature. The whole file can be renamed, moved or deleted.
6. **Hostile archives.** Names in a ZIP go through `safeRelative`; ZIP64, ZIP encryption and unsupported methods stay read-only; sizes are checked against the directory; a ZIP read in memory is at most 256 MB.
7. **No shell.** Open With… launches an application with the arguments parsed from its `.desktop` file, never through a shell, and a name that could run as a program is not handed over.
8. **Media is served by id.** The `fb-media://` protocol never takes a path from the URL; it answers only for files the user opened, inside the authorised roots.
9. **No network.** The app makes no request; only a web link that the user clicks goes to the default browser.

## Places and favourites

*(Built in phase 1d: `core/places.ts`, `core/favorites.ts`, `core/trash.ts`, `electron/places-ipc.ts`, `src/workbench/PlacesView.tsx`.)* 
The side bar starts with a **Places** section: Home, Desktop, Documents, Downloads, Music, Pictures, Videos, Trash, Computer, mounted volumes, **Recent Folders** and the folders the user pinned (**Favourites**). A click is the user's choice, so
the folder becomes an authorised root; the app never authorises a folder on its own. Dragging files onto a place moves them there. Favourites and recent folders are kept in `favorites.json` and `recent-folders.json` in the app's folder (written whole, then renamed, like `session.json`).

## Office documents

*(Built in phase 1n: `core/docs.ts`, `electron/doc-protocol.ts`, `src/docs/`, `src/views/DocumentView.tsx`.)* Word, PowerPoint, OpenDocument and Excel files are drawn by libraries that exist already and have licences that allow it, not by code of ours: **docx-preview** (Apache-2.0) for `.docx`, **pptx-renderer** (Apache-2.0) for `.pptx`, **odr-core** (MPL-2.0, C++ compiled to WebAssembly) for `.odt`, `.ods`, `.odp`, `.odg`, `.xlsx`, `.xls`, `.doc`, `.ppt`. The services Gmail and Outlook use are not libraries (they run on the provider's servers) and would send the file away, which `PRIVACY.md` forbids.

A document is hostile input, so nothing is drawn in the interface's own page. `fb:doc-open` reads the file (up to 48 MB) and gives it an unguessable token; `fb-doc://<token>/` serves a page whose script (`/_v/<flavour>.js`, one per library, built by `vite.docs.config.ts`) fetches `/_file` and draws it. The interface shows that page in `<iframe sandbox="allow-scripts">` (an opaque origin: no `window.fb`, no storage, no access to the parent), and the page's own policy (`DOC_CSP`) is `default-src 'none'`, scripts of its own address only, `connect-src 'self' data:`, images and fonts from `data:`/`blob:`: no network. The session's request filter lets through only the frame the interface makes and what that frame asks of its own token. The page tells the interface how it went with `postMessage` (the interface listens to the message of that frame's window only). For a workbook, odr-core's first view is every sheet stacked with no names, so the page draws the sheets one at a time with a bar. What is not done: zoom, Find and Print inside the frame, and keeping the drawing when the tab is not in front (TODO phase 1m).

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
