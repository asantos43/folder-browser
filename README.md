# Folder Browser

<img src="build/icon.png" alt="Folder Browser icon (a placeholder, taken from WSNP Viewer)" width="96" align="right">

A desktop app to **browse folders and ZIP files**, change what is in them, and read **WSNP** snapshots. Pick a folder or a `.zip`, see its files
(hidden ones on request), create, rename, move, delete and **edit** text files (HTML, TXT, JSON, source code…) in the folder or **inside the ZIP**, put
two text files side by side in a **diff**, and open `.wsnp` files (web pages saved for offline reading) exactly as
[WSNP Viewer](https://github.com/asantos43/wsnp-viewer) shows them.

It runs on Linux, Windows and macOS, is built with Electron and TypeScript, and looks and behaves like Visual Studio Code's Dark+ and Light+. English and
Brazilian Portuguese, following the system language. [Português do Brasil](README.pt-BR.md).

> **Status: under construction.** The project was started from WSNP Viewer 0.1.0, so the `.wsnp` viewer, the tabs, the file tree, the ZIP list, Find, Print and Open With…
> already work. Everything else below is planned, phase by phase: see [`TODO.md`](TODO.md).

## What it does

| | |
| --- | --- |
| **Places** | A side bar with **Home, Documents, Downloads, Music, Pictures, Videos, Desktop, Trash**, your **recent folders** and **favourite folders** (drag a folder to pin it). |
| **Browse** | A tree of folders and ZIP files (a ZIP opens like a folder, even inside another ZIP), with a switch to **show hidden files** (`Ctrl+H`). |
| **Change** | Create, **rename**, move and delete files and folders, on disk and inside a ZIP. Delete goes to the trash. |
| **Edit** | Text files (HTML, TXT, JSON, Markdown, source code…) open in an editor with syntax colours; `Ctrl+S` saves to the folder or back into the ZIP. |
| **Play** | Videos and sounds play in a tab (mp4, webm, mp3, flac, wav…), with seek, volume, speed and Next/Previous in the folder, also from a ZIP. |
| **Compare** | Select two text files (disk or ZIP) and see their **diff**, side by side or unified. |
| **Right click** | A menu by kind of file (text, picture, PDF, ZIP, `.wsnp`, folder), and **Open With…** on every file, with the applications installed on the computer. |
| **WSNP** | `.wsnp` files open as snapshots, isolated, checked (SHA-256, signature) and with no network, as in WSNP Viewer. They are read-only. |

Nothing leaves the computer: no account, no analytics, no network use except a web link you click.

## Install

Release files will be published on the [Releases page](https://github.com/asantos43/folder-browser/releases). They are **not signed**, so the first launch
shows a warning on Windows and macOS.

| System | File |
| --- | --- |
| Windows | `folder-browser-<version>-win-x64.exe` |
| macOS (Apple Silicon and Intel) | `folder-browser-<version>-mac-universal.dmg` |
| Debian, Ubuntu | `folder-browser-<version>-linux-amd64.deb` (`sudo apt install ./<file>`) |
| Fedora, Red Hat | `folder-browser-<version>-linux-x86_64.rpm` (`sudo dnf install ./<file>`) |

## Build from source

You need Node.js 22 or newer.

```sh
npm ci
npm run app            # builds and starts the application
npm test               # unit and component tests
npm run test:e2e       # the real application, driven by Playwright
npm run package:linux  # or package:win, package:mac: the release files, in release/
```

More in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md); how changes are made is in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Privacy and security

What is kept on your computer is in [`PRIVACY.md`](PRIVACY.md). Folder Browser **changes your files**, so it only touches the folders and ZIP files you opened,
sends deletions to the trash and writes through a temporary file; how hostile files are handled and how to report a vulnerability is in [`SECURITY.md`](SECURITY.md).

## Documentation

| | |
| --- | --- |
| [`TODO.md`](TODO.md) | The plan, phase by phase, and what is next |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed, by version |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the app is built, and its safety rules |
| [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) ([pt-BR](docs/USER-GUIDE.pt-BR.md)) | Using the app (so far: the WSNP part; the rest is written as it lands) |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md), [`docs/RELEASING.md`](docs/RELEASING.md) | Setting up, testing, making a release |
| [`docs/FORMAT.md`](docs/FORMAT.md), [`docs/MANIFEST-SIGNING.md`](docs/MANIFEST-SIGNING.md), [`docs/PAGEKEEP-ZIP.md`](docs/PAGEKEEP-ZIP.md), [`docs/VIEWER-GUIDELINES.md`](docs/VIEWER-GUIDELINES.md) | The WSNP format and what a viewer must do (copied from WSNP Viewer) |
| [`docs/UI-DESIGN.md`](docs/UI-DESIGN.md) | The VS Code-style interface |
| [`docs/WSNP-VIEWER-ARCHITECTURE.md`](docs/WSNP-VIEWER-ARCHITECTURE.md), [`docs/WSNP-VIEWER-HISTORY.md`](docs/WSNP-VIEWER-HISTORY.md) | What was inherited from WSNP Viewer 0.1.0 |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | The libraries inside the application and their licences |

The interface is *inspired by* Visual Studio Code. Folder Browser is not Visual Studio Code, and is not endorsed by Microsoft.

## Licence

MIT. See [`LICENSE`](LICENSE).
