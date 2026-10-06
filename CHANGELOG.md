# Changelog

All notable changes to Folder Browser are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Every pull request adds its lines under **Unreleased**.

What came from WSNP Viewer 0.1.0 is in [`docs/WSNP-VIEWER-HISTORY.md`](docs/WSNP-VIEWER-HISTORY.md).

## [Unreleased]

### Added

- The project, started from WSNP Viewer 0.1.0: Electron 44, React 19, Tailwind 4, Vite, CodeMirror 6, vitest and Playwright, with the `.wsnp` viewer, the tabs, the file tree, the ZIP list, Find, Print and Open With… it already had.
- The support files: `CLAUDE.md`, `README.md` and `README.pt-BR.md`, `TODO.md` (the plan, by phase), `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `PRIVACY.md`, `.editorconfig`, `.nvmrc`.

- The plan now includes a **Places** side bar (Home, Documents, Downloads, Music, Pictures, Videos, Desktop, Trash, Recent Folders, Favourites, volumes) and **video and audio playback** (`TODO.md` phases 1d and 1e, `docs/ARCHITECTURE.md`).

- The icon of Folder Browser (`build/icon.svg` and the PNGs made from it): a folder closed by a zipper, with a page being edited, a play button and the lens, on WSNP Viewer's midnight background and colours. It is the application's icon in the Dock, the taskbar and on the desktop.

- **Browse a folder or a ZIP file** (phase 1): File ▸ Open Folder… (`Ctrl+Shift+O`), a drop on the window, or a path on the command line opens a folder, a ZIP file, or the folder of a file named on its own. The side bar lists the open folders (**Open Folders**) and shows the selected one as a tree that asks for one level at a time (`core/roots.ts`, `src/workbench/ExplorerTree.tsx`); a ZIP file opens like a folder, also inside a ZIP; a click opens a preview tab, a double click keeps it. The files open in the views the viewer already had (source, Markdown, picture, PDF, font, ZIP list with Extract), by their names, and a file of no known type is read and shown as text when it is. Open folders and their tabs come back at the next start.
- **Hidden files**: the files and folders whose name starts with a dot are listed but shown only when asked: View ▸ Show Hidden Files (`Ctrl+H`), the eye in the side bar, the status bar and Settings ▸ Files. The same rule (`core/fs/hidden.ts`) for the disk and the entries of a ZIP.
- **A `.wsnp` in a folder opens as a snapshot** (phase 1b): a double click (or Enter) on it in the tree opens it exactly as the file picker does (isolated, checked, no network), and the folder stays open; **Open as ZIP** in its context menu lists its entries instead. `core/roots.ts` gives a `.wsnp` of the disk its own kind (`wsnp`); `fb:open-in-root` takes the root and a path in it, never a path of the disk.
- **Right-click menu of the tree** (phase 1c): by kind of row (`treeMenuFor`: a folder expands and refreshes; a ZIP opens as a folder or a list; a `.wsnp` as a snapshot or a ZIP; any other file in a tab), and for every file **Open With…** (the viewer's own chooser on Linux), **Open with Default Application**, Save As…, Show in File Manager, Copy Path, Copy Name and **Properties** (a dialog with the name, the place, the kind, the size and the date). Both ways of opening hand the other application a read-only copy, also for an entry of a ZIP, and refuse a file that could run as a program.
- `core/fs/guard.ts` (`resolveInside`): a path that leaves a root by `..`, an absolute path, a drive, a backslash, a NUL or a symbolic link is refused; the interface never sends an absolute path (`docs/ARCHITECTURE.md`, "Safety rules").
- The desktop file of the Linux packages also lists `application/zip` and `inode/directory`.

### Fixed

- Five end-to-end specs inherited from WSNP Viewer that had gone stale (the language of a file is named twice on screen, and Markdown opens formatted); the same fix is in wsnp-viewer (branch `fix-stale-e2e-specs`). No change to the application.

### Changed

- A ZIP that is not a PageKeep ZIP opens to be browsed, instead of being refused as a `.wsnp`. The side bar is called **Explorer**.
- Names: the app is **Folder Browser** (`folder-browser`, appId `io.github.asantos43.folder-browser`); the interface scheme is `fb-ui://`, the preload exposes `window.fb` and the IPC channels start with `fb:`. The `.wsnp` format, its `wsnp://` scheme for snapshots and the file association are unchanged.
- `scripts/format-sync.mjs` now checks the copies of `docs/FORMAT.md` and `docs/MANIFEST-SIGNING.md` against wsnp-viewer's (the source of truth), not against PageKeep.

### Removed

- The phase 0 prototype (`prototype/`, `electron/prototype-runner.ts`, `npm run prototype`, its CI steps and `e2e/prototype.spec.ts`); `startProbeServer` moved to `e2e/probe-server.ts`.
