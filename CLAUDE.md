# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is being built

**Folder Browser**: a desktop app (Linux, Windows, macOS) in **Electron + TypeScript** that

- browses folders and ZIP files (a ZIP opens as a folder, nested too), with a switch to show hidden files;
- creates, **renames**, moves, deletes and edits files, and creates, renames and removes folders, on disk **and inside ZIPs**;
- edits text files (HTML, TXT, JSON, code…) with CodeMirror 6, saving to the disk or back into the ZIP;
- compares two text files in a diff (`@codemirror/merge`);
- shows a context menu by kind of file, with **Open With…** (the installed applications) on every file;
- opens `.wsnp` snapshots exactly as WSNP Viewer does (read-only).

It was **started from `~/Dev/AI/projetos/github/wsnp-viewer` 0.1.0** (a copy, not a fork: the history is not shared). The plan is in `TODO.md`; the design in `docs/ARCHITECTURE.md`. Releases: `.exe`, universal `.dmg`, `.deb`, `.rpm` (electron-builder; no AppImage).

**Status:** phase 0 (scaffold) is done: everything that wsnp-viewer 0.1.0 does works here under the new names; the browser, the editor, the diff and the file operations are not written yet. Read `TODO.md` for what is next.

## Workflow

- The repository is `asantos43/folder-browser`. Each phase of `TODO.md` is developed on its own branch and delivered as a pull request against `main`; never push implementation work directly to `main`. **Do not push, or create the remote repository, without asking.**
- A change is complete only with its tests (same pull request), its lines in `CHANGELOG.md` under `[Unreleased]`, its boxes in `TODO.md`, and the docs it affects (the README in both languages, the user guides in both).
- Test files are synthetic (`fixtures/`); real `.wsnp`/ZIP files from `~/Downloads` come from private sites and never enter the repository.

## Commands

Node 22+ (CI uses 24, `.nvmrc`). `npm ci` first.

- `npm run app` builds and starts the app. `npm run build` builds the interface (`dist/`, Vite) and the main process and preload (`dist-electron/`).
- `npm run lint` (oxlint), `npm run typecheck` (tsc), `npm test` (vitest: `core/`, `electron/`, `export/`, `src/`, `scripts/`; component tests use `// @vitest-environment happy-dom`).
- One test file or case: `npx vitest run core/zip.test.ts`, `npx vitest run -t "byte range"`.
- `npm run test:e2e`: builds, then Playwright drives the real Electron app. One spec: `npm run build && npx playwright test e2e/workbench.spec.ts`. The specs open windows: leave the computer alone while they run. A spec that fails once may pass alone (a click on a link, when the window lacks focus).
- `npm run format-sync`: the copies of `docs/FORMAT.md` and `docs/MANIFEST-SIGNING.md` must be identical to wsnp-viewer's (the source of truth): **never edit them here**; copy them (and `docs/FORMAT.sha256`) from `../wsnp-viewer`.
- `npm run notices` rewrites `THIRD-PARTY-NOTICES.md` after a change in what the app bundles (`ROOTS` in `scripts/third-party-notices.mjs`); CI runs `notices:check`.
- `npm run package:linux|win|mac`: unsigned release files into `release/` (needs `rpm` for `.rpm`; Fedora also `libxcrypt-compat`). `node scripts/release-local.mjs` builds them in a container (`docs/RELEASING.md`).
- On a Linux CI or container, run Electron under `xvfb-run` with `--no-sandbox`.

## Code layout

- `core/`: plain TypeScript, **no Electron imports**, tested next to the code: `archive/` (yauzl reader, yazl writer), `zip.ts`, `extract.ts` (`safeRelative`), `vpath.ts` (the path `zip!/entry`, nested `a.zip!/b.zip!/c`), `tree.ts`, `filekind.ts`, `snapshots.ts`, `validate/`, `convert/`, `apps.ts`, `stage.ts`, `api.ts` (what the preload offers). To come: `fs/` (guard, listDir, hidden, ops, writeAtomic), `archive/edit.ts`, `diff.ts`.
- `electron/`: main process: `main.ts`, `window.ts`, `ui-protocol.ts` (`fb-ui://`), `snapshot-host.ts` (IPC and the snapshots), `snapshot-view.ts` (`wsnp://`), `preload.ts` (`window.fb`), `open-with.ts`, `print.ts`, `menu.ts`.
- `src/`: the interface (React 19, Tailwind 4; `theme/tokens.css` is the only place with colours; `i18n/` en and pt-BR; `state/` the pure reducer of tabs; `views/`, `workbench/`, `find/`, `components/`).
- `export/` (capture, PDF), `fixtures/` (synthetic builders), `e2e/`, `scripts/`, `docs/`, `build/` (icons, the Linux MIME file).

## Names (they differ from wsnp-viewer on purpose)

The interface scheme is `fb-ui://`; the preload exposes `window.fb` (`FbApi` in `core/api.ts`); IPC channels and the keys of local storage start with `fb:`. **Kept** because they are the format: the `.wsnp` extension, the `wsnp://` scheme of a snapshot, `_wsnp/`, `application/vnd.wsnp+zip`, the `WSNP_*` environment variables of the tests.

## Safety rules for what writes (new, and the point of this app)

- The main process keeps the **authorised roots**: the folders and ZIPs the user chose (dialog, drop, command line). Every operation takes a path, resolves it (`path.resolve`, `realpath`) and refuses anything outside a root; `..` and a symlink that leaves the root do not pass. Arguments of every IPC handler are `unknown` until validated, and only the interface's own top frame may call (`fromInterface`).
- Delete goes to the trash (`shell.trashItem`); permanent delete only when asked, and confirmed.
- A file is written to a temporary file in the same folder, then renamed; the modified time read is compared with the one on disk first (the file may have changed). A ZIP is rewritten the same way, in one pass for all the operations.
- Move and rename never overwrite without asking, and never put a folder inside itself.
- A `.wsnp` is read-only inside (editing would break its manifest and signature); the whole file can be renamed, moved, deleted.
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
