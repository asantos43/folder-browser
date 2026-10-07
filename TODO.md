# TODO

This file is the **index** of the plan: the rule on performance, the **roadmap** (what to do first, by priority) and where each area lives. The open work is written **by area of the application** in [`docs/todo/`](docs/todo/) (one file per area, so that a session reads only the area it works on); what was delivered is the history in [`docs/todo/history.md`](docs/todo/history.md). Each piece of work is developed on its own branch and delivered as its own pull request (see `CONTRIBUTING.md`). Check a box when the code, its tests, its `CHANGELOG.md` lines and its docs are merged, and when a piece of work is done move its line down to the history. To count what is open: `grep -c "^- \[ \]" docs/todo/*.md`.

## The rule for every new feature: performance is a priority, not a polish
Any piece of work that **writes code** treats performance as a requirement of the design, on a level with the safety rules (which do not change), and not as something to tidy at the end. It is part of the definition of done:
- **A budget before the code.** The TODO item (or the pull request, if the item has none) says what is measured and the limit: the time to the first result and to the last, the frames of the interface that must not be lost, the memory, and the size of the input it must be fast on (a folder of 100,000 files, a text of 5 MB, a log of 32 MB, a file of several GB, a PDF of 1,000 pages, a picture of 50 megapixels, a playlist of 50,000 tracks). A feature with no number has no way to be called slow.
- **The habits that keep it fast**: never block the interface's thread (heavy work in a worker or in the main process, asynchronous, in slices that yield); **stream** and read by ranges, never a whole big file; **draw only what is in view** (a virtual list for any list that can be long); **batch** the calls between the processes (one call for many items, never one per row) and **throttle** the updates (a few a second, not one per event); **cancel** work that is no longer wanted (a tab closed, a query changed) and bound what is left running (a limit on memory, caches by version with a size limit, a limit on how many things run at once); **compute on demand** and keep the result until its source changes; keep a pointer move or a key press **out of React's state** when it fires at a high rate.
- **The cost of arriving**: a heavy library or a WebAssembly file is loaded the first time it is needed (as pdf.js is), the **start of the application and the time to the first window do not get slower**, and a new dependency or binary says what it adds to the installer (its size, per system) and why it is worth it. Nothing polls or keeps a timer running when nothing is shown.
- **Measured, then kept**: the budget is a **test that fails** when it is exceeded (an end-to-end spec on a real Chromium for the interface and its frames, a unit test for the pure parts) on a large synthetic input from `fixtures/`; the pull request writes down the numbers it measured (and, for a change to something that exists, before and after). A thing that cannot meet its budget on a very large input gets a **limit with a message in plain words** (as the editor does at 5 MB), never a freeze.
- A new TODO item that will need code has a **Performance** line (as the image editor, the PDF, the playlists and the search folders have); an item without one is incomplete.

## Roadmap: what to do first (a recommendation, to be changed freely)
Priority is **value for the user** against **cost and risk** (S: days; M: a week or two; L: weeks or a project of its own; every item still follows the performance rule above). A line names the section of this file where the work is written down. **Now** is what makes what exists safer and surer; **Next** is the best value for the effort; **Later** are the big projects, in an order that can change; **Maybe** waits for a reason.

**Now**
1. **Try the `.exe` and the `.dmg` on Windows and macOS** and write the manual checklist (S, "Quality of the product"): the biggest risk, nobody has used the application there
2. **Local History** (M, "Safety net"): the application writes over originals more and more (PDF, pictures, ZIP): a way back must exist before those features do
3. **The tree follows the disk** (M, "Safety net"): files that change or appear from outside show up; the search folders and "changed on disk" need it
4. **Text tools, group 1** (S to M, "Text tools"): case, lines, whitespace, line endings: most of what was asked, pure functions
5. **Checksums** in Properties (S, "Tools for files") and the **warning for audio that cannot play** (S, "Video", group 1): small, they end a gap
6. **Reviews in the process** (S, "Development process"): the security scan and the PR review plugins are installed; use them on pull requests, **only when the user asks** (the weekly limit: see "Light use" in `CLAUDE.md`)
7. **Settings framework** (M, "Settings"): a registry the page is made from, a file the application owns, JSON, export and import, and the first options: it makes every option after it cheap

**Next**
- **The three scenarios and the distribution channels** (S to M, "Positioning, distribution and adoption"): signed apt and dnf repositories, winget, Flathub and Homebrew, signing, a site, a first-run tour, shell integration and a command line: what gets people to the application
- **File safety triage** (M, "Safety and privacy tools") and **Share Safely** (M, after the first metadata work), **Inspect Only mode and the activity log** (S to M)
- **Compare two folders** and **large text diffs** with a patch export (M and S, "Compare more than text"; code to port from `mdiff`)
- **SQLite viewer** (S to M, "Data files"): the SQL worker is already there
- **Sizes and counts of folders** (S to M, "Sizes and counts of folders") and **metadata of media in Properties**, images and sound first (M, "Metadata of media files in Properties"), with the **EXIF panel to read** (M, "Images") before the editor
- **PDF**: bookmarks, thumbnails, links, then forms (M, "PDFs", reading and forms)
- **Compress and Extract for ZIP** (M, "Archives", group 1)
- **Find and Replace** (M, "Text tools", group 2) and **Search folders**, names and extensions (M, "Search folders", group 1)
- **Playlists** M3U/M3U8, reading and playing, then editing (M to L, "Playlists", groups 1 and 2)
- **Copy the path and Open in Terminal** (S, "Copy the path, and open a shell on a folder")
- **HTML: switch between source and preview** in the editor (M, "HTML: a switch between the text and its preview")
- **Accessibility pass** (M), **opt-in update check** (S), a **fuzzing harness** for the parsers (M), **drag files out** (S), **named workspaces** (S) ("Quality of the product", "Browsing")

**Later** (each a project; the order is a guess)
- **The distribution channel of extensions** as a real, operated service (M, "Extensions", phase 2b)
- **Redaction that really removes**, **repair of damaged files**, **comparing pictures, PDFs and structured data**, **portable mode** (L, M, M and S)
- **Extension-first** (a rule for every complex item below: see "Extension-first", tags `[core]`/`[ext L0-L2]`)
- **Extensions** (plugins), **all levels**: the package, side load and level 0, then the signed online catalog, then code in a box, then extensions that run as a process, off by default (L, "Extensions", `docs/EXTENSIONS-DESIGN.md`); after the registries of Settings, commands and keys exist
- **Image editor**, phase A and B, with EXIF editing in place and the Save options (L, "Images")
- **PDF** annotations, pages (select, rotate, delete, reorder) and merge (L, "PDFs")
- **tar and tar.gz** (M to L), then **7z** (L, "Archives", groups 2 and 3)
- **Search folders**, content, and Find in Files and Replace in Files (L, "Search folders" group 2 and "Text tools" group 5)
- **Gallery view** and slideshow (M to L, "Browsing"), **Quick Look** (S to M), **duplicates finder** (M), **bulk rename** (M), **disk usage map** (M) ("Tools for files")
- **Git, read only** (M, "Git"), **JSON, YAML and XML tools** (S to M, "Data files")
- **Video**, player of our own with tracks, subtitles and chapters (L, "Video", group 2); Text tools groups 3 and 4 (M)
- **More languages** with a translation flow (S, then continuing)

**Maybe**
- Tags and colour labels on files (M), `ffmpeg` of the computer for what the browser cannot play and a WebAssembly audio decoder (L, "Video", group 3), clone document, map of the document, function list, macros (Text tools, group 6), a tag editor for sound (not planned today)

## Where the open work is, by area
Section names used in the roadmap and in the texts (for example "Settings", "Text tools", "Search folders") are the headings of these files.

| File | What is in it |
| --- | --- |
| [`interface.md`](docs/todo/interface.md) | the interface and workbench, browsing (gallery, quick look, drag out, workspaces), quality of the product (platforms, accessibility, languages, updates, fuzzing), the development process (reviews, light use) |
| [`settings.md`](docs/todo/settings.md) | Settings: the framework and the options |
| [`files.md`](docs/todo/files.md) | files, folders and places; copy path and open a shell; sizes and counts; the safety net (local history, a tree that follows the disk); tools for files (checksums, duplicates, bulk rename, disk usage) |
| [`media-metadata.md`](docs/todo/media-metadata.md) | metadata of media files in Properties |
| [`search-git.md`](docs/todo/search-git.md) | search folders (find by name, extension and content, kept as a folder); Git, read only |
| [`extensions.md`](docs/todo/extensions.md) | extensions (plugins): the safe system, side load, the online catalog, settings of an extension, the authoring guide (design: [`docs/EXTENSIONS-DESIGN.md`](docs/EXTENSIONS-DESIGN.md)) |
| [`extension-first.md`](docs/todo/extension-first.md) | building the complex items on the extension model, and which item is core or an extension |
| [`text.md`](docs/todo/text.md) | text editing, tables and diff; HTML preview; data files (SQLite, JSON, YAML, XML) |
| [`text-tools.md`](docs/todo/text-tools.md) | text tools from Notepad++: case, lines, indentation, find and replace, cursors |
| [`archives.md`](docs/todo/archives.md) | ZIP files; compress, extract, tar, tar.gz, 7z |
| [`images.md`](docs/todo/images.md) | viewing and a simple image editor; EXIF; quality of the formats |
| [`pdf.md`](docs/todo/pdf.md) | PDFs: bookmarks, links, forms, annotations, pages, merge |
| [`media.md`](docs/todo/media.md) | snapshots; media, documents and binary files; video (tracks, subtitles, chapters); playlists |
| [`positioning.md`](docs/todo/positioning.md) | positioning, the three scenarios to show, distribution channels (repositories, Flathub, Homebrew, winget…), code signing, a site, a first-run tour, shell integration and a command line, portable mode |
| [`safety.md`](docs/todo/safety.md) | safety and privacy tools: file safety triage, Share Safely (hidden data), real redaction, Inspect Only mode and an activity log, repair of damaged files |
| [`compare.md`](docs/todo/compare.md) | comparing more than text: folders, pictures, PDFs, archives, structured data, three-way |
| [`release.md`](docs/todo/release.md) | packaging, platforms and the release; ideas for later |
| [`history.md`](docs/todo/history.md) | what was delivered, by phase |
