# TODO

The plan, phase by phase. Each phase is developed on its own branch and delivered as its own pull request (see `CONTRIBUTING.md`). Check a box when the
code, its tests, its `CHANGELOG.md` lines and its docs are merged.

## Phase 0: scaffold
- [x] Repository `folder-browser` started from WSNP Viewer 0.1.0; renamed (`fb-ui://`, `window.fb`, `fb:` channels, appId); the prototype removed
- [x] `npm ci`, lint, typecheck, unit tests, build and the workbench and snapshot e2e specs pass
- [x] Support files: `CLAUDE.md`, `README.md`, `README.pt-BR.md`, `CHANGELOG.md`, `TODO.md`, `docs/ARCHITECTURE.md`, `.editorconfig`, `.nvmrc`
- [x] New icon (`build/icon.svg`, `build/icon.png`, `build/icons/*`, `public/icon.svg`): concept C2 chosen by the developer: folder with a zipper, a page, a pencil, play and the lens
- [x] `asantos43/folder-browser` created on GitHub (private) and `main` pushed
- [x] `docs/USER-GUIDE.md` and `docs/USER-GUIDE.pt-BR.md` rewritten for Folder Browser (phase 2); `docs/UI-DESIGN.md` (the table of what each part becomes), `docs/DEVELOPMENT.md`, `PRIVACY.md` (en and pt-BR) and `SECURITY.md` brought up to date. `docs/RELEASING.md` has nothing of the viewer that is wrong, but is untried (no release was made yet)
- [x] Screenshots for the user guide and the README: `npm run screenshots` (`scripts/screenshots.ts`) drives the real application over a synthetic folder (`scripts/demo-folder.ts`, also what to open to look at the app: `node scripts/demo-folder.ts`) and writes `docs/images/*.png`; both guides show them. The windows are 1280×800 in Light+ (and one in Dark+); pictures of Windows and macOS are still to take
- [ ] In a narrow editor group (two groups side by side at 1280 px) the toolbar of a Markdown file overlaps the buttons of the other group: let the toolbar wrap or hide labels
- [x] `npm run notices` (`THIRD-PARTY-NOTICES.md`) after the new dependencies come in

## Phase 1: browse
- [x] Open a folder or a `.zip` (dialog, drag and drop, command line, a file's folder); the interface names a root by an id and a relative path, and `core/fs/guard.ts` refuses `..` and links that leave it
- [x] Lazy tree of a folder (`core/roots.ts`, `ExplorerTree`), a ZIP expands as a folder (also nested, `a.zip!/b.zip!/c`)
- [x] Switch to show hidden files (`Ctrl+H`, the side bar, the status bar and Settings; kept), for disk and ZIP entries (`core/fs/hidden.ts`)
- [x] Read-only views of text, picture, PDF, Markdown, fonts of a folder or a ZIP; a ZIP also as a list with Extract (context menu: Open as List)
- [ ] Names of the first-level roots in the title bar's "Go to File" (the tree is lazy, so it has no list of every file yet)
- [ ] Open Recent as "Recent Folders" (phase 1d)
- [x] The desktop file also takes `inode/directory` and `application/zip`

## Phase 1b: `.wsnp`
- [x] A `.wsnp` in the tree is a file like the others, viewed as the page it represents: a click previews it (italic tab), a double click or Enter keeps it in a tab of its own; no list of open snapshots and no side bar for it; "Open as ZIP" lists its entries (`fb:open-in-root`, `RootRegistry.diskFile`); the Open Snapshots section shows only while one is open
- [x] Same behaviour as WSNP Viewer: it is the same code (a snapshot opened from the tree is opened like one from the picker: integrity, signature, Print, Save as PDF, Find, zoom); the inherited specs pass
- [ ] A PageKeep ZIP found in a folder opens as a snapshot (today it opens as a ZIP folder; "Open as Snapshot" for `.zip` rows)
- [ ] Entries of a `.wsnp` are read-only (the whole file can be renamed, moved, deleted): nothing writes yet, so this is a rule for phases 2 to 5 (`core/archive/edit.ts` must refuse a `.wsnp`)

## Phase 1c: right-click menu and Open With…
- [x] The right-click menu of the tree by kind of row (`src/workbench/treeMenu.ts`, pure and tested): folder, file, ZIP, `.wsnp`; entries in a ZIP get the file menu
- [x] Several rows selected: the menu of marked rows has Cut, Copy, Move to…, Delete and Compare Selected (see "Several rows and the file clipboard" below); Extract of several rows is not there yet
- [x] **Open With…** on every file, with the installed applications (`core/apps.ts`, `OpenWithDialog`); a read-only copy for entries in a ZIP; also **Open with Default Application**, Show in Folder, Copy Path, Copy Name and Properties

## Phase 1d: places and favourites
- [x] "Places" section above the tree: Home, Desktop, Documents, Downloads, Music, Pictures, Videos (`app.getPath`), Trash, Computer, mounted volumes (`core/places.ts`, `PlacesView`)
- [x] Recent Folders (last 10 folders and ZIPs, can be cleared) and Favourites (add from the folder's context menu or by dragging a folder onto them; reorder and remove; `core/favorites.ts`)
- [ ] Rename a favourite (today a favourite is shown by the name of its folder)
- [x] Trash (`core/trash.ts`): browse, Restore (never over what is there), Empty Trash (asks first: `ConfirmDialog`) on Linux and macOS; opens the system Recycle Bin on Windows (not tried: no Windows machine here)
- [ ] Dragging files onto a place moves them there; onto Trash deletes (with confirmation): needs the file operations of phase 2
- [x] A click on a place opens that folder as a root (the interface names roots by id; the main process never opens one on its own)

## Phase 1e: media playback
- [x] `mediaKind` in `core/filekind.ts` (video or audio, by type or name); `MediaView` with the browser's own player (play/pause, seek, volume, speed, full screen), Repeat, Next/Previous through the media files of the folder, a sound that ends goes on to the next, Media Session keys; the player keeps playing when another tab comes to the front
- [x] `fb-media://<token>/` protocol with Range (`core/media.ts`, reuses `parseRange` of `core/serve.ts`), by an unguessable token the main process gives for a file of a root; `media-src fb-media:` in the CSP
- [x] Entries of a ZIP are played from a temporary copy (`core/stage.ts` with `maxBytes`, up to 2 GB; removed when the tab closes and at quit); streaming stored entries straight from the ZIP is left for later
- [x] Formats the Chromium cannot play (HEVC…) say why and offer Open With… and Save As
- [x] Tests: Range server (206, 416, HEAD), tokens, `MediaView`, a synthetic `.wav` in e2e (plays, seeks, goes on in the background, from a ZIP, broken file)
- [ ] Try a real mp4 (H.264), mp3, flac and an HEVC file by hand (the tests only have WAV and a broken file: no encoder here)
- [x] A snapshot's own media plays too (by the type its manifest declares; a link to it in the page opens a tab); Previous/Next are not offered for it
- [x] The open-snapshot mode is gone (the list, the side bar with the files of a snapshot, Information and Integrity, `asFile`): a snapshot is a page in a tab; its inner files open from the links of the page, the metadata and Go to File; WSNP Viewer (Open With…) is for anything more
- [ ] Previous/Next for the media of a snapshot (from its list of files)

- [x] Order the files of a folder by name, date or size (button and View menu), with the size and the date on each row
- [ ] Columns for size and date that the user can turn on or off, and drag to resize (today: the one the order is by, both when the side bar is wide)

## Phase 1m: hexadecimal view and spreadsheets
- [x] `core/hex.ts` (rows, search patterns, header identification, search through a file by blocks, scroll metrics for files of any length), `HexView` (virtual rows, selection, copy, Go to offset, Find), `fb:read-range` for big files of a folder, `viewKind` `hex` for programs and the like, "View as hex" on every file that is not shown
- [x] "Open as Hex" in the right-click menu of any file: a tab that says how it is shown (`Tab.as`, `hexKey`), kept in the session; "View as hex" opens the same tab
- [ ] Header panel for ELF, PE and Mach-O (sections, imports): read-only, no execution
- [x] Office documents with ready-made libraries (looked for first; TabularJS and SheetJS were tried and left out): docx-preview (docx), pptx-renderer (pptx), odr-core (odt, ods, odp, odg, xlsx, xls, doc, ppt), each in a sandboxed `fb-doc://` frame (`core/docs.ts`, `electron/doc-protocol.ts`, `src/docs/`, `DocumentView`)
- [x] CSV and TSV as a table, with a Table / Text switch (`core/csv.ts`, `CsvView`)
- [x] Zoom, Find (`Ctrl+F`) and Print inside a document's frame; zoom and `Ctrl+F` for the bytes of a file; Open With… in the toolbars of documents, bytes, tables and cards; View as hex in the toolbar of every text; `.log` as text up to 32 MB
- [ ] Print the bytes of a file and the CSV table as a table (a CSV prints as its text)
- [ ] Zoom keys with the focus inside a document are relayed by the page (the main process reads real key presses first); Find of a pptx highlights in the slide list only
- [x] A document's tab keeps its drawing when another tab comes to the front (drawn on first view, kept hidden but laid out)
- [ ] Try real files by hand (Word with headers and footnotes, a PowerPoint with charts and SmartArt, an `.xls`): the tests only have small hand-written ones
- [ ] `.rtf`, `.pages`, `.numbers`, `.key`: not drawn (Open With… or hex)

## Phase 3b: tables (CSV and TSV)
Feasibility checked on 2026-10-06 (developer's request). Tried: `sql.js` 1.14 (SQLite compiled to WebAssembly, MIT; 46 KB of script and a 658 KB `.wasm`) ran `WHERE`, `ORDER BY`, `LIKE`, arithmetic, `COUNT`/`SUM`/`AVG` on a table made of CSV rows, and a query over 200,000 rows took 37 ms in Node. Rejected: **AlaSQL** (MIT) compiles every query with `new Function`, which the interface's policy forbids (`'unsafe-eval'` is never allowed), and has had prototype-pollution reports; **DuckDB-Wasm** is 149 MB unpacked.
- [x] **Search** the table (`Ctrl+F`: cells marked, next/previous), **sort** by a column (number, ISO date or text, found from the values; up, down, file order; the file is not changed) and **filter** by column (contains, equals, starts/ends with, empty, comparisons, or the distinct values to tick). No dependency; a virtualized table of fixed-height rows (`TableView`: 100,000 rows scroll; up to 500,000 rows and 500 columns; `core/table.ts`)
- [x] A **header row** switch and the **types** found from the values (`inferTypes`: number, date, text)
- [x] A **query box** (`core/sqlTable.ts`, `src/workers/sql.worker.ts`, `SqlSession`): one `SELECT`/`WITH` on the table `t` run by sql.js in a worker, `PRAGMA query_only = ON`, 100,000 rows back at most, 10-second limit (the worker is ended); the result replaces the rows shown (Show All Rows) and **Export Result** saves it as a CSV
- [x] **Edit cells in the table** (`core/csvEdit.ts`, `TableEditView`): in place with Enter, F2, typing or a double click; add and delete rows and columns (toolbar and right-click menu); undo and redo; every edit is a transaction on the editor's buffer at the span of the cell, so the dot, Save, the disk check, line endings, the byte order mark, drafts and the Text view are the editor's, and the rest of the file stays byte for byte
- [ ] Select a range of cells (copy and paste a block, fill down, delete a range); paste from a spreadsheet
- [ ] Resize and reorder columns; freeze columns; show or hide a column
- [ ] Dates in other formats (`dd/mm/yyyy`) in sort, filter and the query; a column type chosen by hand
- [ ] More than one filter on a column; a "case sensitive" and a "whole word" box in the filter; search in one column
- [ ] A saved query (per file) and a history of the queries; `JOIN` with another CSV of the folder
- [ ] A bigger CSV than 5 MB can be edited (today it is looked at, with sorting, filters and the query); an `.xlsx` sheet as a table

## Open points of phase 1 (to pick up between phases)
- [ ] Decide whether the **Save as .wsnp…** bar of a converted PageKeep ZIP (`ConvertedBar`) stays: it is the only part of the viewer's conversion still in the app; the **Metadata** tab of a snapshot stays for now
- [ ] Try the app on **Windows and macOS** (Trash, Open With…, the chooser, icons, packages): everything so far was tried on Linux only
- [ ] Try real files by hand: an mp4 (H.264), mp3, flac, an HEVC file; a Word file with headers and footnotes, a PowerPoint with charts and SmartArt, an `.xls`, a big `.docx` (zoom, Find, Print)
- [ ] Print the bytes of a file; print a CSV table as a table
- [ ] The header panel of ELF, PE and Mach-O files in the hex view
- [ ] Previous/Next for the media of a snapshot; rename a favourite; columns for size and date the user can choose
- [x] The pull requests: phases 1 to 1p were one line of history, merged into `main` as one pull request (#5). The CI jobs of GitHub could not start (billing of the account): the checks were run on the developer's computer
- [x] **GitHub Actions** only for the macOS `.dmg` (`release.yml`, started by hand: unit tests, packaging smoke test, adds the `.dmg` and its checksum to the release); no CI on pull requests (the free quota is spared). Not yet tried: it needs the account's billing fixed, and a release to add to

## Phase 2: change files on disk
- [x] `core/fs/names.ts` (what a name may be; Windows rules on Windows) and `core/fs/ops.ts` (`createEntry`, `renameEntry`, `moveEntry`, `removeEntry`): never replace (a file is hard-linked to its new name, which fails if it is taken), never leave the root (the parent is resolved, so a symbolic link is renamed, moved or removed as the link), never put a folder inside itself, nothing inside a ZIP; `RootRegistry` lets go of the ZIPs it had read
- [x] Create file and folder (a field in the tree, from the header buttons, the menu of a folder and the empty part of the tree), **rename** (`F2` or the menu, in the row, the name without its extension selected), **move** (Move to… with a folder picker, and drag and drop onto a folder or onto the empty part), **delete** (`Delete` or the menu, asks; to the trash, and for good only when the trash refused and the user said yes again)
- [x] Open tabs follow a renamed or moved item (key, path, place, preview, pin, zoom, and the bytes tab of it) and close with a deleted one; the tree reads again without taking its rows away
- [x] Tests: path traversal, symbolic links out of the root, move onto an existing name, move a folder into itself, names (unit); the tree's field, menu, keys and drops (component); the whole flow in the real app (e2e `fileops.spec.ts`)
- [x] Several rows selected (Ctrl/⌘+click, Shift+click, Shift+arrows, Ctrl+A) to move, copy, delete, cut, paste and compare at once; extract at once is still to do
- [ ] Drag onto a place of the side bar to move there, and onto Trash to delete (the places are other folders than the root)
- [x] Copy by dragging with Shift (also a duplicate in the same folder; numbered, never replacing); Shift+Delete for the permanent delete; folders that open while an item is dragged over them
- [x] Copy, cut and paste (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`; ⌘ on macOS) of files and folders in the tree and in the right-click menu; pasting a copy where it came from is a duplicate (numbered)
- [ ] Press Shift *before* the drag: Chromium starts no drag when the mouse goes down with Shift held (it selects); a drag of our own (pointer events) would allow it
- [ ] Undo of the last delete (Restore from the trash is there) or move

## Several rows and the file clipboard (between phases 5 and 6)
- [x] The tree marks several rows: **Ctrl/⌘+click** toggles one, **Shift+click** marks a range from the last row clicked, **Shift+arrows** extend it, **Ctrl/⌘+A** marks every row on screen, **Esc** or a plain click lets them go; a Ctrl or Shift click only marks (nothing opens); marks go with their row (`src/workbench/selection.ts`, `ExplorerTree`)
- [x] An action on a marked row is on all of them, once, and what is in a marked folder is left out (`topmost`): **Delete** and `Shift+Delete` (one question, one notice; the ones the trash cannot take are asked about again, for good), **Move to…** (`MoveDialog` takes the list), dragging (the marked rows go together; Shift copies; a file dragged with others is not a file for the editor), and **Compare Selected** for two text files; the menu of marked rows says how many
- [x] **Cut, Copy and Paste** (`Ctrl/⌘+X`, `+C`, `+V`, and in the menu of a file, a folder, marked rows and the empty part of the tree): the application's own clipboard (`src/workbench/fileClipboard.ts`); Paste goes into the folder (or ZIP file) that has the focus, next to the file that has it, or into the root; a paste of a copy is numbered, a paste of a cut is a move and is done once, and what was cut is dimmed; in a ZIP it works inside the same ZIP; the macOS Edit menu has Cut, Copy and Paste
- [x] Tests: `selection.test.ts`, the tree (marks, keys, menus, drag and drop, the clipboard), `MoveDialog.test.tsx`, the real app (`e2e/multiselect.spec.ts`)
- [ ] Paste between two open folders (and between the disk and a ZIP), and paste what another application copied (files from the file manager); put the names of the copied rows on the system clipboard as text
- [ ] Mark with the pointer (a rubber band), and **Extract** for several rows
- [ ] Try the clipboard keys on **macOS** (the Edit menu roles Cut and Paste were added, as Copy already was) and Windows: tried on Linux only

## Phase 3: editor
- [x] Editable CodeMirror 6 with the language modes (`EditView`, `editableExtensions`); the dot on the tab; `Ctrl+S` / Save All; the question when tabs or the window close with changes; binary, non-UTF-8 and over-5-MB files are shown, not edited, with the reason
- [x] Atomic save (temporary file and rename, permissions kept) and the check of time and size against the disk (Overwrite / Load from Disk); line endings and byte order mark kept (`core/fs/edit.ts`)
- [x] Format Document (undoable); Save As… of the text on screen; the text of a renamed tab goes with it
- [ ] A file that changes on disk while it is open: reload a clean tab by itself and warn on a dirty one when the window gets the focus (today only Save notices)
- [ ] Find and Replace (`Ctrl+H` is Show Hidden Files here: a replace bar of its own), go to line, multiple cursors
- [ ] Deleting a file whose tab has changes asks first (today the changes go with the tab)
- [ ] Other encodings (Latin-1, UTF-16) with a choice in the status bar; mixed line endings flagged
- [x] Edit the CSV and TSV **table** (cells), with sorting, filtering by column and value, search and a SQL query: see "Phase 3b" below

## Phase 3a: unsaved changes kept, and editing bytes
- [x] Drafts (`core/drafts.ts`, `fb:draft-*`, `src/state/drafts.ts`): the changes of a text or hex tab are kept in the app's folder a moment after typing, restored at the next start as modified tabs, removed on save, reload or close; the window closes without asking; Settings ▸ Keep changes that are not saved
- [x] Edit the bytes in the hex view (`core/hexEdit.ts`, `HexEditView`, `HexView` editing): overwrite by digit or character, Insert, Delete, Backspace, add at the end, undo and redo, Save with the atomic write and the disk check, drafts of bytes
- [ ] Hex: paste bytes, fill a selection, search and replace bytes, a check mark for the bytes saved but not yet on disk
- [ ] Drafts of a new, never-saved file (when New File… edits before it creates)

## Phase 4: diff
- [x] Select two text files with **Select for Compare** and **Compare with Selected** in the tree's menu (as VS Code), including entries in a ZIP and files of two different open folders; the tab follows a rename of a side and closes when a side is deleted or its folder closed (`core/diff.ts`, `open-diff` in `src/state/workspace.ts`)
- [x] `@codemirror/merge` in `DiffView`: side by side and in one column, with the colours of each file's language and of the theme; changes counted, Previous / Next Change (`F7`, `Shift+F7`), Swap Sides, Collapse Unchanged; line endings are not compared (and the toolbar says when they differ); files that are not UTF-8 text, or over 5 MB, are refused with the reason
- [x] **Drag to compare**: a text file of the tree dropped on another text file, or a tab dropped in the middle of another text tab, asks **Open Side by Side**, **Compare (Diff)** or Cancel (`ChoiceDialog`); a drop on a folder, a file that is not a text, or with Shift (a copy) is as before
- [x] **Two editor groups** (`Tab.group`, `Workspace.focus` / `other`, `move-to-group`; `src/state/groups.ts`): a tab can be split to the right (tab menu **Split Right**, **Move to Left / Right Group**), or dragged, or a file of the tree dragged, to the right half of the editor (with two groups: to the one the pointer is over); each group has its own tabs, tab in front, Find, language and print; the second ends when it has no tab; the layout is kept for the next start
- [ ] More than two editor groups, and a split below (a grid of groups)
- [ ] Resize the groups by dragging their edge and remember the sizes; `Ctrl+1` / `Ctrl+2` to go to a group, and a command to split from the keyboard
- [x] A text file of the tree (or a tab) dropped on the middle of the editor or of a text tab asks Open Side by Side / Compare (Diff); the sides still open in the group on that side
- [ ] Drag a tab to the tree or out of the window; the same file in two groups at once (a tab is one file today, so it moves)
- [x] Some unit tests (`HexEditView`, `DiffView`, the About window) failed at random when the whole suite ran under load: the wait of the component tests is five seconds (`src/test/setup.ts`)
- [x] Ctrl+click to select two rows of the tree and **Compare Selected** in their menu
- [ ] Compare from a tab's menu
- [ ] Compare a text with the unsaved changes of its tab (today a side is the file as it is on disk), and a file of a snapshot as a side
- [ ] Edit in the diff (accept or reject a change), and a diff of two folders

## Phase 5: edit inside a ZIP
- [x] `core/archive/edit.ts`: `create`, `replace`, `mkdir`, `remove`, `move` (rename) and `copy`; one rewrite for many operations, into a temporary file next to the ZIP, then renamed over it (the old ZIP is looked at again before the rename); ZIP in a ZIP taken out, changed and put back; the entries it did not touch are copied as they were (method, date, mode, order)
- [x] Edit and save a text entry (`FileVersion.crc32`: the entry is compared by size and CRC-32, another entry changing is not a conflict); create, rename, move, copy and delete entries and folders from the tree (menu, `F2`, `Delete`, drag, Shift-drag, Move to…), also in a ZIP opened as the root and in a ZIP in a ZIP; the tabs follow
- [x] ZIP64, encrypted entries, other methods, names that could leave a folder, repeated names and over 100,000 entries stay read-only and say why; a `.wsnp` is never changed inside; no move or copy between the disk and a ZIP or between two ZIPs; the delete of an entry is permanent and asked at once (a ZIP has no trash)
- [x] Tests: the operations, hostile and read-only ZIPs, nested ZIPs, a change by someone else, permissions, big entries (`core/archive/edit.test.ts`); the registry with paths in ZIPs, links that leave the root, the trash, the queue (`core/roots.test.ts`); the tree, the menu, the move dialog; the real app (`e2e/zipedit.spec.ts`)
- [ ] Move and copy between a folder and a ZIP (and between two ZIPs), and drop a file from the disk or the desktop into a ZIP (an "add" from outside)
- [ ] Edit the bytes of an entry of a ZIP in the hex view (today only a file of a folder); a CSV entry of a ZIP is edited as a table through the text buffer, but no test covers it yet
- [ ] Rewrite only the tail of the ZIP when entries are added at the end (today every change rewrites the whole ZIP); raw copy of compressed entries without recompressing them
- [ ] A ZIP that is written again while a tab shows one of its entries read-only (media, document, picture) keeps showing the old bytes until the tab is opened again

## Phase 6: finish
- [ ] README, CHANGELOG, user guides (en and pt-BR), docs complete; screenshots
- [ ] Packages: deb, rpm, NSIS, dmg; `npm run package:smoke`; try the `.rpm` on Fedora
- [ ] First release

## Ideas for later
- Hidden attribute of Windows (today only names that start with a dot)
- ZIP64 and other encodings than UTF-8
- Search inside files; copy and paste of files; a terminal here
- External subtitles (`.srt`, `.vtt`) beside a video; a playlist that survives closing the tab
- Password protection and `.wsnpx` from `docs/VIEWER-GUIDELINES.md`
