# TODO

The plan, phase by phase. Each phase is developed on its own branch and delivered as its own pull request (see `CONTRIBUTING.md`). Check a box when the
code, its tests, its `CHANGELOG.md` lines and its docs are merged.

## Phase 0: scaffold
- [x] Repository `folder-browser` started from WSNP Viewer 0.1.0; renamed (`fb-ui://`, `window.fb`, `fb:` channels, appId); the prototype removed
- [x] `npm ci`, lint, typecheck, unit tests, build and the workbench and snapshot e2e specs pass
- [x] Support files: `CLAUDE.md`, `README.md`, `README.pt-BR.md`, `CHANGELOG.md`, `TODO.md`, `docs/ARCHITECTURE.md`, `.editorconfig`, `.nvmrc`
- [ ] New icon (`build/icon.svg`, `build/icon.png`, `public/icon.svg`; today a placeholder from WSNP Viewer)
- [ ] Create `asantos43/folder-browser` on GitHub and push (ask first)
- [ ] `docs/USER-GUIDE*.md`, `docs/UI-DESIGN.md`, `docs/DEVELOPMENT.md`, `docs/RELEASING.md`, `PRIVACY.md`, `SECURITY.md`: rewrite the parts that still speak only of the viewer
- [ ] `npm run notices` (`THIRD-PARTY-NOTICES.md`) after the new dependencies come in

## Phase 1: browse
- [ ] Open a folder or a `.zip` (dialog, drag and drop, command line); authorised roots in the main process (`core/fs/guard.ts`)
- [ ] Lazy tree of a folder (`core/fs/listDir`), a ZIP expands as a folder (also nested, `a.zip!/b.zip!/c`)
- [ ] Switch to show hidden files (`Ctrl+H`, kept in settings), for disk and ZIP entries (`core/fs/hidden.ts`)
- [ ] Read-only views of text, picture, PDF, Markdown, fonts; extract from a ZIP
- [ ] The desktop file also takes `inode/directory` and `application/zip`

## Phase 1b: `.wsnp`
- [ ] A `.wsnp` in the tree opens as a snapshot (double click); "Open as ZIP" shows its entries
- [ ] Same behaviour as WSNP Viewer: integrity, signature, PageKeep conversion, Print, Save as PDF, Find, zoom (the inherited specs pass against the tree)
- [ ] Entries of a `.wsnp` are read-only (the whole file can be renamed, moved, deleted)

## Phase 1c: right-click menu and Open With…
- [ ] `buildContextMenu` by kind of file (folder, text, picture, PDF, ZIP, `.wsnp`, font/other, entry in a ZIP, several selected)
- [ ] **Open With…** on every file, with the installed applications (`core/apps.ts`, `OpenWithDialog`); a copy for entries in a ZIP

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
- Password protection and `.wsnpx` from `docs/VIEWER-GUIDELINES.md`
