# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is being built

**Folder Browser**: a desktop app (Linux, Windows, macOS) in **Electron + TypeScript** that

- browses folders and ZIP files (a ZIP opens as a folder, nested too), with a switch to show hidden files;
- creates, **renames**, moves, deletes and edits files, and creates, renames and removes folders, on disk **and inside ZIPs**;
- edits text files (HTML, TXT, JSON, code…) with CodeMirror 6, saving to the disk or back into the ZIP;
- compares two text files in a diff (`@codemirror/merge`);
- has a **Places** side bar (Home, Documents, Downloads, Music, Pictures, Videos, Desktop, Trash, Recent Folders, Favourites, volumes);
- **plays video and audio** in a tab (`fb-media://` with Range);
- **draws office documents** (Word, PowerPoint, LibreOffice, Excel) with docx-preview, pptx-renderer and odr-core, each in a sandboxed `fb-doc://` frame with no network; CSV and TSV as a table;
- **shows any file of bytes in hexadecimal** (`HexView`; a file of a folder over 16 MiB is read a window at a time with `fb:read-range`; read-only, never runs anything);
- shows a context menu by kind of file, with **Open With…** (the installed applications) on every file;
- opens `.wsnp` snapshots exactly as WSNP Viewer does (read-only).

It was **started from `~/Dev/AI/projetos/github/wsnp-viewer` 0.1.0** (a copy, not a fork: the history is not shared). The plan is in `TODO.md`; the design in `docs/ARCHITECTURE.md`. Releases: `.exe`, universal `.dmg`, `.deb`, `.rpm` (electron-builder; no AppImage).

**Status:** phase 0 (scaffold), phase 1 (browse a folder or a ZIP, hidden files), 1b (`.wsnp` in the tree), 1c (right-click menu, Open With…) and 1d (Places, favourites, trash) and 1e (video and sound) are done, each on its own branch (`phase-1-browse`, `phase-1b-wsnp`, `phase-1c-context-menu`, `phase-1d-places`, `phase-1e-media`, stacked: each is made on the one before); file operations, the editor, the diff and ZIP editing are not written yet. Read `TODO.md` for what is next.

## Workflow

- The repository is `asantos43/folder-browser`. Each phase of `TODO.md` is developed on its own branch and delivered as a pull request against `main`; never push implementation work directly to `main`. **Do not push, or create the remote repository, without asking.**
- A change is complete only with its tests (same pull request), its lines in `CHANGELOG.md` under `[Unreleased]`, its boxes in `TODO.md`, and the docs it affects (the README in both languages, the user guides in both).
- Test files are synthetic (`fixtures/`); real `.wsnp`/ZIP files from `~/Downloads` come from private sites and never enter the repository.

## Commands

Node 22+ (CI uses 24, `.nvmrc`). `npm ci` first.

- `npm run app` builds and starts the app. `npm run build` builds the interface (`dist/`, Vite) and the main process and preload (`dist-electron/`).
- `npm run lint` (oxlint), `npm run typecheck` (tsc), `npm test` (vitest: `core/`, `electron/`, `src/`, `scripts/`; component tests use `// @vitest-environment happy-dom`).
- One test file or case: `npx vitest run core/zip.test.ts`, `npx vitest run -t "byte range"`.
- `npm run test:e2e`: builds, then Playwright drives the real Electron app. One spec: `npm run build && npx playwright test e2e/workbench.spec.ts`. The specs open windows: leave the computer alone while they run. A spec that fails once may pass alone (a click on a link, when the window lacks focus).
- `npm run format-sync`: the copies of `docs/FORMAT.md` and `docs/MANIFEST-SIGNING.md` must be identical to wsnp-viewer's (the source of truth): **never edit them here**; copy them (and `docs/FORMAT.sha256`) from `../wsnp-viewer`.
- `npm run notices` rewrites `THIRD-PARTY-NOTICES.md` after a change in what the app bundles (`ROOTS` in `scripts/third-party-notices.mjs`); CI runs `notices:check`.
- `npm run package:linux|win|mac`: unsigned release files into `release/` (needs `rpm` for `.rpm`; Fedora also `libxcrypt-compat`). `node scripts/release-local.mjs` builds them in a container (`docs/RELEASING.md`).
- On a Linux CI or container, run Electron under `xvfb-run` with `--no-sandbox`.

## Code layout

- `core/`: plain TypeScript, **no Electron imports**, tested next to the code: `archive/` (yauzl reader, yazl writer), `zip.ts`, `extract.ts` (`safeRelative`), `vpath.ts` (the path `zip!/entry`, nested `a.zip!/b.zip!/c`), `tree.ts`, `filekind.ts`, `snapshots.ts`, `validate/`, `convert/`, `apps.ts`, `stage.ts`, `api.ts` (what the preload offers). `roots.ts` (the folders and ZIP files opened to browse: ids, `list`, `read`, `stream`, `zipAt`), `places.ts` / `favorites.ts` / `trash.ts` (the side bar's places, the pinned folders, the trash), `sources.ts` (a snapshot's id or a root's, behind one set of calls), `fs/` (`guard`, `hidden`, `sort`). To come: `fs/` (ops, writeAtomic), `archive/edit.ts`, `diff.ts`, `places.ts`, `trash.ts`.
- `electron/`: main process: `main.ts`, `window.ts`, `ui-protocol.ts` (`fb-ui://`), `snapshot-host.ts` (IPC and the snapshots), `snapshot-view.ts` (`wsnp://`), `preload.ts` (`window.fb`), `open-with.ts`, `print.ts`, `menu.ts`.
- `src/`: the interface (React 19, Tailwind 4; `theme/tokens.css` is the only place with colours; `i18n/` en and pt-BR; `state/` the pure reducer of tabs; `views/`, `workbench/`, `find/`, `components/`).
- `fixtures/` (synthetic builders), `e2e/`, `scripts/`, `docs/`, `build/` (icons, the Linux MIME file).

## Names (they differ from wsnp-viewer on purpose)

The interface scheme is `fb-ui://`; the preload exposes `window.fb` (`FbApi` in `core/api.ts`); IPC channels and the keys of local storage start with `fb:`. **Kept** because they are the format: the `.wsnp` extension, the `wsnp://` scheme of a snapshot, `_wsnp/`, `application/vnd.wsnp+zip`, the `WSNP_*` environment variables of the tests.

## Safety rules for what writes (new, and the point of this app)

- The main process keeps the **authorised roots**: the folders and ZIPs the user chose (dialog, drop, command line). Every operation takes a path, resolves it (`path.resolve`, `realpath`) and refuses anything outside a root; `..` and a symlink that leaves the root do not pass. Arguments of every IPC handler are `unknown` until validated, and only the interface's own top frame may call (`fromInterface`).
- Delete goes to the trash (`shell.trashItem`); permanent delete only when asked, and confirmed.
- A file is written to a temporary file in the same folder, then renamed; the modified time read is compared with the one on disk first (the file may have changed). A ZIP is rewritten the same way, in one pass for all the operations.
- Move and rename never overwrite without asking, and never put a folder inside itself.
- A `.wsnp` is read-only inside (editing would break its manifest and signature); the whole file can be renamed, moved, deleted.
- A click on a Places item is what authorises that folder; the app never adds a root on its own. Media is served by an id (`fb-media://`), never by a path in the URL.
- Roots and the places are named by id and by a path relative to the root; `fb:favorites-add` takes a root and a path, never a path of the disk. The e2e specs that need a home (`e2e/places.spec.ts`) give the app a made-up one with `HOME`, `XDG_DATA_HOME` and `XDG_CONFIG_HOME/user-dirs.dirs`. Some pointer-and-focus specs (`zoom` tooltips) fail now and then on a busy desktop and pass when run again: do not "fix" them by moving the pointer differently (that made them worse).
- An office document is drawn by `src/docs/{docx,pptx,odf}.ts`, built by `vite.docs.config.ts` into `dist/docs/` (one classic script each; `npm run build` runs `build:docs`). The main process gives each open document a token and serves `fb-doc://<token>/` (the page, `/_file`, `/_v/<flavour>.js`; `electron/doc-protocol.ts`) with a CSP that has `sandbox allow-scripts`, `default-src 'none'` and no network; the interface shows it in `<iframe sandbox="allow-scripts">`, which has an opaque origin and cannot reach `window.fb`. The page tells the interface how it went with `postMessage` (`DocMessage`). A new library or format means a new flavour in `core/docs.ts`, never a script in the interface itself. The odr-core build defines `import.meta.url` (`vite.docs.config.ts`) and needs `connect-src data:` for the WebAssembly it carries inside.
- The hex view draws only the rows in view (a file of 4 GiB has 268 million rows: `scrollMetrics` scales the scroll) and keeps 64 KiB chunks; a bigger-than-16-MiB file of a ZIP or a snapshot is not read that way (only files of a folder), and says so with the plain card. `viewKind` answers `hex` for the extensions of programs and the like, only after a dot (a file called `bin` is still looked at as text).
- A video or a sound is played from `fb-media://<token>/`: the token comes from `fb:media-open`, which resolves a file of a root (or makes a copy of an entry of a ZIP); `MediaView`s stay mounted (hidden) so that a sound goes on playing. Do not let a `useCallback`/`useEffect` of the tree depend on a function that the side bar makes anew at every render (the tree read everything again and lost its rows).
- **A snapshot is a page in a tab, never what the side bar shows.** `ws.selected` is a folder or ZIP file that is open (an entry of Open Folders, opening one, or bringing a tab of one of its files to the front); the page of a snapshot, its metadata and its files never change it. A `.wsnp` opens from the tree (click: preview tab; double click: kept tab), from File ▸ Open File, a drop, the command line or Open Recent: always its page in a tab, with the folder it is in opened beside (`OpenResult.folder`, except from the tree of that folder). The files inside a snapshot open in tabs from the links of its page, from the metadata, and from Go to File (`Ctrl+E`, `e2e/helpers.ts` `goToFile`); there is no tree of them, no list of open snapshots, and no Information or Integrity section: the status bar and the metadata tab say what the check found. For anything more, Open With… hands the file to WSNP Viewer.
- **A snapshot is named by the name of its file** (`snapshotTitle` in `src/workbench/tabInfo.ts`), never by the title of its page or its address: two files can say the same. The title of the page is in its metadata. The frame of a snapshot is `iframe[title="Snapshot: <file name>"]`.
- Open With… hands an application a copy (entries of a ZIP) or the file; the command is run without a shell, with `Exec` parsed from the `.desktop` file; the names that could run as programs are refused (`core/stage.ts`).

## Gotchas inherited from wsnp-viewer

- A hidden view must be created with `offscreen: true` to be photographed. Closing the last hidden window must not quit the app (`window-all-closed`).
- yauzl closes the file itself when the last stream ends: never `closeSync` a descriptor yauzl opened. ZIP64, ZIP encryption and methods other than stored/deflate are refused (so such a ZIP is read-only).
- The interface may import from `core/` only types and pure modules (`@core/…`): importing `core/validate/index.ts` would bundle Node modules into the renderer (use `core/validate/issues.ts`).
- PDFs are drawn by pdf.js in the interface: the build copies its data into `dist/pdfjs/` (`vite.config.ts`), the CSP allows `worker-src 'self'` and `'wasm-unsafe-eval'`, and the `fb-ui` scheme needs `supportFetchAPI`.
- Extraction goes through `safeRelative` and `extractEntries` (never write a ZIP name as it is). The interface keeps no ZIP: the main process holds the last two in memory.
- Find and Copy act on the tab on screen: the page of a snapshot is another process (`fb:page-find`, `fb:page-copy`); a menu press must not move the selection (`onMouseDown` preventDefault); do not give the `FindBar` a `key`.
- An effect must return nothing or a function: `useEffect(() => node?.scrollIntoView?.())` returns what `scrollIntoView` returns and React calls it as the clean-up; write the body in braces.
- A ZIP saved by PageKeep opens converted into a temporary `.wsnp` (`OpenSnapshot.file`; `path` stays the ZIP's).
- Right clicks in the page of a snapshot reach the main process as `context-menu` and are drawn by the interface (`fb:page-context`).
- Linux **Open With…** is our own dialog (`OpenWithDialog`, `core/apps.ts`, `electron/open-with.ts`): the desktop's chooser opens behind the window on Wayland. The e2e tests give `gio` a made-up desktop through `XDG_DATA_HOME`, `XDG_DATA_DIRS`, `XDG_CONFIG_HOME`.
- **Zoom is per tab**: never zoom the window. The wheel and zoom keys inside a snapshot reach the interface only through `core/frameScript.ts`.
- An `<iframe>` moved in the DOM reloads: the snapshot frames keep the order the snapshots were opened in.
- Electron has no DevTools `Page.printToPDF`: use `webContents.printToPDF`.
- `::highlight()` makes Vite print two CSS warnings: harmless.
- Details of the inherited design and its measurements: `docs/WSNP-VIEWER-ARCHITECTURE.md`; the history: `docs/WSNP-VIEWER-HISTORY.md`.

## What WSNP is

A `.wsnp` is a ZIP "photo" of one web page for offline reading: `mimetype` (first entry, stored), `manifest.json`, `index.html`, `assets/…`, `_wsnp/`. The format is `docs/FORMAT.md`; the viewer's duties are `docs/VIEWER-GUIDELINES.md`; signing is `docs/MANIFEST-SIGNING.md`. Constraints that remain: read entries in memory through the ZIP central directory, never unzip to disk or load a whole large file; each snapshot in its own sandboxed view, with every request not its own cancelled; nothing leaves the computer; refusals say why in plain words. English and Brazilian Portuguese, following the system language.
