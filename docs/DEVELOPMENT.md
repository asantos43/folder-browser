# Development

## Prerequisites

- Node.js 22 or newer and npm.
- On Linux, to run the Electron app in a container or on a server, a virtual display (`xvfb-run`) and the
  `--no-sandbox` argument (Chromium's sandbox helper cannot be set up there). A normal desktop needs neither.
- To build the Linux packages locally: `rpm` (for `.rpm`) and, on Fedora, `libxcrypt-compat` (a library the
  packaging tool needs; without installing it: `dnf download libxcrypt-compat`, unpack the x86_64 rpm with `rpm2cpio | cpio -idm` in a scratch folder and run the packaging with `LD_LIBRARY_PATH=<folder>/usr/lib64`). The CI builds them on Ubuntu.

```sh
npm ci
```

## Layout

```
electron/     the main process: main.ts (starts the app), window.ts (the frameless window and its session), ui-protocol.ts (serves the
              interface), preload.ts, menu.ts (macOS), snapshot-host.ts (the IPC and what the interface asks of the files), snapshot-view.ts (the wsnp://
              protocol), doc-protocol.ts (the fb-doc:// page of an office document), open-with.ts, print.ts, places-ipc.ts
src/          the interface (renderer): React, Tailwind; theme/ (tokens), i18n/, components/, workbench/ (title bar, activity bar, side bar, the tree, editor group,
              status bar), views/ (what a tab shows), find/, state/ (the reducer of tabs and the settings), docs/ (the scripts that draw office documents: built
              by vite.docs.config.ts, run in a sandboxed frame, never by the interface)
core/         plain TypeScript with no Electron imports: archive/ (ZIP reader and writer), roots.ts (the folders and ZIPs opened), fs/ (guard, names, ops, sort, hidden),
              filekind.ts, hex.ts, csv.ts, docs.ts, media.ts, places.ts, trash.ts, serve.ts
fixtures/     builders of synthetic .wsnp files and PageKeep ZIPs (build.ts, with pictures and PDFs for the viewers; pdf.ts makes a valid PDF), and of files to refuse or flag (hostile.ts), used by the tests
e2e/          end-to-end tests (Playwright driving the Electron app)
docs/         the specification, guidelines, architecture and this guide
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run app` | Builds everything and starts the app |
| `npm run build` | `build:ui` (the interface, Vite, into `dist/`), `build:docs` (the scripts that draw office documents, into `dist/docs/`: one per library, `vite.docs.config.ts`) and `build:electron` (the main process and the preload, into `dist-electron/`) |
| `npm test` | Unit and component tests (vitest): `core/`, `electron/`, `src/`, `scripts/` |
| `npm run test:e2e` | Builds, then runs the Playwright tests against the real Electron app (each launch has its own `--user-data-dir`) |
| `npm run notices` / `npm run notices:check` | Writes `THIRD-PARTY-NOTICES.md` (the licences of the libraries bundled into the application, with their texts, and what Electron ships) / fails when it is out of date; CI runs the check. Run `npm run notices` after changing a dependency that the application imports (the list is `ROOTS` in `scripts/third-party-notices.mjs`). The installers carry the file and the About window shows it |
| `npm run lint` | oxlint |
| `npm run typecheck` | `tsc` with no output |
| `npm run package:smoke` | Opens what `release/` holds with the tool of the system (`dpkg-deb`, `rpm`) and checks the menu entry, the `.wsnp` file type (by name and by the first entry of the ZIP), the icon and the install script; starts the unpacked application with `--app-version` and compares the version. Run by CI after the packages are built |
| `npm run package:linux` / `package:win` / `package:mac` | Builds the release files into `release/` (unsigned) |
| `node scripts/release-local.mjs [--targets=linux,win] [--publish]` | The checks, then the release files built **in a container** (only Docker is needed), their smoke test and `SHA256SUMS.txt`; with `--publish`, the GitHub release (`docs/RELEASING.md`) |

## Environment variables for the tests

`WSNP_PRINT_TO=FILE` (for the end-to-end tests only) makes **Print** write a PDF of what would be printed to `FILE` instead of opening the system's print dialog, which a test cannot answer.

`WSNP_OPEN_WITH_LOG=FILE` (end-to-end tests only) makes **Open With…** append the path of the copy it would have handed over to `FILE`, instead of asking the system for an application.

`WSNP_DEBUG=1` prints progress lines to stderr.

The end-to-end specs that delete files give the app a trash of its own with `XDG_DATA_HOME`, and the ones that need a home (`e2e/places.spec.ts`) a made-up `HOME`: never run them against your own.

A hidden window that is not rendered offscreen never paints, so anything that photographs a page must use `offscreen: true` (see `SnapshotViewOptions`).

## Tests

- **Unit** tests are `*.test.ts` next to the code and use synthetic files from `fixtures/`. **Component** tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line.
- **End-to-end** tests (`e2e/`) start the real Electron app with Playwright, each launch with its own `--user-data-dir`.
- Hostile inputs (ZIP64, encryption, unsafe names, wrong sizes) are covered in `core/archive/reader.test.ts`; hostile paths and links for the file operations in `core/fs/ops.test.ts`; the sandboxed frame of a document in `e2e/documents.spec.ts`.
- The specs open windows: leave the computer alone while they run, and run the whole suite in the background with its output in a file (a spec that fails once may pass alone: a click while the window lacks focus; do not "fix" the pointer tests of `zoom.spec.ts`).
- The synthetic office documents of the tests are written by hand in `fixtures/office.ts`; no real file from a private site enters the repository.
