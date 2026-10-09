# TODO: Extension-first

Part of the plan in [`TODO.md`](../../TODO.md) (the index, the performance rule and the roadmap). Open work of this area; what was delivered is in [`history.md`](history.md).

## Extension-first: building the complex items of this file on the extension model (after 0.1.3; priority: a rule for every item below)
Decided in principle: the complex features of this file are built **as extensions** when they fit (see `docs/EXTENSIONS-DESIGN.md`, section 9), because it keeps the core small and fast, isolates the riskiest parsers in a box, keeps a dependency with another licence out of the core, lets a feature be installed, disabled or revoked without a release, and proves the API by real use. **The near-term items do not wait for the system**: until the extension points exist each is written **extension-shaped** (its own `extensions/<id>/` folder with a `plugin.json` that already names its level and permissions, code that reaches the application only through an **internal host interface shaped like the future broker**, its dependencies and data its own, tests against a **fake host**), so moving it into the box is a build step, not a rewrite.
> **Updated 2026-10-09:** the trust model changed (`docs/EXTENSIONS-DESIGN.md`, section 0): there are now **two levels only**, **level 0** (data) and **level 1** (code in a process separate from the main one, with full power, no sandbox). Read `[ext L2]` below as `[ext L1]`; "in a box" and "restricted" no longer apply (stability, not confinement). The core keeps the basics; PDF page manipulation, image editing and EXIF, tar and 7z, playlists and the file-intelligence packs are extensions; the first one to prove the API is "PDF: rotate, delete and reorder pages".

- [ ] **The decision for each new complex item** is made in its first pull request and written in its TODO line with a tag: **`[core]`**, **`[ext L0]`** or **`[ext L1]`**. *Core* when it is a security boundary (roots, safe writes, the broker), a safety net (Local History), the performance-critical interface (tree, tabs, editors, hex view) or a foundation (settings, commands, keys). *Extension* when it is a reader, writer, codec, viewer, tool or panel that can work through the broker, pulls a heavy or differently-licensed dependency, or is not needed on the first run
- [ ] **First-party extensions are signed by the project** and are either **Built in** (inside the installer, enabled by default, can be turned off; for what nearly everyone needs) or **Official** (an entry of the catalog, installed on demand; for what is large or rare); the same page, the same permissions screen, the same revocation
- [ ] **A point is added to the API only when a first-party extension needs it** (the API grows from use, not from guesses), each with its example in the guide
- [ ] Where a built-in feature moves into the box, it does **not** lose its tests or its budget: the same specs run against the extension

How the items of this file map (the tag is a recommendation, to be confirmed when each item starts)
| Item | Tag | Why |
| --- | --- | --- |
| First-party extensions' own options (the 7z engine's threads, the text tools' sort locale, the subtitles' size) | `[ext]` with `contributes.configuration` | the first users of extension settings, so the declaration is proved |
| Settings, commands, keys, themes, translations (the foundations) | `[core]` / `[ext L0]` for the contributed data | the base the system stands on; a theme, a key scheme and a language pack are data |
| Notepad++ key scheme, more themes, more languages | `[ext L0]` | pure data |
| Open in Terminal, custom Open With commands | `[core]` for the runner, entries `[ext L0]` | the application starts the program, the entry is data |
| Text tools (case, sort, trim, join…) | `[ext L1]`, the **first built through the extension point** | pure functions on text |
| Find and Replace, Find in Files engine | `[core]` for the bar and the safety, the **search engine `[ext L2]`** if `ripgrep` is chosen (a helper program per system) | a helper binary is exactly what level 2 is for |
| tar, tar.gz readers | `[core]` (the neutral archive layer) with `[ext L1]` readers | small, but the layer must be neutral |
| **7z, bz2, xz, zstd, RAR (read)** | **`[ext L1]` (WebAssembly) or `[ext L2]` (the 7-Zip program)**, Official | LGPL and size stay out of the core; the riskiest parser runs boxed |
| Image editor | `[core]` (the canvas, the history, the safe save) | performance-critical interface |
| BMP, GIF, ICO writers; AVIF, TIFF, HEIC decoders; mozjpeg and libwebp encoders | `[ext L1]` (WebAssembly or a worker) | codecs with heavy dependencies |
| Metadata readers: EXIF, ID3, MP4, Matroska; `mediainfo.js` | EXIF reader `[core]` (shared by the editor); the others `[ext L1]` | untrusted parsing belongs in a box |
| PDF reading, forms, annotations, pages | `[core]` (pdf.js is the viewer) | the viewer itself |
| Video player with tracks, subtitles, chapters | `[core]` (the player UI); **ASS renderer, AC3/DTS decoder, MKV demuxer `[ext L1]`**, the `ffmpeg` helper `[ext L2]` | the codecs and renderers are the heavy, risky, licence-bound parts |
| Playlists: M3U/M3U8 and the player | `[core]` | the player's own feature |
| Playlists: PLS, XSPF, WPL, ASX, CUE | `[ext L1]` | small readers of other formats |
| SQLite viewer; JSON, YAML, XML tools | `[ext L1]` (viewer frame, sql.js in WebAssembly) | a viewer for a file type |
| Git view (status marks, compare with HEAD, history) | `[ext L2]`, restricted: runs `git`, reads the open roots | needs a process; permissions enforced |
| Duplicates finder, bulk rename, disk usage map, checksums | `[ext L1]` (they need `files.read` and compute) | tools on selected files |
| Gallery view, Quick Look | `[core]` | performance-critical interface |
| Local History, live refresh of the tree, safe writes | `[core]` | safety net and foundation |
| Extensions manager, catalog client | `[core]` | it is the security boundary |
| Update check | `[core]` | opt-in and tiny |

- [ ] **A migration plan** per item that ships in-tree first: when its extension point is real the feature moves, with the same tests and budget, and the installer is measured before and after (the performance rule's "cost of arriving")
- [ ] **Decisions**: which first-party extensions are **Built in** and which **Official**; whether a built-in extension may be **uninstalled** or only disabled; whether level 2 first-party extensions (Git, the `7z` and `ffmpeg` helpers) are **bundled** at all or only Official; and whether the first extension point to build is the **text tools** (recommended: pure, small, high value)
