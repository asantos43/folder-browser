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

### Changed

- Names: the app is **Folder Browser** (`folder-browser`, appId `io.github.asantos43.folder-browser`); the interface scheme is `fb-ui://`, the preload exposes `window.fb` and the IPC channels start with `fb:`. The `.wsnp` format, its `wsnp://` scheme for snapshots and the file association are unchanged.
- `scripts/format-sync.mjs` now checks the copies of `docs/FORMAT.md` and `docs/MANIFEST-SIGNING.md` against wsnp-viewer's (the source of truth), not against PageKeep.

### Removed

- The phase 0 prototype (`prototype/`, `electron/prototype-runner.ts`, `npm run prototype`, its CI steps and `e2e/prototype.spec.ts`); `startProbeServer` moved to `e2e/probe-server.ts`.
