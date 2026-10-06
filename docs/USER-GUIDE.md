# User guide

Folder Browser looks at the folders on your computer and at what is in them. It opens **folders and ZIP files** as trees, shows **text, pictures, PDFs, office documents, tables, videos, sounds and the bytes of any file**, and **makes, renames, moves and deletes** files and folders. It also opens **`.wsnp` files** (web pages saved by the [PageKeep](https://github.com/asantos43/webpage-snapshot) extension) as the pages they are. [Português do Brasil](USER-GUIDE.pt-BR.md).

Editing a file, comparing two files and changing what is inside a ZIP are not here yet (see the end).

## Opening a folder

- **File ▸ Open Folder…** (`Ctrl+Shift+O`, `⇧⌘O` on macOS), or **drag** a folder, a ZIP file or any file onto the window, or name one on the command line.
- A **ZIP file** opens as a folder, also a ZIP inside a ZIP. A file that you name on its own opens in a tab, with its folder opened beside it.
- **File ▸ Open File…** (`Ctrl+O`) asks for a file; the installers register `.wsnp` and `.zip` with the application, so a double click in the file manager works too.
- When the application starts with nothing to open it **opens again what was open** (the folders and the tabs, in the same order, with the same tab in front): **Settings ▸ Reopen the files that were open**; turn it off and nothing is kept.
- The folders open are listed in **Open Folders** in the side bar; the × next to one closes it and its tabs.

## The window

It is laid out like Visual Studio Code: a **title bar** with the menu, an **activity bar**, a **side bar**, **tabs** with the path under them, the file in the middle, and a **status bar**. `Ctrl+B` hides and shows the side bar; drag its edge to resize it.

- The **arrows** of the title bar are **Go Back** and **Go Forward** through the tabs you visited (`Alt+Left`, `Alt+Right`).
- The **box in the middle** is **Go to File** (`Ctrl+E`): part of a name finds a file of the open snapshots; with nothing typed it lists your tabs, the latest first. Type `>` (or press `Ctrl+Shift+P`) for the **command palette**, which has every command that can run now and the colour themes.

### The side bar

- **Places**: Home, Desktop, Documents, Downloads, Music, Pictures, Videos, **Trash**, Computer (the ones this computer has), the **Favorites** you pinned, the **Recent Folders** and the mounted **Devices**. A click opens that folder as the tree. Pin a folder with **Add to Favorites** in its menu, or drag a folder onto the Favorites; move them up and down, remove them from their own menu. **Clear Recent Folders** is in the menu of that list.
- **Files**: the folder you chose, as a tree that reads one level at a time (a folder of a hundred thousand files is not read until you open it). A **click** opens a **preview tab** (its name in italics) that the next click replaces; a **double click** or `Enter` **keeps** it. Arrow keys move, `→` and `←` open and close, and typing jumps to a name.
- The icons of the Files header: **New File…**, **New Folder…**, **Sort** (by name, date or size, up or down; folders stay first), **Show Hidden Files** (`Ctrl+H`) and **Refresh**. Each row shows the size and the date it changed, small and to the right: with little room the one the order is by, with a wide side bar both.
- **Hidden files** (a name that starts with a dot) are listed but shown only when you ask: the eye, **View ▸ Show Hidden Files** or **Settings**. The same goes for the entries of a ZIP.
- The **Trash** place opens your system's trash as a folder (Linux and macOS): **Restore** puts an item back where it was (never over something that is there now) and **Empty Trash** deletes them for good after asking. On Windows it opens the Recycle Bin.

### The right-click menu

The menu of a row depends on what it is. A folder: expand, refresh, **New File…**, **New Folder…**, **Rename**, **Move to…**, **Delete**, add to Favorites. A ZIP file: expand, **Open as List**. A `.wsnp`: **Open** (its page) or **Open as ZIP**. A file: **Open** (or **Play**). **For every file**: **Open as Hex**, **Open With…**, **Open with Default Application**, **Save As…**, **Show in File Manager**, **Copy Path**, **Copy Name**, **Properties**.

**Open With…** asks your system which application should open the file (Windows' dialog, macOS's chooser, and on Linux a dialog of the application's own, with the applications registered for the type first, then all the others, a search box and **Always use for this file type**). The application is given a **read-only copy** in your temporary folder, removed when the application quits. A kind of file that can run as a program (`.exe`, `.bat`, `.sh`, `.desktop`, `.jar`…) is never handed over: use **Save As…**.

## Making, renaming, moving and deleting

These work on the files and folders of a folder you opened (not yet inside a ZIP, nor in the Trash place).

- **New File…** and **New Folder…** (the icons of the Files header, the menu of a folder, or the empty part under the tree for the root) put a field in the tree: type the name and press `Enter` (`Esc` gives up). The new item is made where the focus is: in the folder that has it, or in the folder of the file that has it, or in the root.
- **Rename** (`F2`, or the menu) edits the name in its row, with the name without its extension selected. `Enter` renames; `Esc`, or leaving the field, gives up.
- **Move to…** opens a picker of the folders of the root; a folder is never offered itself or what is in it, nor the folder it is in. **Drag** a row onto a folder, or onto the empty part under the tree (the root) to move it there; a file dropped on a file goes to the folder that file is in.
- **Delete** (`Delete`, or the menu) asks, and moves the item to the **trash** (a folder with everything in it). Only if the trash cannot take it are you asked again, whether to delete it **permanently**, and that cannot be undone.
- **Nothing is ever replaced.** A name that is taken is refused, in words, and the field stays so you can type another. A name that no file can have (empty, `.` or `..`, with `/` or `\`, control characters, over 255 bytes; on Windows also `< > : " | ? *`, the names the system keeps such as `CON` or `NUL`, and a name ending in a space or a dot) is refused before anything is asked. A folder is never moved into itself. Nothing leaves the folder you opened: a symbolic link is renamed, moved or deleted as the link, never what it points to.
- The **tabs follow**: the tab of a renamed or moved file (or of a file in a renamed folder) keeps its place, its zoom and its preview, with the new name, and the tab of a deleted item closes.

## What a tab can show

| File | What you get |
| --- | --- |
| Source, text and data: HTML, CSS, JavaScript, TypeScript, JSON, XML, YAML, TOML, INI, `.env`, shell, SQL, Dockerfile, and source in Python, C, C++, C#, Java, Kotlin, Scala, Go, Rust, Swift, Dart, PHP, Ruby, Perl, Lua, R, Groovy, Haskell, Julia, Clojure, Erlang, Pascal, PowerShell, CMake, Diff, Protocol Buffers, SCSS, Sass, Less, plain text | Source with colours and line numbers, read-only. A minified or one-line HTML, CSS, JavaScript, JSON or XML file is shown **laid out**; the toolbar's **Format** button shows it as saved, and Save As always writes the file as it was saved. **Word Wrap** wraps long lines (`Alt+Z`). Both choices are kept and are in Settings too. Text over 5 MB is not opened in a tab; a **`.log`** opens up to 32 MB. |
| A file of a kind the application does not know | Shown as text when what it holds is text; otherwise as its bytes (hexadecimal). |
| Markdown (`.md`) | A **formatted page** (headings, lists, tables, code; a web link opens in your browser; a picture is not loaded and HTML inside is shown as text), with **Formatted / Text** buttons; **Full Width** and **Wrap Code**. |
| CSV and TSV | A **table**: the first row is the header and stays in view, the rows are numbered; the delimiter (comma, semicolon, tab, bar) is found by itself. Up to 5,000 rows and 200 columns, said when cut. **Table / Text** buttons switch to the source. |
| Pictures | The picture with a **toolbar**: zoom out and in, a box (Fit, Fit Width, Fit Page, 25 % to 400 %…), actual size, **Save As…**. `Ctrl` and the wheel zoom around the pointer. |
| SVG | A picture at first, with **Image / Code** buttons for the source. |
| PDFs | The pages with selectable text, a toolbar with the same zoom, previous and next page, a box to go to a page. Not yet: links and forms inside the PDF, and passwords. |
| Fonts | A sample at several sizes. |
| **Office documents**: Word (`.docx`), PowerPoint (`.pptx`), LibreOffice and OpenDocument (`.odt`, `.ods`, `.odp`, `.odg`), Excel (`.xlsx`, `.xls`), and the older `.doc` and `.ppt` | Drawn **as a page** by ready-made libraries (docx-preview, pptx-renderer and odr-core), in a frame that has no network and cannot reach the rest of the window, so a hostile file can at most draw itself badly. A workbook shows one sheet at a time, with a bar of sheet names. Up to 48 MB. Fonts the document asks for and the computer lacks are replaced, charts are approximate, and nothing animates. A file that cannot be drawn says why, with **Save As…** and **View as hex**. A drawn document is kept while you look at another tab. |
| **Bytes**: programs and libraries (`.exe`, `.dll`, `.so`, `.o`, `.class`, `.wasm`…), disk images, databases, and any file of an unknown type that is not text | **Hexadecimal view**: the offset, 16 bytes in hex (eight and eight) and the same bytes as text. Click a byte (`Shift`+click or the arrows to extend); `Ctrl+C` copies the bytes as hex (the toolbar also copies as text); **Go to offset** takes hex, `0x…` or `#decimal`; **Find** looks for bytes or text, forwards and backwards through the whole file (`Ctrl+F` goes to its box). The toolbar says what the header is (ELF, PE, Mach-O, Java class, ZIP, PDF, PNG, SQLite…) by reading it, never by running the file. A file of a folder of any size is read a window at a time. Any file can be opened this way: **Open as Hex** in the menu, or **View as hex** in the toolbar. |
| A video or a sound | **Played** in a tab with the browser's own player (play, seek, volume, speed, repeat, full screen for video, Previous and Next through the media of the folder; the system's media keys work; it goes on playing when another tab is in front). Also from a ZIP, and from a snapshot. What the browser cannot decode (HEVC…) is said, with **Open With…** and **Save As…**. |
| ZIP files | The **list of files** (see below). |
| A `.wsnp` | The **page it holds** (see below). |
| Anything else (a file that is too large) | A card with its name, type and size, and **Save As…**, **Open With…** and **View as hex**. |

**Open With…** and **View as hex** are in the toolbar of the document, the table, the bytes and every text, and on the cards.

## ZIP files

A ZIP file opens in the tree like a folder, and the entries open in tabs like files. **Open as List** shows its entries as a table of names, sizes, packed sizes and dates, where you can select (click, `Ctrl` and `Shift`, the boxes, `Ctrl+A`) and **Extract** to a folder: one file asks for a name, **Extract All…** writes everything, and a file that is already there is never overwritten (the new one is called `name (2)`). Nothing is written to disk until you extract. Names that could leave the folder you chose are never written, links are not followed, and an entry protected with a password is shown dimmed and skipped. A ZIP over 256 MB is only offered with Save As. ZIP64 and encrypted ZIPs are read-only.

## Zoom, Find, Copy and Print

- **Zoom** belongs to the **tab**, never to the whole application. `Ctrl+=`, `Ctrl+-` and `Ctrl+0` (`⌘` on macOS), or `Ctrl` and the wheel (also over a document or a page), zoom the page of a snapshot, a text, a table, a document and the rows of the hexadecimal view (25 % to 500 %). The **status bar** has **−**, the level (click it for 100 %) and **+**. A picture and a PDF keep their own zoom (the same keys step it). Each tab has its own; a closed tab forgets it.
- **Find** (`Ctrl+F`, **Edit ▸ Find**) works in every tab that has text: a source file (over the whole text), a table, a PDF, a document (in its frame; in a workbook, the sheet on screen), the metadata and the lists. The box says which match of how many; `Enter` and `Shift+Enter` go to the next and the previous, **Aa** matches the case, `Esc` closes. In the bytes of a file `Ctrl+F` goes to the box that looks for bytes or text.
- **Copy** (`Ctrl+C`) copies what is selected.
- **Print** (`Ctrl+P`, **File ▸ Print…**, or the printer icon) prints a text as the tab shows it, a picture, the page of a snapshot, and a **document whole** (every sheet, every slide). **Save as PDF…** writes the same as a PDF. A ZIP's list, a PDF, a table and the bytes of a file cannot be printed yet.

## `.wsnp` files

A `.wsnp` is a ZIP "photo" of a web page for offline reading: the page, every file it needs and a manifest. In Folder Browser it is **a file like the others** in the tree: a click shows its page in a preview tab, a double click keeps it, and **Open as ZIP** lists its entries. The page runs as the format says (carousels, menus), in a frame that has no network. Links in it open in a tab (a picture, a PDF, source, a ZIP as a list), or in your browser for a web address, only when you click. The **status bar** says what the check found, and the **Metadata** tab (from the tab's menu or the status bar) shows what the manifest says. Files inside a snapshot open from its links, from the metadata and from Go to File. For anything more (a tree of its files, exporting), use **Open With…** and hand it to [WSNP Viewer](https://github.com/asantos43/wsnp-viewer).

The file is checked when it opens, and again in the background: its **structure**, the **SHA-256 and size of every file** against the manifest, and its **signature**. If a file is not what the manifest says, or a signed manifest was edited, the snapshot is **not valid** and its page is not shown until you choose **Show Anyway**. PageKeep signs what it writes; the signer is shown as a fingerprint, and **Trust this signer** in the metadata remembers a key you know is yours (design: [`MANIFEST-SIGNING.md`](MANIFEST-SIGNING.md)). A ZIP saved by an older PageKeep opens converted to a temporary `.wsnp`, with a bar that says so and can **Save as .wsnp…**.

## Shortcuts

| Action | Windows, Linux | macOS |
| --- | --- | --- |
| Open Folder / Open File | `Ctrl+Shift+O` / `Ctrl+O` | `⇧⌘O` / `⌘O` |
| Show hidden files | `Ctrl+H` | `⌘H` |
| Rename / Delete the item in the tree | `F2` / `Delete` | `F2` / `Delete` |
| Close the tab | `Ctrl+W` | `⌘W` |
| Next / previous tab | `Ctrl+PageDown` / `Ctrl+PageUp` | `⌘PageDown` / `⌘PageUp` |
| Through the tabs, most recently used first | `Ctrl+Tab`, `Ctrl+Shift+Tab` | `⌃Tab`, `⌃⇧Tab` |
| Go to tab 1…9 | `Alt+1…9` | `⌘1…9` |
| Hide / show the side bar | `Ctrl+B` | `⌘B` |
| Settings | `Ctrl+,` | `⌘,` |
| Zoom the tab in / out / reset | `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, or `Ctrl` + wheel | `⌘=` / `⌘-` / `⌘0`, or `⌘` + wheel |
| Word Wrap in a source tab | `Alt+Z` | `⌥Z` |
| Go Back / Go Forward | `Alt+Left` / `Alt+Right` | `⌃-` / `⌃⇧-` |
| Go to File | `Ctrl+E` | `⌘E` |
| Command palette | `Ctrl+Shift+P` | `⇧⌘P` |
| Find in the tab | `Ctrl+F` | `⌘F` |
| Copy | `Ctrl+C` | `⌘C` |
| Print | `Ctrl+P` | `⌘P` |

The shortcuts work wherever the focus is, also inside a page or a document.

## Settings, Help and About

**Settings** (the gear in the activity bar, **File ▸ Preferences ▸ Settings**, or `Ctrl+,`) opens in a tab with a box that filters them: **Color Theme** (Dark+, Light+ or Auto), **Display Language** (English, Brazilian Portuguese or automatic), whether to **reopen what was open**, **Show hidden files**, and for source files **Word Wrap** and **Format source files**. The other choices (Markdown, SVG, CSV, the sort order) are made where they are used, and are kept too. Settings are kept on your computer, in the application's own folder, and nowhere else: see [`../PRIVACY.md`](../PRIVACY.md).

**Help ▸ About Folder Browser** shows the version, what it runs on, the licence and the notices of the libraries inside it, and copies the version information for a bug report. Report a problem at <https://github.com/asantos43/folder-browser/issues>, **without attaching a private file**; a vulnerability goes the way [`../SECURITY.md`](../SECURITY.md) says.

## What is not here yet

Editing and saving a text file, comparing two text files, and making, renaming, moving and deleting **inside a ZIP** come in the next phases (see [`../TODO.md`](../TODO.md)). Selecting several rows at once, dragging onto a place of the side bar, and printing the bytes of a file or a table as a table are on the list too.
