# Folder Browser

<img src="build/icon.png" alt="Folder Browser icon: a folder closed by a zipper, with a page, a pencil, a play button and a lens" width="96" align="right">

A desktop app to **browse folders and ZIP files**, change what is in them, and read **WSNP** snapshots. Pick a folder or a `.zip`, see its files
(hidden ones on request), create, rename, move, delete and **edit** text files (HTML, TXT, JSON, source code…) in the folder or **inside the ZIP**, put
two text files side by side in a **diff**, and open `.wsnp` files (web pages saved for offline reading) exactly as
[WSNP Viewer](https://github.com/asantos43/wsnp-viewer) shows them.

It runs on Linux, Windows and macOS, is built with Electron and TypeScript, and looks and behaves like Visual Studio Code's Dark+ and Light+. English and
Brazilian Portuguese, following the system language. [Português do Brasil](README.pt-BR.md).

![Folder Browser: the folder tree on the left, a file in a tab on the right](docs/images/workbench.png)

The [user guide](docs/USER-GUIDE.md) shows each feature, with pictures, and how to use it; it is also inside the application: **Help ▸ User Guide** (`F1`), in English or Portuguese, with no network.

> **Status: first release (0.1.0).** Browsing folders and ZIP files, the tree with several rows marked, Cut/Copy/Paste, editing text (also inside a ZIP), tables, diff, two editor groups,
> media, office documents, the hex view and `.wsnp` snapshots work; what is left is in [`TODO.md`](TODO.md).

## What it does

| | |
| --- | --- |
| **Places** | A side bar with **Home, Documents, Downloads, Music, Pictures, Videos, Desktop, Trash**, your **recent folders** and **favourite folders** (drag a folder to pin it). |
| **Browse** | A tree of folders and ZIP files (a ZIP opens like a folder, even inside another ZIP), with a switch to **show hidden files** (`Ctrl+H`). |
| **Change** | Create, **rename** (`F2`), move (a folder picker, or drag and drop) and delete files and folders of a folder you opened; delete goes to the trash, and nothing is ever replaced. The same inside a ZIP file (also a ZIP in a ZIP), which is written back whole and safely; there delete is for good, since a ZIP has no trash. |
| **Edit** | Text files (HTML, TXT, JSON, Markdown, source code…) open in an editor with syntax colours; `Ctrl+S` saves the file whole and safely (a temporary file renamed over it, line endings kept, and a question if it changed on disk meanwhile); a tab with changes shows a dot and asks before it closes. What you typed and did not save is kept for the next start. A text file **inside a ZIP** is edited and saved the same way: the ZIP is rewritten and the entries you did not touch are copied as they were. |
| **Documents** | Word, PowerPoint, LibreOffice and Excel files (`.docx`, `.pptx`, `.odt`, `.ods`, `.odp`, `.xlsx`, `.xls`…) are drawn in a tab, in a frame that has no network; CSV and TSV open as a table that you can sort, filter, search, ask in SQL (`SELECT`, run by SQLite in a worker) and **edit cell by cell**. |
| **Hex** | Programs, libraries and any file of bytes (`.exe`, `.dll`, `.so`, `.bin`, `.iso`…) open as offset, hexadecimal and text, with selection, copy, Go to offset and Find for bytes or text; the header says what the file is (ELF, PE, Mach-O, ZIP…) without running it. **Edit** changes the bytes (hex digits or text, Insert, Delete, undo) and saves them like text. |
| **Play** | Videos and sounds play in a tab (mp4, webm, mp3, flac, wav…), with seek, volume, speed and Next/Previous in the folder, also from a ZIP. |
| **Compare** | **Select for Compare** and **Compare with Selected** in the tree's menu put two text files (disk or ZIP) in a **diff** tab, side by side or in one column, with syntax colours, the changes counted and F7 to step through them. |
| **New text** | **File ▸ New Text File** (`Ctrl+N`) opens an empty tab that exists only in the window: paste a piece of text in it, then compare it with a file (**Select for Compare** in the tab's menu) or put it beside one (**Split Right**). |
| **Right click** | A menu by kind of file (text, picture, PDF, ZIP, `.wsnp`, folder), and **Open With…** on every file, with the applications installed on the computer. |
| **WSNP** | `.wsnp` files open as snapshots, isolated, checked (SHA-256, signature) and with no network, as in WSNP Viewer. They are read-only. |

Nothing leaves the computer: no account, no analytics, no network use except a web link you click.

## Install

Release files are on the [Releases page](https://github.com/asantos43/folder-browser/releases). They are **not signed**, so the first launch
shows a warning on Windows and macOS (Windows: **More info ▸ Run anyway**; macOS: right-click the app ▸ **Open**, or allow it in **System Settings ▸ Privacy & Security**).

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
| [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) ([pt-BR](docs/USER-GUIDE.pt-BR.md)) | Using the app, every feature, with pictures |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md), [`docs/RELEASING.md`](docs/RELEASING.md) | Setting up, testing, making a release |
| [`wsnp-format/FORMAT.md`](https://github.com/asantos43/wsnp-format/blob/main/FORMAT.md), [`wsnp-format/MANIFEST-SIGNING.md`](https://github.com/asantos43/wsnp-format/blob/main/MANIFEST-SIGNING.md), [`docs/PAGEKEEP-ZIP.md`](docs/PAGEKEEP-ZIP.md), [`docs/VIEWER-GUIDELINES.md`](docs/VIEWER-GUIDELINES.md) | The WSNP format and what a viewer must do (copied from WSNP Viewer) |
| [`docs/UI-DESIGN.md`](docs/UI-DESIGN.md) | The VS Code-style interface |
| [`docs/WSNP-VIEWER-ARCHITECTURE.md`](docs/WSNP-VIEWER-ARCHITECTURE.md), [`docs/WSNP-VIEWER-HISTORY.md`](docs/WSNP-VIEWER-HISTORY.md) | What was inherited from WSNP Viewer 0.1.0 |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | The libraries inside the application and their licences |

The interface is *inspired by* Visual Studio Code. Folder Browser is not Visual Studio Code, and is not endorsed by Microsoft.

## Licence

[Mozilla Public License 2.0](LICENSE) (MPL-2.0).
