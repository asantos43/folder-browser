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
- **Places and favourites** (phase 1d): a **Places** section at the top of the side bar with Home, Desktop, Documents, Downloads, Music, Pictures, Videos, Trash and Computer (the ones this computer has; `core/places.ts`), the **Favorites** the user pinned (from a folder's menu, or by dragging a folder of the tree onto them; moved up and down, removed; `core/favorites.ts`), the **Recent Folders** (cleared from their menu) and the mounted **Devices** (`/run/media`, `/media`, `/mnt`, `/Volumes`, the drives of Windows). A click opens the folder as the root of the tree.
- **The trash opens as a folder** (`core/trash.ts`): on Linux (the freedesktop trash, with its `.trashinfo` records) and macOS; its items are put back where they were with **Restore** (never over something that is there now) and **Empty Trash** deletes them for good after asking (`ConfirmDialog`, reusable for the deletes of phase 2). On Windows the row opens the system's Recycle Bin.
- **Videos and sounds play in a tab** (phase 1e): a media file of a folder or a ZIP (mp4, m4v, webm, ogv, mkv, mov, mp3, m4a, aac, ogg, opus, wav, flac…) opens in the browser's own player, served by ranges (so it can seek) from the main process as `fb-media://<token>/` (`core/media.ts`; the interface never names a path, a token lives as long as its tab). Previous and Next go through the media files of the folder, a sound that ends goes on to the next (unless Repeat is on), the system's media keys work, and a player goes on playing when another tab comes to the front. An entry of a ZIP is played from a copy in a folder of its own (up to 2 GB), removed when the tab closes. What the browser cannot decode (HEVC…) is said in words, with Open With… and Save As. The right-click menu says Play.
- **A snapshot's video and sound play too**: a media file of a `.wsnp`, or of a ZIP in it, opens in the player (by the type its manifest declares), from a copy made for the tab; a link to it in the page opens a tab. (WSNP Viewer only offers such files with Save As.)
- `core/fs/guard.ts` (`resolveInside`): a path that leaves a root by `..`, an absolute path, a drive, a backslash, a NUL or a symbolic link is refused; the interface never sends an absolute path (`docs/ARCHITECTURE.md`, "Safety rules").
- The desktop file of the Linux packages also lists `application/zip` and `inode/directory`.

### Fixed

- Five end-to-end specs inherited from WSNP Viewer that had gone stale (the language of a file is named twice on screen, and Markdown opens formatted); the same fix is in wsnp-viewer (branch `fix-stale-e2e-specs`). No change to the application.

### Fixed

- Inherited from WSNP Viewer, and fixed there too (branch `fix-icon-sizes-and-list-markers`): the sizes given to icons (`text-[24px]`, `text-[96px]`…) were ignored, because the icon font's own 16 px was an unlayered rule that beats the layers of Tailwind (the activity bar, the big icon of a file that cannot be shown, the dialogs); the font is now imported in the `components` layer. The lists of a Markdown page had no bullets or numbers (the base styles took them away). A unit test that looked at the editor before it had its text.
- The side bar: the heading of the first group of Places repeated the section's, the path in the status bar wrapped and was cut, Information and Integrity (of a snapshot) showed for a folder, and the empty Open Folders and Open Snapshots took a third of the height.
- The tree of a folder read its folders again (and took its rows away for a moment) every time the side bar was drawn again, which was at every change of tab: a double click that straddled one missed its row, so it did not keep the tab. It now reads only when asked.

### Changed

- A ZIP that is not a PageKeep ZIP opens to be browsed, instead of being refused as a `.wsnp`. The side bar is called **Explorer**.
- Names: the app is **Folder Browser** (`folder-browser`, appId `io.github.asantos43.folder-browser`); the interface scheme is `fb-ui://`, the preload exposes `window.fb` and the IPC channels start with `fb:`. The `.wsnp` format, its `wsnp://` scheme for snapshots and the file association are unchanged.
- `scripts/format-sync.mjs` now checks the copies of `docs/FORMAT.md` and `docs/MANIFEST-SIGNING.md` against wsnp-viewer's (the source of truth), not against PageKeep.

### Removed

- The phase 0 prototype (`prototype/`, `electron/prototype-runner.ts`, `npm run prototype`, its CI steps and `e2e/prototype.spec.ts`); `startProbeServer` moved to `e2e/probe-server.ts`.
