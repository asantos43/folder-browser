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

## Code graph (optional, for the maintainer's sessions)

`codebase-memory-mcp` indexes the repository into a graph (functions, classes, calls, imports) so that an agent can ask "who calls this" or "the outline of this file" without reading whole files. It is **not** a dependency of the project and nothing in the repository refers to it at run time.

How it was installed (2026-10-07, release v0.11.0, Linux x86-64), **without** the project's `curl | bash` installer (that one edits the configuration of up to 45 programs):

1. Download `codebase-memory-mcp-linux-amd64.tar.gz`, `checksums.txt` and the two `.bundle` files from the GitHub release into an empty folder.
2. Check the **SHA-256** against `checksums.txt`, and the **Sigstore signature** of the archive and of `checksums.txt` with `cosign verify-blob <file> --bundle <file>.bundle --certificate-identity https://github.com/DeusData/codebase-memory-mcp/.github/workflows/release.yml@refs/heads/main --certificate-oidc-issuer https://token.actions.githubusercontent.com` (`brew install cosign`). The signature proves that the project's own release workflow built the file; it does not prove the code is harmless.
3. Copy only the binary to `~/.local/bin/` (do not run its `install` command).
4. `codebase-memory-mcp config set ui_enabled false` (the graph viewer is a local web page on port 9749: off).
5. `claude mcp add codebase-memory-mcp --scope local -- ~/.local/bin/codebase-memory-mcp --tool-profile=analysis` (this project only, read-only tools: 13 of the 17, about 3,600 tokens of descriptions; `scout` has 8 tools and about 2,200).
6. `codebase-memory-mcp cli index_repository --repo-path <this folder>` (about 6 seconds for this repository: about 3,750 nodes and 16,000 edges; it skips `.git`, `node_modules`, `dist` and `dist-electron`).

To remove it: `claude mcp remove codebase-memory-mcp --scope local`, delete `~/.local/bin/codebase-memory-mcp` and `~/.cache/codebase-memory-mcp/`. To update, repeat steps 1 to 3 with the new release and check it the same way.

## rtk (optional, for the maintainer's sessions)

`rtk` (Rust Token Killer, `rtk-ai/rtk`, Apache-2.0) is a command-line proxy that shortens the output of build, test and git commands before it reaches a coding agent. Installed on 2026-10-07 with `brew install rtk` (the Homebrew-core formula, a bottle checked by Homebrew; 0.51.0); not a dependency of the project.

- **Telemetry**: off (`rtk telemetry status` says consent was never asked and this build has no telemetry endpoint); it needs an explicit opt-in.
- **The hook is not installed.** `rtk init -g` would patch `~/.claude/settings.json` so that every Bash command of every project is rewritten to `rtk …`; `rtk init` without `-g` only adds instructions to `CLAUDE.md` and a `.rtk/filters.toml`, and installs no hook. Neither was run.
- **Measured here** (native output against `rtk`, in bytes): `git log --oneline -5` 493 against 441; `gh pr list` 1,030 against 762; `ls -la docs` 1,059 against 381 (**lossy**: permissions and dates are dropped); `git status --short`, `grep`, `git diff --stat`, `vitest` of one file and `npm run lint` about the same, because those commands are already short. The saving is real for long, noisy output (a failing build, a long test run), small for the rest.
- **Use by hand** for long output: `rtk err <cmd>`, `rtk test <cmd>`, `rtk playwright test …`, `rtk vitest …`, `rtk tsc`; the part it elided comes back with `rtk recall <hash>`, and `rtk proxy <cmd>` runs a command unfiltered. `rtk gain` shows what was saved.
- **To enable the hook later**: preview with `rtk init -g --hook-only --dry-run`, then `rtk init -g --hook-only`; to remove it: `rtk init -g --uninstall`. To uninstall the program: `brew uninstall rtk`.

