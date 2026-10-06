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
- [ ] Screenshots for the user guide and the README (the old ones were of WSNP Viewer and were taken out of the guide)
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
- [ ] Several rows selected (Compare Selected, Move to…, Delete, Extract) and the actions of later phases (Edit, Compare, Play, Rename…) join the lists as they land
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

## Tables (CSV and TSV): feasibility checked on 2026-10-06 (developer's request), to build as phase 3b
What was tried: `sql.js` 1.14 (SQLite compiled to WebAssembly, MIT; 46 KB of script and a 658 KB `.wasm`) ran `WHERE`, `ORDER BY`, `LIKE`, arithmetic, `COUNT`/`SUM`/`AVG` on a table made of CSV rows, and a query over 200,000 rows took 37 ms in Node. Rejected: **AlaSQL** (MIT) compiles every query with `new Function`, which the interface's policy forbids (`'unsafe-eval'` is never allowed), and has had prototype-pollution reports; **DuckDB-Wasm** is 149 MB unpacked; a SQL-like parser of our own is the fallback if sql.js is not wanted.
- [ ] **Search** the table (all cells or one column), matches marked, next/previous; **sort** by a column (text, number or date, found from the values; up or down; the file is not changed); **filter** by column and value (contains, equals, not empty, comparisons, a list of the distinct values to tick). No dependency. Needs a virtualized table (rows of a fixed height) because the table today draws at most 5,000 rows and 200 columns, and a 5 MB file has about 100,000.
- [ ] A **header row** switch (the first row is the header, or not) and **types** found from the values (number, date, text), shown in the column header.
- [ ] A **query box**: `SELECT … FROM t WHERE … ORDER BY … LIMIT …` run by sql.js in a Worker (`worker-src 'self'`, `wasm-unsafe-eval` is already allowed): one statement only, `PRAGMA query_only = ON`, a time limit (the worker is ended), the table named `t` with the columns named by the header; the rows of the result replace the rows shown (with "Show all rows" to go back), and **Export result** saves them as a CSV. Nothing in the file is written by a query.
- [ ] **Edit cells in the table** (double click or `F2` on a cell, `Enter` and `Esc`, Tab to the next cell), add and delete rows and columns, with undo and redo: the edits are **transactions on the text of the editor's buffer** (`EditorBuffer`), at the span of each cell (the parser records `from`/`to` of every cell), so the dot on the tab, Save, the check against the disk, the line endings and the byte order mark are the ones of the text editor, and everything the user did not touch stays byte for byte as it was (quoting included). A cell that needs quotes gets them. Rows with several lines in a cell are edited in a field that has several lines.
- [ ] Large files: edit and query up to the editor's 5 MB; a bigger CSV stays a read-only table (up to the log limit) with search, sort and filter in memory.

## Open points of phase 1 (to pick up between phases)
- [ ] Decide whether the **Save as .wsnp…** bar of a converted PageKeep ZIP (`ConvertedBar`) stays: it is the only part of the viewer's conversion still in the app; the **Metadata** tab of a snapshot stays for now
- [ ] Try the app on **Windows and macOS** (Trash, Open With…, the chooser, icons, packages): everything so far was tried on Linux only
- [ ] Try real files by hand: an mp4 (H.264), mp3, flac, an HEVC file; a Word file with headers and footnotes, a PowerPoint with charts and SmartArt, an `.xls`, a big `.docx` (zoom, Find, Print)
- [ ] Print the bytes of a file; print a CSV table as a table
- [ ] The header panel of ELF, PE and Mach-O files in the hex view
- [ ] Previous/Next for the media of a snapshot; rename a favourite; columns for size and date the user can choose
- [x] The pull requests: phases 1 to 1p were one line of history, merged into `main` as one pull request (#5). The CI jobs of GitHub could not start (billing of the account): the checks were run on the developer's computer
- [ ] **GitHub Actions** (`ci.yml`, `release.yml`) have never run: the account's billing has to be fixed first

## Phase 2: change files on disk
- [x] `core/fs/names.ts` (what a name may be; Windows rules on Windows) and `core/fs/ops.ts` (`createEntry`, `renameEntry`, `moveEntry`, `removeEntry`): never replace (a file is hard-linked to its new name, which fails if it is taken), never leave the root (the parent is resolved, so a symbolic link is renamed, moved or removed as the link), never put a folder inside itself, nothing inside a ZIP; `RootRegistry` lets go of the ZIPs it had read
- [x] Create file and folder (a field in the tree, from the header buttons, the menu of a folder and the empty part of the tree), **rename** (`F2` or the menu, in the row, the name without its extension selected), **move** (Move to… with a folder picker, and drag and drop onto a folder or onto the empty part), **delete** (`Delete` or the menu, asks; to the trash, and for good only when the trash refused and the user said yes again)
- [x] Open tabs follow a renamed or moved item (key, path, place, preview, pin, zoom, and the bytes tab of it) and close with a deleted one; the tree reads again without taking its rows away
- [x] Tests: path traversal, symbolic links out of the root, move onto an existing name, move a folder into itself, names (unit); the tree's field, menu, keys and drops (component); the whole flow in the real app (e2e `fileops.spec.ts`)
- [ ] Several rows selected (Ctrl/Shift click) to move, delete and extract at once
- [ ] Drag onto a place of the side bar to move there, and onto Trash to delete (the places are other folders than the root)
- [x] Copy by dragging with Shift (also a duplicate in the same folder; numbered, never replacing); Shift+Delete for the permanent delete; folders that open while an item is dragged over them
- [ ] Copy and paste (`Ctrl+C` / `Ctrl+V`) of files in the tree, and Duplicate in the menu
- [ ] Press Shift *before* the drag: Chromium starts no drag when the mouse goes down with Shift held (it selects); a drag of our own (pointer events) would allow it
- [ ] Undo of the last delete (Restore from the trash is there) or move

## Phase 3: editor
- [x] Editable CodeMirror 6 with the language modes (`EditView`, `editableExtensions`); the dot on the tab; `Ctrl+S` / Save All; the question when tabs or the window close with changes; binary, non-UTF-8 and over-5-MB files are shown, not edited, with the reason
- [x] Atomic save (temporary file and rename, permissions kept) and the check of time and size against the disk (Overwrite / Load from Disk); line endings and byte order mark kept (`core/fs/edit.ts`)
- [x] Format Document (undoable); Save As… of the text on screen; the text of a renamed tab goes with it
- [ ] A file that changes on disk while it is open: reload a clean tab by itself and warn on a dirty one when the window gets the focus (today only Save notices)
- [ ] Find and Replace (`Ctrl+H` is Show Hidden Files here: a replace bar of its own), go to line, multiple cursors
- [ ] Deleting a file whose tab has changes asks first (today the changes go with the tab)
- [ ] Other encodings (Latin-1, UTF-16) with a choice in the status bar; mixed line endings flagged
- [ ] Edit the CSV and TSV **table** (cells), with sorting, filtering by column and value, search and a SQL-like query: see "Tables" below

## Phase 4: diff
- [ ] Select two text files (Ctrl+click, or "Select for compare" and "Compare with selected"), including entries in a ZIP
- [ ] `@codemirror/merge`: side by side and unified, with syntax colours

## Phase 5: edit inside a ZIP
- [ ] `core/archive/edit.ts`: add, replace, delete, rename/move, mkdir; one rewrite for many operations, into a temporary file, then rename
- [ ] Edit and save a text entry; create, rename, move and delete entries and folders; nested ZIPs; ZIP64 and encrypted ZIPs stay read-only; `.wsnp` entries refused

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
