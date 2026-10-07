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

**Status:** done and merged into `main`: phases 0 to 1p (scaffold, browsing, `.wsnp`, right-click menu, Places, media, hex view, office documents, tables as read-only), 2 (file operations on disk), 3 (text editor), 3a (unsaved changes kept, bytes editing in the hex view) 3b (tables: sort, filter, search, SQL query, cell editing) 4 (diff of two text files) 5 (edit inside a ZIP: files and folders, text entries, nested ZIPs) and 5b (several rows marked in the tree, Cut/Copy/Paste of files, compare by dragging onto the editor or a tab, Open ZIP File…, the user guide with pictures: `npm run screenshots`); GitHub Actions is manual (macOS `.dmg` only). 6 (the user guide inside the application, pictures, the release files); **v0.1.2 is the first release with all four files** (`.deb`, `.rpm`, `.exe`, `.dmg`), under the MPL-2.0, and the repository is public (`main` protected: changes only by pull request; non-collaborators can open issues). Read `TODO.md` for what is next.

## Workflow

- The repository is `asantos43/folder-browser`. Each piece of work of `TODO.md` (open work is listed by area, delivered work by phase) is developed on its own branch and delivered as a pull request against `main`; never push implementation work directly to `main`. **Do not push, or create the remote repository, without asking.**
- **Performance is a priority of every new feature** (the rule at the top of `TODO.md`): a budget stated before the code (time, frames, memory, the size of the input), no heavy work on the interface's thread, streaming and virtual lists, batched and throttled IPC, cancellation, bounded memory, no slower start, and a test that fails when the budget is exceeded, with the measured numbers in the pull request.
- **Reviews** (plugins installed for the user, see "Development process" in `TODO.md`): `/pr-review-toolkit:review-pr` before the merge of every pull request that changes application code, and `/claude-security` (scan changes, effort `high`) when it touches a parser, a writer, an IPC channel, file-system paths, a started process or the CSP; their agents run in parallel; the cost is told to the user first, and **they are never run unless the user asks for it in that message** (the weekly usage limit matters to the user: see "Light use" below).
- A change is complete only with its tests (same pull request), its lines in `CHANGELOG.md` under `[Unreleased]`, its boxes in `TODO.md`, and the docs it affects (the README in both languages, the user guides in both).
- Test files are synthetic (`fixtures/`); real `.wsnp`/ZIP files from `~/Downloads` come from private sites and never enter the repository.

## Light use: how to work while the usage limit is a concern
The user's weekly limit is finite, and they want room for light use. Unless told otherwise, work this way:
- **Never start a token-heavy run on my own**: `/claude-security` (any scan), `/pr-review-toolkit:review-pr`, `/code-review ultra`, or any other review with many agents. The plugins only *suggest* a scan after a push or a pull request: that is not a reason to run one. When a review is wanted, **ask first and say what it costs**; then the lightest useful form: a scan of **this branch's changes at `medium` effort** (not the whole repository, not `high`), a review of one pull request at a time.
- **Prefer the cheap local checks**: `npm run lint`, `npm run typecheck`, the unit tests of the areas changed (`npx vitest run <paths>`) and only the end-to-end specs of those areas while developing; the whole suite once before the pull request, as `CLAUDE.md` says. The release is the only place for the full set (`release-local.mjs --e2e`).
- **`TODO.md` is only an index** (the performance rule, the roadmap, and a table of areas): the open work is in `docs/todo/<area>.md`, one file per area, and the history in `docs/todo/history.md`; **read only the area file you work on** (and only the section of it that you need), never all of them. The design rules of each feature are in `docs/DESIGN-RULES.md`, by section: read the one for the area you change. Never read `package-lock.json` or `THIRD-PARTY-NOTICES.md` (about 70,000 and 44,000 tokens each).
- **Keep sessions small**: read only the parts of a file that are needed, search with a narrow pattern, do not paste large outputs, write plans in `TODO.md` rather than re-deriving them, and finish one piece of work (one branch, one pull request) before opening the next.
- **A code graph of this repository is installed** (`codebase-memory-mcp` 0.11.0, MIT, local only; registered for this project in the `analysis` profile: read-only tools). In a session where its tools are listed, **prefer them to reading whole files**: `get_file_outline` and `get_code_snippet` for one function of a long file (`Workbench.tsx`), `trace_path` for who calls a function, `search_graph` for a symbol, `detect_changes` for what a diff touches, `get_architecture` for an overview. The index is in `~/.cache/codebase-memory-mcp/`, outside the repository; the watcher keeps it up to date while a session runs, and after big changes it is rebuilt with `codebase-memory-mcp cli index_repository --repo-path <this folder>` (the CLI also runs any tool from a shell). Its answers are a map, not the truth: **read the code before you change it**. Installed from a verified release (`docs/DEVELOPMENT.md`, "Code graph").
- **`rtk` is installed (0.51.0, Homebrew) but its automatic hook is NOT enabled**: the hook rewrites every Bash command and some filters lose information (`rtk ls -la` drops permissions and dates), and on this project's already short commands the saving measured only 0 to 10 %. Use it **by hand, only for a command with long output**: `rtk err <cmd>` (only errors and warnings), `rtk test <cmd>` (only failures), `rtk playwright test …`, `rtk vitest …`; the elided part comes back with `rtk recall <hash>`. **Never** for a command whose exact output is reported or parsed (the release checks, `git log` formats, checksums) and never when a failure must be shown in full. Details: `docs/DEVELOPMENT.md`, "rtk".
- **No agents or sub-sessions for work that can be done directly**; batch independent tool calls in one step; do not re-run a check that already passed on the same code.
- **When the limit is near**: stop starting new work, finish and merge what is open (or leave a clean branch with a note in `TODO.md`), and say what is left.

## Commands

Node 22+ (the macOS release workflow uses 24, `.nvmrc`). `npm ci` first. **GitHub Actions never runs by itself** (to spare the free quota): the checks are run locally, and the only workflow is `.github/workflows/release.yml` (macOS `.dmg`, started by hand; `docs/RELEASING.md`).

- `npm run app` builds and starts the app. `npm run build` builds the interface (`dist/`, Vite) and the main process and preload (`dist-electron/`).
- `npm run lint` (oxlint), `npm run typecheck` (tsc), `npm test` (vitest: `core/`, `electron/`, `src/`, `scripts/`; component tests use `// @vitest-environment happy-dom`).
- One test file or case: `npx vitest run core/zip.test.ts`, `npx vitest run -t "byte range"`.
- `npm run test:e2e`: builds, then Playwright drives the real Electron app. One spec: `npm run build && npx playwright test e2e/workbench.spec.ts`. The specs open windows: leave the computer alone while they run. A spec that fails once may pass alone (a click on a link, when the window lacks focus).
- The user guide is **inside the application**: `vite.config.ts` (`guideFiles`) copies `docs/USER-GUIDE.md`, `docs/USER-GUIDE.pt-BR.md` and `docs/images/` into `dist/guide/`, and `GuideView` (Help ▸ User Guide, `F1`, `Tab.view = 'guide'`, `GUIDE_KEY`) reads the one for the interface's language by the `fb-ui` scheme and draws it with `src/views/guideMarkdown.ts` (its own pictures `images/*.png`, `#heading` links that scroll, web links to the browser, anything else as text). A new heading or picture in the guide needs nothing else; keep its links to other files of the repository out of what a user must follow (they show as plain text there).
- `npm run screenshots` rewrites `docs/images/*.png` for the guides and the README (the app over `scripts/demo-folder.ts`, a synthetic folder: `node scripts/demo-folder.ts [folder]` makes one to look at the app with). Wait for the titlebar before resizing the window, or the pictures come out blank.
- The WSNP format (`FORMAT.md`, `MANIFEST-SIGNING.md`) is **not in this repository**: it lives in `wsnp-format` (`~/Dev/AI/projetos/github/wsnp-format`, https://github.com/asantos43/wsnp-format), shared with PageKeep and WSNP Viewer. A change to what the format says is made there first; code and docs here only link to it.
- `npm run notices` rewrites `THIRD-PARTY-NOTICES.md` after a change in what the app bundles (`ROOTS` in `scripts/third-party-notices.mjs`); `release-local.mjs` runs `notices:check`.
- `npm run package:linux|win|mac`: unsigned release files into `release/` (needs `rpm` for `.rpm`; Fedora also `libxcrypt-compat`). `node scripts/release-local.mjs` builds them in a container (`docs/RELEASING.md`).
- On a Linux CI or container, run Electron under `xvfb-run` with `--no-sandbox`.

## Code layout

- `core/`: plain TypeScript, **no Electron imports**, tested next to the code: `archive/` (yauzl reader, yazl writer, `edit.ts` the changes of a ZIP), `zip.ts`, `extract.ts` (`safeRelative`), `vpath.ts` (the path `zip!/entry`, nested `a.zip!/b.zip!/c`), `tree.ts`, `filekind.ts`, `snapshots.ts`, `validate/`, `convert/`, `apps.ts`, `stage.ts`, `api.ts` (what the preload offers). `roots.ts` (the folders and ZIP files opened to browse: ids, `list`, `read`, `stream`, `zipAt`), `places.ts` / `favorites.ts` / `trash.ts` (the side bar's places, the pinned folders, the trash), `sources.ts` (a snapshot's id or a root's, behind one set of calls), `fs/` (`guard`, `hidden`, `sort`).
- `electron/`: main process: `main.ts`, `window.ts`, `ui-protocol.ts` (`fb-ui://`), `snapshot-host.ts` (IPC and the snapshots), `snapshot-view.ts` (`wsnp://`), `preload.ts` (`window.fb`), `open-with.ts`, `print.ts`, `menu.ts`.
- `src/`: the interface (React 19, Tailwind 4; `theme/tokens.css` is the only place with colours; `i18n/` en and pt-BR; `state/` the pure reducer of tabs; `views/`, `workbench/`, `find/`, `components/`).
- `fixtures/` (synthetic builders), `e2e/`, `scripts/`, `docs/`, `build/` (icons, the Linux MIME file).

## Names (they differ from wsnp-viewer on purpose)

The interface scheme is `fb-ui://`; the preload exposes `window.fb` (`FbApi` in `core/api.ts`); IPC channels and the keys of local storage start with `fb:`. **Kept** because they are the format: the `.wsnp` extension, the `wsnp://` scheme of a snapshot, `_wsnp/`, `application/vnd.wsnp+zip`, the `WSNP_*` environment variables of the tests.

## Rules that always apply (the point of this app)

- The main process keeps the **authorised roots**: the folders and ZIPs the user chose (dialog, drop, command line). Every operation takes a path, resolves it (`path.resolve`, `realpath`) and refuses anything outside a root; `..` and a symlink that leaves the root do not pass. Arguments of every IPC handler are `unknown` until validated, and only the interface's own top frame may call (`fromInterface`).
- Delete goes to the trash (`shell.trashItem`); permanent delete only when asked, and confirmed.
- A file is written to a temporary file in the same folder, then renamed; the modified time read is compared with the one on disk first (the file may have changed). A ZIP is rewritten the same way, in one pass for all the operations.
- Move and rename never overwrite without asking, and never put a folder inside itself.
- A `.wsnp` is read-only inside (editing would break its manifest and signature); the whole file can be renamed, moved, deleted.
- A click on a Places item is what authorises that folder; the app never adds a root on its own. Media is served by an id (`fb-media://`), never by a path in the URL.
- Roots and the places are named by id and by a path relative to the root; `fb:favorites-add` takes a root and a path, never a path of the disk. The e2e specs that need a home (`e2e/places.spec.ts`) give the app a made-up one with `HOME`, `XDG_DATA_HOME` and `XDG_CONFIG_HOME/user-dirs.dirs`. Some pointer-and-focus specs (`zoom` tooltips) fail now and then on a busy desktop and pass when run again: do not "fix" them by moving the pointer differently (that made them worse).
- **A snapshot is a page in a tab, never what the side bar shows.** `ws.selected` is a folder or ZIP file that is open (an entry of Open Folders, opening one, or bringing a tab of one of its files to the front); the page of a snapshot, its metadata and its files never change it. A `.wsnp` opens from the tree (click: preview tab; double click: kept tab), from File ▸ Open File, a drop, the command line or Open Recent: always its page in a tab, with the folder it is in opened beside (`OpenResult.folder`, except from the tree of that folder). The files inside a snapshot open in tabs from the links of its page, from the metadata, and from Go to File (`Ctrl+E`, `e2e/helpers.ts` `goToFile`); there is no tree of them, no list of open snapshots, and no Information or Integrity section: the status bar and the metadata tab say what the check found. For anything more, Open With… hands the file to WSNP Viewer.
- **A snapshot is named by the name of its file** (`snapshotTitle` in `src/workbench/tabInfo.ts`), never by the title of its page or its address: two files can say the same. The title of the page is in its metadata. The frame of a snapshot is `iframe[title="Snapshot: <file name>"]`.

## Design rules by area (in `docs/DESIGN-RULES.md`: read the section before you touch the area)

- **Writing to the disk**: *Changing the disk* (`core/fs/ops.ts`: a new operation is a new `fb:fs-*` channel validated as `unknown`, an `OpResult`, and a test that a path leaving the root is refused); *Editing inside a ZIP*; *Several rows and the file clipboard*.
- **Editors**: *Editing text*; *Unsaved changes and hot exit*; *Tables*; *Diff*; *Editor groups*; *A new text file (Untitled)*; *The hex view*; *A file shown as its bytes*.
- **Viewers**: *Office documents*; *Zoom, Find and Print of a document*; *Playing video and sound*; *Open With…*.
- **Gotchas inherited from wsnp-viewer** (yauzl and ZIP64, what the interface may import from `core/`, PDFs in the interface, Find and Copy on the tab on screen, effects that return a function, iframes that reload, Linux Open With, zoom per tab, `printToPDF`): the last section of that file.

## What WSNP is

A `.wsnp` is a ZIP "photo" of one web page for offline reading: `mimetype` (first entry, stored), `manifest.json`, `index.html`, `assets/…`, `_wsnp/`. The format is `wsnp-format/FORMAT.md`; the viewer's duties are `docs/VIEWER-GUIDELINES.md`; signing is `wsnp-format/MANIFEST-SIGNING.md`. Constraints that remain: read entries in memory through the ZIP central directory, never unzip to disk or load a whole large file; each snapshot in its own sandboxed view, with every request not its own cancelled; nothing leaves the computer; refusals say why in plain words. English and Brazilian Portuguese, following the system language.
