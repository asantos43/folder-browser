# TODO

The plan, phase by phase. Each phase is developed on its own branch and delivered as its own pull request (see `CONTRIBUTING.md`). Check a box when the
code, its tests, its `CHANGELOG.md` lines and its docs are merged.

## Phase 0: scaffold
- [x] Repository `folder-browser` started from WSNP Viewer 0.1.0; renamed (`fb-ui://`, `window.fb`, `fb:` channels, appId); the prototype removed
- [x] `npm ci`, lint, typecheck, unit tests, build and the workbench and snapshot e2e specs pass
- [x] Support files: `CLAUDE.md`, `README.md`, `README.pt-BR.md`, `CHANGELOG.md`, `TODO.md`, `docs/ARCHITECTURE.md`, `.editorconfig`, `.nvmrc`
- [x] New icon (`build/icon.svg`, `build/icon.png`, `build/icons/*`, `public/icon.svg`): concept C2 chosen by the developer: folder with a zipper, a page, a pencil, play and the lens
- [x] `asantos43/folder-browser` created on GitHub (private) and `main` pushed
- [ ] `docs/USER-GUIDE*.md`, `docs/UI-DESIGN.md`, `docs/DEVELOPMENT.md`, `docs/RELEASING.md`, `PRIVACY.md`, `SECURITY.md`: rewrite the parts that still speak only of the viewer
- [ ] `npm run notices` (`THIRD-PARTY-NOTICES.md`) after the new dependencies come in

## Phase 1: browse
- [x] Open a folder or a `.zip` (dialog, drag and drop, command line, a file's folder); the interface names a root by an id and a relative path, and `core/fs/guard.ts` refuses `..` and links that leave it
- [x] Lazy tree of a folder (`core/roots.ts`, `ExplorerTree`), a ZIP expands as a folder (also nested, `a.zip!/b.zip!/c`)
- [x] Switch to show hidden files (`Ctrl+H`, the side bar, the status bar and Settings; kept), for disk and ZIP entries (`core/fs/hidden.ts`)
- [x] Read-only views of text, picture, PDF, Markdown, fonts of a folder or a ZIP; a ZIP also as a list with Extract (context menu: Open as List)
- [ ] Names of the first-level roots in the title bar's "Go to File" (the tree is lazy, so it has no list of every file yet)
- [ ] Open Recent as "Recent Folders" (phase 1d)
- [x] The desktop file also takes `inode/directory` and `application/zip`

## Phase 1b: `.wsnp`
- [x] A `.wsnp` in the tree opens as a snapshot (double click or Enter); "Open as ZIP" lists its entries (`fb:open-in-root`, `RootRegistry.diskFile`)
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
- [ ] A snapshot's own media stays "saved, not played" (docs/VIEWER-GUIDELINES.md); decide whether it should play too

## Phase 2: change files on disk
- [ ] Create file, create folder, **rename** (F2, inline), move (dialog and drag and drop), delete (to the trash, with confirmation)
- [ ] Open tabs follow a renamed or moved item; the tree refreshes
- [ ] Tests: path traversal, symlinks out of the root, move onto an existing name, move a folder into itself

## Phase 3: editor
- [ ] Editable CodeMirror 6 with the language modes; modified marker; `Ctrl+S`; warning on close; binary and over-5-MB files are not edited
- [ ] Atomic save (temporary file and rename) and a check of the modified time against the file on disk

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
