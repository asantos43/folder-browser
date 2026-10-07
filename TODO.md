# TODO

What is left comes first, **by area of the application** (the interface, the files, the editors, ZIP files, images, PDFs…); what was delivered follows, by phase, as the history. Each piece of work is developed on its own branch and
delivered as its own pull request (see `CONTRIBUTING.md`). Check a box when the code, its tests, its `CHANGELOG.md` lines and its docs are merged, and when a piece of work is done move its line down to the history.

# Open work, by area

## Interface and workbench
- [ ] In a narrow editor group (two groups side by side at 1280 px) the toolbar of a Markdown file overlaps the buttons of the other group: let the toolbar wrap or hide labels
- [ ] Names of the first-level roots in the title bar's "Go to File" (the tree is lazy, so it has no list of every file yet)
- [ ] Open Recent as "Recent Folders" (phase 1d)
- [ ] More than two editor groups, and a split below (a grid of groups)
- [ ] Resize the groups by dragging their edge and remember the sizes; `Ctrl+1` / `Ctrl+2` to go to a group, and a command to split from the keyboard
- [ ] Drag a tab to the tree or out of the window; the same file in two groups at once (a tab is one file today, so it moves)

## Files, folders and places (tree, clipboard, drag)
- [ ] Rename a favourite (today a favourite is shown by the name of its folder)
- [ ] Dragging files onto a place moves them there; onto Trash deletes (with confirmation): needs the file operations of phase 2
- [ ] Columns for size and date that the user can turn on or off, and drag to resize (today: the one the order is by, both when the side bar is wide)
- [ ] Drag onto a place of the side bar to move there, and onto Trash to delete (the places are other folders than the root)
- [ ] Press Shift *before* the drag: Chromium starts no drag when the mouse goes down with Shift held (it selects); a drag of our own (pointer events) would allow it
- [ ] Undo of the last delete (Restore from the trash is there) or move
- [ ] Paste between two open folders (and between the disk and a ZIP), and paste what another application copied (files from the file manager); put the names of the copied rows on the system clipboard as text
- [ ] Mark with the pointer (a rubber band), and **Extract** for several rows
- [ ] Try the clipboard keys on **macOS** (the Edit menu roles Cut and Paste were added, as Copy already was) and Windows: tried on Linux only

## Search folders: find files by name, extension and content, kept as a folder (after 0.1.3)
Idea, not started. In the Explorer, a search for files by **name, extension and content** whose result can be **saved as a folder**: it appears in **Open Folders** like any other root (with a magnifier for its icon), the **Files** area shows what it found, and it can be **edited later** (its text, its filters, its place) to run again. It is what a file manager calls a saved search or smart folder. It is **the same engine as Find in Files** of "Text tools" (group 5): one search that is built once and used by both. Today the closest things are `listFiles` (the list of file names behind Go to File, up to a limit) and the open roots.

How it is shaped
- A **search folder is a virtual root** (`kind: 'search'` in `RootInfo`) made of **a query and a place to look in**, never of copies: its rows are the real files of an open folder (or ZIP), so a tab opened from it is the same tab as when the file is opened from the normal tree (the tab belongs to the real root), a rename, a move or a delete of a result is done to the real file through the same `fb:fs-*` calls (the registry sends a path of the search root to its source root; **the safety rules do not change**: a path is resolved inside the source root, a link is never followed out of it), and the search root itself is **read-only**: nothing is created or pasted into it
- The Files area shows the results as the **original hierarchy pruned to what matched** (only the folders that hold a hit, as the folders they are), with the matching files as leaves; **Show as a flat list** (a name with its folder) is a switch of the root. The listing of the root is computed from the set of hits, so the lazy tree needs nothing new
- The query is kept in the application's own folder (`core/searches.ts`, like the favourites and the drafts): a name, the **text** (with the modes of Find: normal, extended, regular expression; match case; whole word), the **extensions** (a list: `ts, tsx`, or globs: `*.test.*`), **names to leave out** (`.git`, `node_modules`, a `.gitignore` if there is one), a **name contains**, a **size** range, a **date modified** range, **include hidden files**, and the **place** (a folder of an open root); a search with no text looks at names only (cheap)
- **Edit Search…** (in the right-click menu of the search root, and a pencil on its title in Files) opens the same form, filled in, and **Save** runs it again; **Rename** edits the name of the search, **Remove Search** takes it out of the list and **does not touch a file** (the dialog says so in words, and it is never a delete)
- Saved searches come back at the next start in Open Folders (run again when chosen, not all at once), and the session keeps which one was in front

The form (in the Explorer, not a separate window)
- [ ] A **search button** in the title of Files (and **Search in Folder…** in the right-click menu of a folder, which fills the place in; `Ctrl+Shift+F` when the Explorer is in front) opens a form above the tree: the text with the **Aa**, **ab** (whole word) and **.\*** (regular expression) buttons and an **extended** choice, **files to include** (extensions or globs), **files to exclude**, **in folder**, and more filters folded (size, date, name, hidden), with the results **streaming in** under a temporary root named from the query ("Search: harbor") while it runs, a count and **Stop**
- [ ] **Save as a Search Folder…** gives the temporary root a name and keeps it; a temporary one that is not saved goes when the folder is closed or the application ends, and the form says so; **Clear** closes it
- [ ] **Group 1, names and extensions and the saved folder (medium, no content engine)**: the virtual root, the store, Open Folders with its icon, Files with the pruned tree, open, rename, move and delete a result through the source root, the edit form, remove, the session and the start; a search by **name, extension, size and date** over the files `listFiles` already walks, raised from its limit to a streamed walk
- [ ] **Group 2, content (medium to large; the engine of Text tools group 5)**: a streamed walk with a **pool of workers** (about half the cores, off the main thread, results batched to the interface a few times a second), **cancelled** when the query changes (after a short pause in typing) or **Stop** is pressed; the three modes, case, whole word, Unicode case folding; a file is **read in chunks** (with the overlap of the longest possible match at the seam) and never whole; a file that looks **binary** (a NUL in its first 8 KiB) or is **bigger than a limit** (a setting, 20 MB by default) is skipped and counted; text read as UTF-8 (with BOM, or UTF-16 with a BOM), and optionally as Windows-1252; a regular expression gets a **time limit** per file (a pattern that runs for ever is stopped and said so); symbolic links are not followed; the most files kept is capped (said when it is: "first 10,000 files")
- [ ] **Group 3, later**: **the lines that matched** shown under each file (a small preview line each, a click opens the file **at that line** with the match lit: it needs Go to line and the match highlight of "Text tools"); **Replace in Files** from the results (the other half of Text tools group 5); a search that looks **inside ZIP and other archives** (and the text of **PDF and Office files**, taken by the readers that draw them); **more than one folder** as the place (a search root over several source roots: moves and pastes across roots are refused as they are now, `fs.pasteOtherRoot`); **update by itself** when a file changes (a watcher on the source folder, a re-run of what changed), **export the list** of paths (copy as text, or as a playlist), and a **history** of the last searches
- [ ] **Engine decision, after a spike with numbers written here**: our own search in Node (`fs` read streams, a worker pool, JavaScript regular expressions: nothing to ship, the same on every system, slower on a huge tree), or the **`ripgrep`** program shipped in the package (very fast, knows `.gitignore`, binary files and encodings, MIT or Unlicense; a binary for each system to sign and list in the notices, started without a shell with an argument list); measured on this repository's own `node_modules` and on a folder of 100,000 small files

Performance
- [ ] The tree is a window over the hits (the listing of a folder of the search root is O(its hits)); results come in **batches** and the tree is refreshed at most a few times a second, keeping the user's expanded folders and scroll; the walk skips `.git` and `node_modules` unless asked; the memory held is the list of hit paths (a few MB for 100,000), not the files; opening a saved search shows its last run at once (kept paths, marked "from <date>") while it runs again in the background
- [ ] A budget measured by tests: the time to the first result and to the last of a name search and of a content search over a synthetic tree of tens of thousands of files, the interface staying responsive (frames) while it runs, and a cancel that stops the work within a fraction of a second

Safety and tests
- A search never reads outside the open roots, never follows a link out of its place, treats a name from the disk as data (no shell, no option injection if `ripgrep` is used: a `--` before names, no pattern or path taken as a flag), and a stored search with a place that is no longer open is shown as **not available** with a button to open the folder (a click is what authorises it)
- [ ] Tests: the matching of each mode and filter (hand-made files: Unicode, CR LF, a match across a chunk boundary, binary and big files skipped, a bad regular expression in plain words, a pattern that never ends); the pruned listing from a set of hits; the store (save, edit, rename, remove, a corrupt file); a result renamed, moved and deleted through the source root, and a path that leaves the root refused; and an end-to-end spec: search by content and extension, see it in Open Folders as a root, open a result, edit the search, restart and find it again, delete a result and see it go

Decisions to make before this is started
- **The place**: one folder (of an open root) in the first version, the recommendation (so a move or a paste stays inside one root), or several from the start?
- **The form**: in the Explorer above the tree (the recommendation, as VS Code's), a window, or an activity-bar view of its own?
- **The shape of the results**: the original hierarchy pruned to the hits (the recommendation) or a flat list with each file's folder beside its name?
- **A search that is not saved**: a temporary root that goes when it is closed (the recommendation), or every search kept until the user removes it?
- **Results**: a run when the search is opened and **Refresh** by hand (the recommendation), or kept up to date by watching the folder?
- **The engine**: our own, or `ripgrep` (the spike decides): which do you want tried first? And does the same engine serve **Find in Files** of the text tools, which is then built once?
- **Order**: group 1 first (names, extensions, the saved folder: the concept, quickly), then 2 (content), then 3 as asked?

## Text editing, tables and diff
- [ ] Select a range of cells (copy and paste a block, fill down, delete a range); paste from a spreadsheet
- [ ] Resize and reorder columns; freeze columns; show or hide a column
- [ ] Dates in other formats (`dd/mm/yyyy`) in sort, filter and the query; a column type chosen by hand
- [ ] More than one filter on a column; a "case sensitive" and a "whole word" box in the filter; search in one column
- [ ] A saved query (per file) and a history of the queries; `JOIN` with another CSV of the folder
- [ ] A bigger CSV than 5 MB can be edited (today it is looked at, with sorting, filters and the query); an `.xlsx` sheet as a table
- [ ] A file that changes on disk while it is open: reload a clean tab by itself and warn on a dirty one when the window gets the focus (today only Save notices)
- [ ] Find and Replace (`Ctrl+H` is Show Hidden Files here: a replace bar of its own), go to line, multiple cursors
- [ ] Deleting a file whose tab has changes asks first (today the changes go with the tab)
- [ ] Other encodings (Latin-1, UTF-16) with a choice in the status bar; mixed line endings flagged
- [ ] Drafts of a new, never-saved file (when New File… edits before it creates)
- [ ] Compare from a tab's menu
- [ ] Compare a text with the unsaved changes of its tab (today a side is the file as it is on disk), and a file of a snapshot as a side
- [ ] Edit in the diff (accept or reject a change), and a diff of two folders
- [ ] A language for a new text (today plain text)

## Text tools: case, lines, indentation, search and cursors (from Notepad++, after 0.1.3)
Brainstorm, not decided, not started. The features of Notepad++'s Edit, Search and View menus, for **every text editor of the application** (a file's and a new text's: they share `editableExtensions`, and the commands reach the editor in front through a group slot, as Find does). The editor is CodeMirror 6, which already has move/copy/delete line, indent, comment, select next occurrence, extra cursors, rectangular selection with Alt and the mouse, special characters and folding; the rest are **pure functions on text** (`core/textOps.ts`, no DOM, tested with edge cases), applied to the selection (each selection, with several cursors) or to the whole document when nothing is selected, as **one undo step** with a notice that says what was done ("12 duplicate lines removed"). Reached from **Edit** submenus (Case, Lines, Whitespace), the editor's right-click menu and the command palette. The app follows VS Code's keys where they exist (Ctrl+D, Ctrl+J, Alt+↑/↓, Ctrl+G) and Notepad++'s where the key is free.

Group 1: text operations (small, each a pure function with tests; the bulk of the request)
- [ ] **Case**: UPPERCASE, lowercase, Proper Case, Sentence case (and the "blend" variants that keep capitals inside words), Invert case, Random case; Unicode-aware (`ß`, `İ`, accents), never touching what is not a letter
- [ ] **Sort lines**, ascending or descending, in the six ways of Notepad++: lexicographic, ignoring case, in the language's order (`Intl.Collator`, accents), as integers, as decimals (dot or comma), and by length; stable; lines that are not numbers go first, as there; a sort of a selection sorts only those lines
- [ ] **Remove duplicate lines** and **remove consecutive duplicate lines**; **remove empty lines** and **remove empty lines that have only blanks**; **reverse** the order; **randomise** the order; duplicate the current line
- [ ] **Join lines** (`Ctrl+J`, with a separator) and **split lines** (at a width the user types); **move line up and down** (`Alt+↑/↓`, already there: only to put in the menus)
- [ ] **Whitespace**: trim leading, trailing, or both; end of line to space; trim both and end of line to space; tab to spaces and spaces to tab (all, or only the leading ones), with the tab size of the editor; increase and decrease indent (there already)
- [ ] **Line ending**: convert to Windows (CR LF), Unix (LF) or Mac (CR) from the status bar's `LF`/`CRLF` (the buffer already keeps the file's ending: this changes it, as an edit that can be saved)
- [ ] **Redact** the selection (replaced by blocks), **comment and uncomment** a line or a block (`Ctrl+/` is there; the block form and the menu entry are not)
- [ ] Status bar: **Ln, Col, and how many characters or lines are selected**, and the length of the document
- [ ] Tests: each function on LF text with empty lines, one line, no trailing newline, Unicode, and a 100,000-line document (a budget: a sort or a dedupe of a 5 MB file in well under a second, so it needs no worker)

Group 2: Find and Replace (medium)
- [ ] **Replace** as a second row of the Ctrl+F bar (opened by an arrow, as VS Code's) with **Replace** and **Replace All**; modes **Normal**, **Extended** (`\n`, `\r`, `\t`, `\0`, `\xHH`) and **Regular expression**; options **Match case**, **Whole word**, **Wrap around**, **In selection**, **Backward**, and **`.` matches newline**; **Count**, **Find All** (a list of the lines found, a click goes there), and **Mark All** (highlighted in the text)
- [ ] The matching engine is `@codemirror/search`'s `SearchQuery` (a new dependency, MIT; notices), the bar and the words are ours (en and pt-BR); in the replacement `$1` and `\1`, and `\U \L \E \u \l` to change the case of what is put in
- [ ] A regular expression that can run for ever (catastrophic backtracking) must not freeze the window: for a big text the search runs in a worker with a time limit, and says so when it is stopped (as the SQL query is)
- [ ] **Replace All in all open documents** and **Find All in all open documents** (the buffers of the open tabs, each change an undo step of its tab)
- [ ] Incremental search as you type, **Select and Find Next** (`Ctrl+F3`) and the keys `F3` / `Shift+F3`
- [ ] Tests: each mode and option, the replacement forms, a bad regular expression said in plain words, a stopped search, and CR LF files (the buffer is LF inside: `\r` in the extended mode must still work)

Group 3: cursors, columns and navigation (medium)
- [ ] **Select next occurrence** (`Ctrl+D`), **select all occurrences**, **undo the last added**, **skip and go to the next**; **add a cursor above and below** (`Ctrl+Alt+↑/↓`); a click with `Alt` for a cursor; **column selection** with `Shift+Alt` and the mouse or the arrow keys
- [ ] **Column editor** (`Alt+C` in Notepad++): insert a text, or **a sequence of numbers** per line (a start, a step, zeros on the left, decimal, hexadecimal, octal or binary) at the column of the cursors
- [ ] **Go to line** (`Ctrl+G`) and **go to offset**; **go to the matching bracket**, **select what is between `{}`, `[]` or `()`**
- [ ] **Smart highlighting**: the other places of the word under the cursor or of the selection are lit, on by a setting

Group 4: aids to see the text (small to medium)
- [ ] **Show symbols**: spaces and tabs, end-of-line marks (CR, LF, CR LF), control characters, and **indent guides**, each on from the View menu and a toolbar button, remembered
- [ ] **Folding** with the gutter's arrows and the keys, **fold all / unfold all / fold level 1 to 8**; **hide lines** (selected lines out of sight until shown again)
- [ ] **Bookmarks**: mark a line (`Ctrl+F2`), next and previous (`F2`, `Shift+F2`), clear all, and **cut, copy, delete or paste over the bookmarked lines**, and the inverse (the lines that are not)
- [ ] **Synchronised scrolling** of the two editor groups (vertical and horizontal), a toggle in the View menu; the natural pair of the side by side and the diff
- [ ] **Read-only** toggle for a tab; **word completion** from the words of the document; **text direction** (right to left)

Group 5: Find in Files and Replace in Files (large: a project of its own)
- [ ] **Find in Files** (`Ctrl+Shift+F`; the same engine and form as "Search folders", whose results can also be kept as a folder) over the open folders and ZIP files: a text, the three modes, case, whole word, a filter of names (`*.ts`) and folders to leave out (`.git`, `node_modules`, taken from a `.gitignore` if there is one), a results panel (file, line, the line with the match lit) that opens the file at the line, **cancel**, and a count; run in the main process by a worker so it never blocks, never follows a link out of the root, never reads a binary (the look at the first bytes) or a file over a limit
- [ ] **Replace in Files**: a preview of every change, the files chosen by the user, written through the safe path (temporary file, rename, version check) and refused for what is read-only (a `.wsnp`, an encrypted ZIP); an entry of a ZIP goes through `core/archive/edit.ts`; one notice for the batch; the files that are open with changes are not touched
- [ ] This item is the old idea "Search inside files" (the Ideas for later list points here)

Group 6: bigger, optional
- [ ] **Other encodings** (Latin-1, Windows-1252, UTF-16, Shift-JIS, GBK…) shown in the status bar and chosen from it, with a conversion (`TextDecoder` reads them; writing needs `iconv-lite`): the same item as "Other encodings" under Text editing and tables above
- [ ] **Live file monitoring** (`tail -f`: a file that grows is followed to its end) with the reload of a file that changed on disk (the same area as "A file that changes on disk while it is open")
- [ ] **Clone document**: the same file in two groups at once, with one buffer (today a tab is one file and moves)
- [ ] **Document map** (a minimap) and a **function list** (from the syntax tree of the language: each language needs its own list of nodes)
- [ ] **Macros** (record and play back a run of commands, save with a name) and a **clipboard history**
- [ ] **Open in a browser** for an HTML file, **file summary** (lines, words, characters, bytes) and a word count of the selection
- Not planned: plugins of other people (the application's safety rules), the Run menu, FTP, spell checking

Decisions to make before this is started
- **Keys**: VS Code's where they exist (the app is styled after it), Notepad++'s where free (`Ctrl+U` / `Ctrl+Shift+U` for lower and upper case), and a place for the user to choose their own later?
- **`Ctrl+H`** is Show Hidden Files here (the file manager's key): Replace opens as the second row of `Ctrl+F` and gets another key (`Ctrl+Alt+F`?), or does `Ctrl+H` become Replace while the editor is in front?
- **With no selection** an operation acts on the whole document (undo brings it back, a notice says what was done): or should it ask first for the destructive ones (sort, remove duplicates)?
- **Where they live**: Edit submenus, the editor's right-click menu and the palette, in the editors of files and of a new text; the diff and the read-only views get none
- **Order**: group 1, then 2, then 3 and 4, and 5 as its own project: or Find and Replace first?

## ZIP files
- [ ] Move and copy between a folder and a ZIP (and between two ZIPs), and drop a file from the disk or the desktop into a ZIP (an "add" from outside)
- [ ] Edit the bytes of an entry of a ZIP in the hex view (today only a file of a folder); a CSV entry of a ZIP is edited as a table through the text buffer, but no test covers it yet
- [ ] Rewrite only the tail of the ZIP when entries are added at the end (today every change rewrites the whole ZIP); raw copy of compressed entries without recompressing them
- [ ] A ZIP that is written again while a tab shows one of its entries read-only (media, document, picture) keeps showing the old bytes until the tab is opened again
- [ ] A ZIP with a password (ZIP-level encryption: traditional ZipCrypto and WinZip AES): today its entries are listed as protected and cannot be opened, and the ZIP is read-only (`core/archive/reader.ts` and `core/zip.ts` refuse them; yauzl does not decrypt, so it needs a decryptor for the entry's stream, a password box like the PDF's, and `core/archive/edit.ts` must keep the encrypted entries as they are when it writes the ZIP back)

## Archives: compress, extract, and tar, tar.gz and 7z (after 0.1.3)
Idea, not started. Today a ZIP opens as a folder (yauzl reads, yazl and `core/archive/edit.ts` write), its list can extract the entries selected (`zipExtract`, through `safeRelative`), and nested ZIPs are `a.zip!/b.zip!/c` paths (`core/vpath.ts`). New: **Compress** a folder (or several marked rows) with a name and a format chosen, **Extract** an archive from the tree, and **browse, open and extract** tar, tar.gz and 7z archives as folders as ZIP is. Everything that writes keeps the rules of the application: only inside an open root, a temporary file and a rename, **never overwrite without asking**, never put an archive inside itself, streams (no whole file in memory), the work off the main thread with a progress that can be cancelled, and refusals that say why in plain words.

Group 1: Compress and Extract for ZIP (medium; no new dependency)
- [ ] **Compress…** in the right-click menu of a folder, of a file, and of **several marked rows** (one archive of them all), and in the menu of the Files title for the folder that is the root: a dialog with the **file name** (a field, the default is the folder's name; the extension follows the format unless the user typed one), the **format** (ZIP now; TAR, TAR.GZ and 7Z as they arrive), the **level** (store, fast, normal, maximum), **include hidden files** (on), **leave out** patterns (a few suggestions: `.git`, `node_modules`, `.DS_Store`, `Thumbs.db`), and **where** (the folder it is in by default, or any folder of the open root)
- [ ] The result is made in a temporary file next to its place and renamed when done; a name that is taken asks (**Keep both** with a numbered name, **Replace**, **Cancel**); the archive being made is left out of itself when it is inside the folder compressed; symbolic links are **not followed** (stored as links where the format has them, else skipped and counted in the notice), files that cannot be read are skipped and listed, and the notice says how many files and how big, with **Show in folder**; the tree shows the new file and selects it
- [ ] **Extract** in the right-click menu of an archive (and of several): **Extract Here** (into a new folder named like the archive, not mixed into the files beside it, unless the user chooses otherwise), **Extract to "<name>/"** and **Extract to…** (a folder of an open root, chosen with the move dialog); the same safety as the list's extraction (`safeRelative`, no `..`, no absolute path, no link that leaves the folder, no device or pipe) plus **limits against an archive that lies** (a cap on the total size, on the number of entries and on the ratio of unpacked to packed, said in words, and the real count of bytes written, not the size the header claims); the modes and dates of the entries are kept; a name that is taken or that the system cannot have (Windows reserved names, `:`, trailing dots, names that differ only in case on a case-insensitive disk) asks what to do
- [ ] **ZIP64** when a folder has more than 65,535 files or a file of 4 GiB or more (the editor refuses over 100,000 entries and ZIP64: this is the writer for a new archive, which is not bound by that), names in UTF-8 with the flag set, dates and modes kept
- [ ] A **progress** item in the status bar (what is being done, how far, **Cancel**), one at a time per archive and a few at once, never freezing the window; a cancel removes the temporary file and leaves no half archive and no half extracted folder it created
- [ ] The same commands from the **ZIP list** view (Extract All, Extract Selected) and for a `.wsnp` (an extract that is allowed: it is a read of the file)
- [ ] Tests: compress then extract gives the same tree (empty folders, Unicode and long names, a file of 0 bytes, hidden files in and out, the output not inside itself); a name that is taken; `../x`, an absolute name and a link out of the folder refused; a bomb stopped at its limit; a cancel in the middle leaves nothing; and an end-to-end spec (right-click a folder, choose a format and a name, Compress, open the result as a folder, Extract it again)

Group 2: tar and tar.gz (medium to large; the archive layer is made format-neutral)
- [ ] An **archive reader interface** in `core/archive` (list, open an entry as a stream, stat, its format and whether it can be changed) that ZIP, TAR, TAR.GZ and 7Z implement, so `RootRegistry`, the tree, the list view, `fb-media://`, Open With… and `a.tar.gz!/b.zip!/c` nested paths work for every format (`core/vpath.ts` and the roots of kind `zip` are widened to **archives**; a format is told by its **name and its first bytes**, not by the name alone)
- [ ] **TAR** (ustar, pax and GNU long names, files over 8 GiB, empty folders; sparse files and special entries are listed and not extracted) and **TAR.GZ** (`.tar.gz`, `.tgz`; concatenated gzip members), read as a stream with the built-in `zlib`; an index of the entries is built in the background with a progress (a tar has no central directory: a plain tar is read by header offsets, a gzip one is decompressed again from the start to reach an entry, with the index kept so the next open is quick), and a **very large** tar.gz says it will take a while and can be cancelled
- [ ] **Browse, open and extract** tar and tar.gz as a folder, read-only (a tar of the world is not edited in place: a tar.gz cannot be changed without writing it all again), with **Open as List**, search, the right-click menu of an archive and the nested archives
- [ ] **Create** TAR and TAR.GZ from Compress… (a writer of our own on `tar-stream` (MIT) or by hand: pax headers for long names and big files, the modes, the dates, links kept as links, no owner names, uid/gid zero); `.tgz` offered as the name
- [ ] Tests: tar and tar.gz built by hand in the fixtures (a tar is a few headers; a `.tgz` is `zlib.gzipSync` of it), long names, pax, an entry that tries to leave the folder, a truncated archive and a corrupt gzip (said in plain words), nested archives, and a round trip with the system's `tar` when it is there

Group 3: 7z (large: needs an engine and a licence decision)
- [ ] **Read, browse and extract 7z** (also solid archives, the LZMA2 and the older methods, a header that is compressed); an archive with **encrypted** content or header says so and waits for the password item below; **Create 7Z** from Compress… (LZMA2, a level, multi-thread where the engine has it)
- [ ] The engine, **decided after a spike** with both written down here: (a) the official 7-Zip command line (`7zz`, or the `7zip-bin` package's `7za`), started **without a shell** with an argument list (a `--` before names, and no name of ours ever taken as an option), unpacked next to the application (`asarUnpack`), signed and notarised on macOS and listed in the notices; fast, multi-threaded and with many formats at once (7z, tar, gz, bz2, xz, zip); or (b) **7-Zip as WebAssembly** (`7z-wasm`), the same on every system, nothing to sign, slower and to be run in a worker with the real folders mounted (Node's file system, not memory) so that big archives do not fill memory. The licence of 7-Zip (LGPL, with a restriction on its unRAR code) goes in `THIRD-PARTY-NOTICES.md` and the About window, and the engine stays a separate file the user can replace
- [ ] If the engine is there, the same code gives **tar.bz2, tar.xz, tar.zst**, a single `.gz`, `.bz2`, `.xz` and **RAR (read only)**: each added as its own item when asked, not by default
- [ ] Tests: 7z archives made by the engine at test time (and one small fixed file kept in `fixtures` for a machine that has none), solid and not, a name with `-` at the start (no option injection), Unicode, a bomb, a corrupt header, a cancel that stops the engine's process; the packaging smoke test starts the engine from the installed `.deb`, `.rpm`, `.exe` and `.dmg`

Group 4: later
- [ ] **Change an archive in place** for tar and 7z (add, rename, remove): written again whole through a temporary file, as ZIP is; a solid 7z recompresses what is after the change: only if asked
- [ ] **Passwords** for archives: one box for ZIP (the open item "A ZIP with a password") and 7z (AES-256, with the header encrypted), on open and on Compress…
- [ ] **Test archive** (check every CRC and say what is wrong), **split / multi-volume** archives (`.7z.001`, `.zip.001`), and a self-extracting `.exe`: not planned for now
- [ ] Register `.tar.gz`, `.tgz`, `.tar` and `.7z` with the installers (Open With and the MIME file of Linux) as ZIP is, but never as the default (the system's archiver is)
- Not planned: RAR creation (a closed format), editing inside a compressed tar, formats for disk images (`.iso`, `.dmg`) beyond what the engine reads

Performance
- [ ] Everything is a stream with back-pressure: a folder of 10 GB is compressed in a few MB of memory; the reader of a 100,000-entry archive lists as the index fills (the tree draws a window of rows); progress events are sent a few times a second, not per file; compression runs in a worker (or the engine's own process), so the interface keeps its 60 frames; budgets measured by a test (the time and the memory of compressing and extracting a folder of many small files and of one big file, with a limit that fails the test)

Decisions to make before this is started
- **The 7z engine**: the 7-Zip command line in the package (fast, more formats, a binary to sign and ship for each system), or 7-Zip as WebAssembly (one code for every system, slower, heavier on memory)? The spike decides; which do you prefer to try first?
- **Extract Here** into a **new folder** named like the archive (the recommendation, as most archivers do), or straight into the folder the archive is in?
- **New formats are read-only** as folders (browse, open, extract), editing in place only for ZIP: is that enough?
- **The first release of this**: group 1 alone (Compress and Extract for ZIP, quick to deliver), then 2, then 3?
- **Compress…** for a folder with no choice of format shown until there is more than ZIP, or always the dialog?
- Should `.tar.bz2`, `.tar.xz` and `.tar.zst` come with the 7z engine, or wait to be asked?

## Images: viewing and a simple editor (after 0.1.3)
Idea, not started: the features of the Paint of Windows 7/8, with no layers, but with undo and redo, and **built for speed as much as for features**. A canvas 2D editor in the interface (no heavy library), saving through the existing `saveBytes` (temporary file, rename, version check) and Save As. **Only JPEG, PNG and WebP are edited** (the formats that matter for photographs and the web, and the ones whose metadata can be kept); every other format is **exported to**, and the images the application shows but does not edit (GIF, BMP, ICO, AVIF, SVG) can be **exported to JPEG, PNG or WebP** and the copy edited. The editor works on one RGBA bitmap whatever the file was, and a loss that a format causes is said in plain words before it happens (JPEG: quality, no transparency; GIF: 256 colours; BMP and ICO sizes), with Export to another format one click away. **The metadata (EXIF, XMP, IPTC, the colour profile) is kept by default**, and updated where the edit makes it stale (see "Metadata").

Phase A: the editor
- [ ] **Edit** on the toolbar of a JPEG, PNG or WebP (any other image has **Export As…** there instead, to make one of those and edit it); pencil/freeform, brush with a line width, eraser, colour picker, fill bucket, colours and a palette
- [ ] Line, rectangle, rounded rectangle, ellipse, each empty, filled or both, with a line width; Shift for a square or a circle
- [ ] Undo and redo (`Ctrl+Z`, `Ctrl+Shift+Z`/`Ctrl+Y`), the tab's dirty mark, a draft for the next start like the other editors, Save, Save As
- [ ] **A new image** (File ▸ New Image, `Ctrl+Shift+N`): a dialog for the size (pixels, with a few presets: icon sizes, 800 × 600, 1920 × 1080, the size of the image on the clipboard), the background (transparent, white or a colour) and the format it will be saved as; it exists only in the window, like a new text (kept between starts as a draft), until Save As gives it a file

Formats
- [ ] **Edited (opened and saved in place):** PNG, JPEG, WebP, decoded with `createImageBitmap` and encoded by the canvas (`convertToBlob`), with the quality chosen by the user (see "Quality") and an alpha-aware choice (JPEG has no transparency: flatten on a colour, said before saving)
- [ ] **Export as JPEG / PNG / WebP** for every image the application shows and does not edit: on the toolbar of the image and in the right-click menu (File ▸ Export As…). A GIF, BMP, ICO or AVIF is decoded by the browser; an **animated GIF** asks which frame (a number, with the first as the default) since the three formats here are stills; an ICO or a `.cur` offers the size to take; an **SVG** is drawn at a size the user gives (pixels, with its own ratio kept) on a transparent or coloured background. The copy opens in a new tab to be edited, or is only written (the choice is in the dialog), and the original is never touched
- [ ] **Export from the editor** to formats that are written and not edited: **BMP** (a small encoder of our own, 24 and 32 bits; the canvas cannot write it), **GIF** (a still, with a small open-source encoder such as `gifenc`: a palette made by quantisation, 1-bit transparency, the number of colours and dithering chosen), and **ICO** (our own writer: the sizes to put in it, 16 to 256, each scaled from the picture, as PNG entries). Export As… is a second command next to Save As…, which stays for JPEG, PNG and WebP
- [ ] Metadata on export: JPEG, PNG and WebP carry the original's EXIF/XMP/ICC over (see "Metadata"); BMP, GIF and ICO have none to carry, and the dialog says so
- [ ] The decoders and encoders run in the worker (see Performance); a file whose decoder fails is shown as it is today, with the reason
- Not planned: editing an animated GIF frame by frame, editing the sizes of an ICO, writing AVIF or TIFF, painting on an SVG (it stays a text file)

Metadata (EXIF): a **must**, and independent of the pixel editor, so it can come first
- [ ] **Metadata panel** on an image tab of the three edited formats (PNG, JPEG, WebP; read-only for AVIF where its container has EXIF): the tags in groups (Image, Camera, Exposure, Date and time, GPS, Copyright and description), with names, values in words (an aperture as f/2.8, an orientation as "Rotated 90°") and the raw value on demand; read with a parser (an MIT library such as `exifr`, or our own IFD reader) off the main thread
- [ ] **Edit the tags in place, without touching a pixel**: the EXIF block of a JPEG (the APP1 segment), a PNG (the `eXIf` chunk) and a WebP (the `EXIF` chunk of its RIFF container) is replaced and the rest of the file is copied byte for byte, so a JPEG is not compressed again and loses nothing; saved through the same safe path as any file (temporary file, rename, version check), with undo/redo inside the panel
- [ ] Editors by type of tag: text (description, artist, copyright, software), date and time with a picker (and a "shift all dates by…" for a camera with the wrong clock), numbers and fractions with validation, a list for enumerations (orientation, flash, metering), GPS as degrees/minutes/seconds or decimal (no map: nothing leaves the computer); add or remove a tag, and **Remove location (GPS)** and **Remove all metadata** as one click each (privacy before sharing)
- [ ] Serialising rules that keep a file right: the byte order of the original is kept, the vendor **MakerNote is kept as opaque bytes** (its inner offsets are not rewritten; when a block would have to move, say it and keep the note), values that are not edited stay as they were, a thumbnail (IFD1) is kept for a metadata-only edit and dropped (or made again) when the pixels change; XMP (XML text) and IPTC are kept, and XMP can be edited as text; the ICC colour profile is kept
- [ ] **Saving an edited picture keeps the metadata**: the canvas drops it, so the original blocks are put back in the new file (JPEG: a new APP1 after SOI; PNG: `eXIf`/`iTXt`; WebP: a `VP8X` with the `EXIF`/`XMP ` chunks) and the tags the edit made stale are updated: **Orientation** is set to 1 when the editor turned the pixels upright on opening, `PixelXDimension`/`PixelYDimension` follow a crop or resize, the thumbnail is dropped, and `Software` can be set; a choice in the Save dialog: **Keep**, **Remove location only**, **Remove all**, or **Edit…** (opens the panel before writing)
- [ ] A **new image** (saved as JPEG, PNG or WebP) has an empty EXIF with the date it was made and `Software`, which the panel can fill (author, copyright, description) before the first Save As
- [ ] Several files at once: remove the metadata (or only the location) of the marked files in the tree, in place and losslessly, with one notice for the batch
- [ ] Tests: IFD reader and writer against hand-made blocks (little and big endian, every value type, a corrupt block that is refused in plain words), a byte-for-byte check that the pixels of a JPEG are untouched, the same file read back by the real `exifr`/Chromium after an edit, Orientation after a rotation, and the privacy buttons (no GPS tag left)

Quality of the formats that have it (chosen by the user at Save and Save As, never fixed)
- [ ] A **Save options** dialog (also the one of Export As…) with a live preview: JPEG and WebP quality as a slider (1 to 100) and a number, the resulting size shown before writing (encoded in the worker, debounced), a before/after split view of the picture at the pixels under the pointer, and the saved file as the one that was previewed
- [ ] JPEG: quality, **progressive** or not, and the chroma subsampling if the encoder gives it (the canvas gives only the quality: a wasm encoder such as mozjpeg is the option if these matter, and heavy: decided when we get there); WebP: quality and **lossless**, to be checked against what the canvas gives (it may need `libwebp` in WebAssembly); PNG: lossless, with the compression level and an optional **reduce to 256 colours** (quantisation, with a dithering choice) if an encoder with levels is added; the export to GIF has the number of colours and dithering
- [ ] The options chosen are remembered per format, and **Save** reuses what the file was saved with last time (a JPEG opened keeps its estimated quality as the suggestion, read from its quantisation tables)

Phase B: selection and the clipboard
- [ ] Rectangular and free-form selection; move it, crop to it, delete it; the selection floats until it is confirmed
- [ ] Copy, Cut, Paste (`Ctrl+C/X/V`) with the system clipboard as PNG (`clipboard.readImage/writeImage` in the main process, a new validated `fb:` channel), **Paste into a new image**
- [ ] Resize (pixels and percent, keep the ratio), rotate 90°, flip, canvas size
- [ ] Polygon and curve; text (a text box, font, size: the costly one, last)

Performance (a requirement of every item above, not a later polish)
- [ ] Draw outside React: the canvas is driven by pointer events directly, never by a state change per move; a stroke is batched per animation frame and uses `getCoalescedEvents()` so a fast mouse leaves no gaps; a `desynchronized` 2D context for low latency where the platform allows it
- [ ] Undo by **changed region** (a rectangle, kept as an `ImageBitmap` or compressed bytes), never a copy of the whole image per step; a memory budget (about 256 MB) that drops the oldest steps and says so; a 12 MP photo is 48 MB per full copy
- [ ] Heavy work off the main thread: decode with `createImageBitmap`, and flood fill (iterative scanline, never recursive), resize, rotate, crop and encode (`OffscreenCanvas.convertToBlob`) in a worker, with the interface staying responsive and a cancellable progress for the slow ones
- [ ] Big images: a limit for editing lower than for viewing (about 50 megapixels, said in plain words), the view drawing only what is on screen at the zoom (a pixelated look at 400% and over, `image-rendering`), the pointer mapped between screen and image with the zoom and the pixel density
- [ ] Preview shapes on a second canvas laid over the image, so dragging a shape never redraws the picture
- [ ] A budget measured by the end-to-end tests (Chromium is real there): the time of a stroke's frame, of a fill on a 4000 × 3000 image, and of an undo, with a limit that fails the test; unit tests for the history, the regions and the coordinate maths (happy-dom has no canvas)

## PDFs: bookmarks, links, forms, annotations and pages (after 0.1.3)
Idea, not started. pdf.js 6.4 (already in the application) has the outline, the annotation layer with the form fields, `saveDocument()` (which writes the filled fields and the annotations) and `extractPages()` (choose, reorder and join pages of several documents); it cannot write a page's rotation, which needs a small writer of our own or `pdf-lib` (decided after a spike). Nothing of a PDF runs (no scripts: kept). Every change is kept as a pending list and written once, through the safe save of the application (temporary file, rename, version check).

Reading and moving about
- [ ] **Bookmarks (the outline)** in a side panel of the PDF tab (`getOutline()`: the tree, folded and unfolded, long titles on a tooltip): a click scrolls to the page the bookmark refers to (named destinations and page references resolved to a page number); the panel is shown or hidden from the toolbar and remembers it
- [ ] **Page thumbnails** in the same panel (drawn only when in view, at a small scale, with the current page marked), a click goes to the page; the base of the page selection below
- [ ] **Links inside the PDF** (the annotation layer): a link to a page jumps to it, a web link opens in the browser after the usual confirmation, and the pointer says where it goes

Forms
- [ ] **Fill a form (AcroForm)**: the fields are drawn by pdf.js's annotation layer as real inputs (text, check boxes, radio buttons, drop-down lists and list boxes), with Tab through the fields and a highlight of the fields on request; the values are kept in the annotation storage, the tab shows the dirty mark and asks before it closes, and a draft keeps them for the next start like the other editors
- [ ] **Save the filled form**: `saveDocument()` writes the values (an incremental update: the rest of the file is kept), through **Save** (over the original) or **Save As…**; a button to clear the form; a test with a synthetic PDF that has a form (the fixture builder gets text and check-box fields) checked by reading the file back with pdf.js
- [ ] What it does not do, said in plain words in the tab: fields that **calculate or check with JavaScript** do not (scripts do not run), **XFA** forms (an old Adobe format) are shown as the plain PDF they carry, and a **digitally signed** PDF warns before it is changed (the signature would no longer be valid)

Annotations
- [ ] **Annotate** (the annotation editor that pdf.js has: `AnnotationEditorLayer` and `AnnotationEditorUIManager`): highlight (with a colour and the thickness of the line), free text (font size and colour), freehand ink (colour and thickness), and an image stamp; select, move, resize and delete an annotation, with undo and redo; the annotations already in the file are shown, and the new ones are written by `saveDocument()` as real PDF annotations that other readers show too
- [ ] Highlight from a text selection (a button and a key), a comment on an annotation, and a list of the annotations of the document in the side panel that jumps to each

Pages
- [ ] **Select pages** (thumbnails: click, `Ctrl`/`Shift`, a range typed as `1-3, 7`), and **Save the selected pages as a new PDF** (Save As…, `extractPages()`), keeping the outline entries and links that still point to a kept page where the library does
- [ ] **Rotate** the selected page or pages (90° to the right or left, 180°), seen at once in the thumbnails and the page; **delete** and **reorder** pages by dragging their thumbnails; one list of pending changes with **undo and redo**, written once. First a **spike** for the rotation (an `/Rotate` entry written by a small incremental-update writer, or `pdf-lib` on the output of `extractPages()`), with a decision recorded here
- [ ] **Merge**: insert another PDF into this one (Insert PDF…: a file picker, or a PDF dragged from the tree onto the thumbnails), before or after a page or at the end, with its own password asked if it has one; the result is the same pending list, so it can be reordered and rotated before it is written
- [ ] **Save over the original or Save As…** for a PDF that was changed (pages or form or annotations): the choice is in the dialog, the version of the file is checked first (a changed file asks, as an edited text does), and the file is replaced through a temporary file and a rename; a PDF of a **ZIP or of a snapshot** has Save As… only for now (writing bytes into a ZIP is for later); a PDF opened with a password is written only after the check that the result is not left unencrypted by mistake (see below)

Performance (a requirement of the items above)
- [ ] Thumbnails and the page list are virtual lists (a PDF of 1,000 pages draws only what is in view and near it), thumbnails are drawn at a low scale in the order of the view and cancelled when scrolled away; the page organiser works on a list of numbers (rotating, deleting and reordering never draw or write anything), and the heavy writing runs in pdf.js's worker, with a progress that can be cancelled; end-to-end tests with a PDF of a few hundred small pages measure the time to open the panel and to save

Passwords and what is kept
- [ ] A PDF that was opened with a password: **test** whether `saveDocument()` and `extractPages()` keep it encrypted (and with which key), and say it before the first write; a **new** PDF made from pages of an encrypted one is not encrypted unless the user chose to (said in the dialog)

- [ ] Change or remove a PDF's password: pdf.js only reads (it cannot write a PDF with other encryption), so this needs another library or a tool such as qpdf

- Not planned: running a PDF's scripts (JavaScript), XFA forms, signing a PDF digitally, OCR

## Snapshots (`.wsnp`)
- [ ] A PageKeep ZIP found in a folder opens as a snapshot (today it opens as a ZIP folder; "Open as Snapshot" for `.zip` rows)
- [ ] Entries of a `.wsnp` are read-only (the whole file can be renamed, moved, deleted): nothing writes yet, so this is a rule for phases 2 to 5 (`core/archive/edit.ts` must refuse a `.wsnp`)
- [ ] Decide whether the **Save as .wsnp…** bar of a converted PageKeep ZIP (`ConvertedBar`) stays: it is the only part of the viewer's conversion still in the app; the **Metadata** tab of a snapshot stays for now

## Media, documents and binary files
- [ ] Try a real mp4 (H.264), mp3, flac and an HEVC file by hand (the tests only have WAV and a broken file: no encoder here)
- [ ] Previous/Next for the media of a snapshot (from its list of files)
- [ ] Header panel for ELF, PE and Mach-O (sections, imports): read-only, no execution
- [ ] Print the bytes of a file and the CSV table as a table (a CSV prints as its text)
- [ ] Zoom keys with the focus inside a document are relayed by the page (the main process reads real key presses first); Find of a pptx highlights in the slide list only
- [ ] Try real files by hand (Word with headers and footnotes, a PowerPoint with charts and SmartArt, an `.xls`): the tests only have small hand-written ones
- [ ] `.rtf`, `.pages`, `.numbers`, `.key`: not drawn (Open With… or hex)
- [ ] Hex: paste bytes, fill a selection, search and replace bytes, a check mark for the bytes saved but not yet on disk

## Playlists: open, edit, create and play M3U and M3U8 (after 0.1.3)
Idea, not started. A playlist is a text file with one track per line (`.m3u`, and `.m3u8`, the same in UTF-8; the extended form has `#EXTM3U` and `#EXTINF:seconds,Artist - Title`). Today a sound or a video plays one file at a time in `MediaView` (the tab goes on to the next file of its folder when one ends, `neighbours`); a playlist is another source for that sequence, with its own tab, its own order and a player that follows it. **Safety stays as it is**: an entry is played only if it resolves to a file inside a folder or ZIP that is **open** (the playlist's own, or another one the user opened); a path outside them is listed, greyed, with the reason and a button to open that folder (a click is what authorises it: the application never adds a root on its own); **a web address is never played** (nothing leaves the computer); media still goes through `fb-media://` tokens, never a path.

Group 1: the format and playing in sequence (the core)
- [ ] **A reader and a writer of M3U/M3U8** in `core/playlist.ts` (plain TypeScript, no Electron, tested next to the code): simple and extended lists; `#EXTINF` (duration, `-1` for unknown, a comma inside a title), `#PLAYLIST`, other `#` lines **kept as they are** so an edit never loses what it does not understand; `\n`, `\r\n` and `\r` endings and the byte order mark; a `.m3u` that is not UTF-8 is read as Windows-1252 (the old convention) and a list is **written as UTF-8** (and `.m3u8` always is)
- [ ] **Resolving an entry**: relative to the playlist's folder (`/` or `\`, `..`, spaces, `%20` in `file://` addresses), an absolute path of this system, a Windows path (`C:\Music\a.mp3`) on Linux or macOS looked for **by its file name** in the playlist's folder and below it (said when it is a guess); an entry of a playlist that is inside a ZIP resolves inside that ZIP; each entry has a state (found, not found, outside the open folders, an address on the web, not a sound or a video) that the list shows in words
- [ ] **Open `.m3u` and `.m3u8` as a playlist** (a tab; the right-click menu has **Open as Text** for the text editor, which already edits it): the table of tracks (number, title, artist, duration, path, state) with the current track marked; a streaming manifest (`#EXT-X-…`, the HLS kind that has the same extension) is recognised and shown as text, not as a playlist
- [ ] **Play in sequence**: double click or Enter on a track plays it, and when it ends the next one starts; **previous** (restarts the track when it has played more than 3 seconds), **next**, play and pause, a seek bar, volume and mute; a track that cannot be played is skipped with one notice (and it stops, not loops for ever, when none can be)
- [ ] **Shuffle**: every track once before any is repeated (a shuffled copy of the order, not a random pick each time), the current one never first of the next round, and **previous** follows what was really played; turning it off keeps the current track and goes on in the list's order
- [ ] **Repeat**: off, one track, the whole list; the state is kept per list and shown on the buttons
- [ ] **Keys**: `Space` play and pause, `N` / `P` or `Ctrl+→` / `Ctrl+←` next and previous (to be chosen), `S` shuffle, `R` repeat; and the **media keys** of the keyboard and the operating system's controls through the Media Session API (`navigator.mediaSession`: title, artist and cover shown there, play, pause, next, previous; to check on Linux whether Electron needs the `MediaSessionService` feature switched on)
- [ ] The player keeps playing while the user works in other tabs (as `MediaView` already does), and a **now playing item in the status bar** (the track, play and pause, next) takes the user back to the list
- [ ] A **video** list plays the same way in the tab's video area; a list may mix sounds and videos
- [ ] Tests: the parser on hand-made lists (extended and simple, commas in titles, a missing duration, a title with non-ASCII letters, Windows paths and `\` separators, `%20`, a BOM, CR only, an `#EXTINF` with no track after it, a streaming manifest), a **byte-for-byte round trip** of a list that was not edited, the shuffle (each track once per round, no repeat at the seam, previous follows the history, a list of one), and an end-to-end spec with short synthetic WAV files (`fixtures/audio.ts`) that checks the sequence, the end of a track moving on, shuffle, repeat and a missing track skipped

Group 2: editing and creating (medium)
- [ ] **Edit a list in its table**: add tracks (the file picker, a drag from the tree, and **Add to Playlist** in the right-click menu of a sound, a video or a folder: a folder adds its media in the order of the tree, and a folder with sub-folders asks whether to go in), **remove**, **reorder** by dragging a row or with the keys (`Alt+↑/↓`), sort by name, title, artist or duration, **remove the tracks that are not found**, remove duplicates, edit the title and the artist of a row (an `#EXTINF` line), with **undo and redo**
- [ ] **Save and Save As…** through the safe path of the application (temporary file, rename, version check; a changed file asks), as `.m3u8` by default and as `.m3u` on request; the paths are written **relative to the folder the file is saved in** (a choice in the dialog: relative or absolute); the tab has the dirty mark, asks before it closes, and keeps a draft for the next start like the other editors; a list in a ZIP is saved into the ZIP (a text entry is edited there today)
- [ ] **New Playlist** (File ▸ New Playlist): a list that exists only in the window, like a new text, kept between starts as a draft until Save As gives it a file; and a **queue**: **Play Next** and **Add to Queue** in the right-click menu of a sound or a video fill the queue (a list that is not saved), which can be saved as a playlist
- [ ] **Play a folder** (right-click ▸ Play Folder, and Shuffle Folder): a list made on the spot from the media of the folder, not saved unless asked
- [ ] Open the list as text and edit it there: the text editor and the table are two views of one buffer (as the CSV's table and text are), so a change in one is the other's

Group 3: what a player shows (medium)
- [ ] **Title, artist, album, duration and cover** read from the files themselves when the list has none: ID3 of an MP3, the comments of FLAC and Ogg, the atoms of MP4/M4A, the picture of each, read from the first bytes of the file (`fb:read-range`) in the background, a few files at a time, only for the rows in view, cancelled when the tab closes; a small parser of our own for the common cases, or `music-metadata` (MIT, large: to weigh)
- [ ] The **total duration** and the number of tracks shown for the list; the cover of the current track in the player
- [ ] A **column chooser** and sorting by any column, remembered

Group 4: other playlist formats (later, each its own item)
- [ ] Read **PLS** and **XSPF** (and WPL and ASX) and **save as M3U8**; **CUE** sheets (one audio file split into tracks) are a separate idea
- [ ] The installers do **not** register `.m3u`/`.m3u8` as the application's own types (other players own them); Open With… and a double click inside the application are enough

Performance
- [ ] A list of tens of thousands of tracks: a **virtual list** (only the rows in view are drawn), the state of a file found out in batches for the rows in view first (one IPC call for many files, never one per row), the metadata read lazily with a limit on how many at once, shuffle and the "once per round" order made in one pass (O(n)), saving without drawing; the next track's token is asked a moment before the end so that the change is quick (gapless play is **not** planned: the `<audio>` element leaves a short gap)
- Not planned: streaming from web addresses (privacy), gapless or cross-fading, an equaliser or visualiser, a library of the user's music (a database of tags), downloading, a tag editor

Decisions to make before this is started
- **Default**: a double click on a `.m3u`/`.m3u8` opens the playlist view (with Open as Text in the menu), or the text editor as today?
- **The player**: in the playlist's tab only, or also a persistent **now playing** control in the status bar that follows the user into other tabs (the recommendation)?
- **Web addresses** in a list: listed and never played, or an opt-in setting to play them later?
- **Paths written**: relative to the file by default (the list keeps working when the folder is copied), with an absolute choice?
- **Metadata**: a small parser of our own (ID3, FLAC, MP4) or `music-metadata`?
- **Order**: group 1 (reading and playing), then group 2 (editing and creating), then 3, and 4 only if asked?

## Packaging, platforms and the release
- [ ] Try the app on **Windows and macOS** (Trash, Open With…, the chooser, icons, packages): everything so far was tried on Linux only
- [ ] Pictures of the application on Windows and macOS for the guide (today only Linux)
- [ ] Try the `.exe` on a Windows machine, and the `.dmg` on a Mac (built and checked, never started by the author)
- [ ] Sign the files (Windows code signing, macOS Developer ID and notarisation, GPG for the `.deb` and `.rpm`): `docs/RELEASING.md`, "Signing"
- [ ] Mark v0.1.0 and v0.1.1 as superseded on their release pages

## Ideas for later
- Hidden attribute of Windows (today only names that start with a dot)
- ZIP64 and other encodings than UTF-8
- Search inside files (see "Text tools", group 5); a terminal here
- External subtitles (`.srt`, `.vtt`) beside a video; a playlist that survives closing the tab (see "Playlists")
- Password protection and `.wsnpx` from `docs/VIEWER-GUIDELINES.md`

# Delivered, by phase (the history)

## Phase 0: scaffold
- [x] Repository `folder-browser` started from WSNP Viewer 0.1.0; renamed (`fb-ui://`, `window.fb`, `fb:` channels, appId); the prototype removed
- [x] `npm ci`, lint, typecheck, unit tests, build and the workbench and snapshot e2e specs pass
- [x] Support files: `CLAUDE.md`, `README.md`, `README.pt-BR.md`, `CHANGELOG.md`, `TODO.md`, `docs/ARCHITECTURE.md`, `.editorconfig`, `.nvmrc`
- [x] New icon (`build/icon.svg`, `build/icon.png`, `build/icons/*`, `public/icon.svg`): concept C2 chosen by the developer: folder with a zipper, a page, a pencil, play and the lens
- [x] `asantos43/folder-browser` created on GitHub (private) and `main` pushed
- [x] `docs/USER-GUIDE.md` and `docs/USER-GUIDE.pt-BR.md` rewritten for Folder Browser (phase 2); `docs/UI-DESIGN.md` (the table of what each part becomes), `docs/DEVELOPMENT.md`, `PRIVACY.md` (en and pt-BR) and `SECURITY.md` brought up to date. `docs/RELEASING.md` has nothing of the viewer that is wrong, but is untried (no release was made yet)
- [x] Screenshots for the user guide and the README: `npm run screenshots` (`scripts/screenshots.ts`) drives the real application over a synthetic folder (`scripts/demo-folder.ts`, also what to open to look at the app: `node scripts/demo-folder.ts`) and writes `docs/images/*.png`; both guides show them. The windows are 1280×800 in Light+ (and one in Dark+); pictures of Windows and macOS are still to take
- [x] `npm run notices` (`THIRD-PARTY-NOTICES.md`) after the new dependencies come in

## Phase 1: browse
- [x] Open a folder or a `.zip` (dialog, drag and drop, command line, a file's folder); the interface names a root by an id and a relative path, and `core/fs/guard.ts` refuses `..` and links that leave it
- [x] Lazy tree of a folder (`core/roots.ts`, `ExplorerTree`), a ZIP expands as a folder (also nested, `a.zip!/b.zip!/c`)
- [x] Switch to show hidden files (`Ctrl+H`, the side bar, the status bar and Settings; kept), for disk and ZIP entries (`core/fs/hidden.ts`)
- [x] Read-only views of text, picture, PDF, Markdown, fonts of a folder or a ZIP; a ZIP also as a list with Extract (context menu: Open as List)
- [x] The desktop file also takes `inode/directory` and `application/zip`

## Phase 1b: `.wsnp`
- [x] A `.wsnp` in the tree is a file like the others, viewed as the page it represents: a click previews it (italic tab), a double click or Enter keeps it in a tab of its own; no list of open snapshots and no side bar for it; "Open as ZIP" lists its entries (`fb:open-in-root`, `RootRegistry.diskFile`); the Open Snapshots section shows only while one is open
- [x] Same behaviour as WSNP Viewer: it is the same code (a snapshot opened from the tree is opened like one from the picker: integrity, signature, Print, Save as PDF, Find, zoom); the inherited specs pass

## Phase 1c: right-click menu and Open With…
- [x] The right-click menu of the tree by kind of row (`src/workbench/treeMenu.ts`, pure and tested): folder, file, ZIP, `.wsnp`; entries in a ZIP get the file menu
- [x] Several rows selected: the menu of marked rows has Cut, Copy, Move to…, Delete and Compare Selected (see "Several rows and the file clipboard" below); Extract of several rows is not there yet
- [x] **Open With…** on every file, with the installed applications (`core/apps.ts`, `OpenWithDialog`); a read-only copy for entries in a ZIP; also **Open with Default Application**, Show in Folder, Copy Path, Copy Name and Properties

## Phase 1d: places and favourites
- [x] "Places" section above the tree: Home, Desktop, Documents, Downloads, Music, Pictures, Videos (`app.getPath`), Trash, Computer, mounted volumes (`core/places.ts`, `PlacesView`)
- [x] Recent Folders (last 10 folders and ZIPs, can be cleared) and Favourites (add from the folder's context menu or by dragging a folder onto them; reorder and remove; `core/favorites.ts`)
- [x] Trash (`core/trash.ts`): browse, Restore (never over what is there), Empty Trash (asks first: `ConfirmDialog`) on Linux and macOS; opens the system Recycle Bin on Windows (not tried: no Windows machine here)
- [x] A click on a place opens that folder as a root (the interface names roots by id; the main process never opens one on its own)

## Phase 1e: media playback
- [x] `mediaKind` in `core/filekind.ts` (video or audio, by type or name); `MediaView` with the browser's own player (play/pause, seek, volume, speed, full screen), Repeat, Next/Previous through the media files of the folder, a sound that ends goes on to the next, Media Session keys; the player keeps playing when another tab comes to the front
- [x] `fb-media://<token>/` protocol with Range (`core/media.ts`, reuses `parseRange` of `core/serve.ts`), by an unguessable token the main process gives for a file of a root; `media-src fb-media:` in the CSP
- [x] Entries of a ZIP are played from a temporary copy (`core/stage.ts` with `maxBytes`, up to 2 GB; removed when the tab closes and at quit); streaming stored entries straight from the ZIP is left for later
- [x] Formats the Chromium cannot play (HEVC…) say why and offer Open With… and Save As
- [x] Tests: Range server (206, 416, HEAD), tokens, `MediaView`, a synthetic `.wav` in e2e (plays, seeks, goes on in the background, from a ZIP, broken file)
- [x] A snapshot's own media plays too (by the type its manifest declares; a link to it in the page opens a tab); Previous/Next are not offered for it
- [x] The open-snapshot mode is gone (the list, the side bar with the files of a snapshot, Information and Integrity, `asFile`): a snapshot is a page in a tab; its inner files open from the links of the page, the metadata and Go to File; WSNP Viewer (Open With…) is for anything more

- [x] Order the files of a folder by name, date or size (button and View menu), with the size and the date on each row

## Phase 1m: hexadecimal view and spreadsheets
- [x] `core/hex.ts` (rows, search patterns, header identification, search through a file by blocks, scroll metrics for files of any length), `HexView` (virtual rows, selection, copy, Go to offset, Find), `fb:read-range` for big files of a folder, `viewKind` `hex` for programs and the like, "View as hex" on every file that is not shown
- [x] "Open as Hex" in the right-click menu of any file: a tab that says how it is shown (`Tab.as`, `hexKey`), kept in the session; "View as hex" opens the same tab
- [x] Office documents with ready-made libraries (looked for first; TabularJS and SheetJS were tried and left out): docx-preview (docx), pptx-renderer (pptx), odr-core (odt, ods, odp, odg, xlsx, xls, doc, ppt), each in a sandboxed `fb-doc://` frame (`core/docs.ts`, `electron/doc-protocol.ts`, `src/docs/`, `DocumentView`)
- [x] CSV and TSV as a table, with a Table / Text switch (`core/csv.ts`, `CsvView`)
- [x] Zoom, Find (`Ctrl+F`) and Print inside a document's frame; zoom and `Ctrl+F` for the bytes of a file; Open With… in the toolbars of documents, bytes, tables and cards; View as hex in the toolbar of every text; `.log` as text up to 32 MB
- [x] A document's tab keeps its drawing when another tab comes to the front (drawn on first view, kept hidden but laid out)

## Phase 3b: tables (CSV and TSV)
Feasibility checked on 2026-10-06 (developer's request). Tried: `sql.js` 1.14 (SQLite compiled to WebAssembly, MIT; 46 KB of script and a 658 KB `.wasm`) ran `WHERE`, `ORDER BY`, `LIKE`, arithmetic, `COUNT`/`SUM`/`AVG` on a table made of CSV rows, and a query over 200,000 rows took 37 ms in Node. Rejected: **AlaSQL** (MIT) compiles every query with `new Function`, which the interface's policy forbids (`'unsafe-eval'` is never allowed), and has had prototype-pollution reports; **DuckDB-Wasm** is 149 MB unpacked.
- [x] **Search** the table (`Ctrl+F`: cells marked, next/previous), **sort** by a column (number, ISO date or text, found from the values; up, down, file order; the file is not changed) and **filter** by column (contains, equals, starts/ends with, empty, comparisons, or the distinct values to tick). No dependency; a virtualized table of fixed-height rows (`TableView`: 100,000 rows scroll; up to 500,000 rows and 500 columns; `core/table.ts`)
- [x] A **header row** switch and the **types** found from the values (`inferTypes`: number, date, text)
- [x] A **query box** (`core/sqlTable.ts`, `src/workers/sql.worker.ts`, `SqlSession`): one `SELECT`/`WITH` on the table `t` run by sql.js in a worker, `PRAGMA query_only = ON`, 100,000 rows back at most, 10-second limit (the worker is ended); the result replaces the rows shown (Show All Rows) and **Export Result** saves it as a CSV
- [x] **Edit cells in the table** (`core/csvEdit.ts`, `TableEditView`): in place with Enter, F2, typing or a double click; add and delete rows and columns (toolbar and right-click menu); undo and redo; every edit is a transaction on the editor's buffer at the span of the cell, so the dot, Save, the disk check, line endings, the byte order mark, drafts and the Text view are the editor's, and the rest of the file stays byte for byte

## Open points of phase 1 (to pick up between phases)
- [x] The pull requests: phases 1 to 1p were one line of history, merged into `main` as one pull request (#5). The CI jobs of GitHub could not start (billing of the account): the checks were run on the developer's computer
- [x] **GitHub Actions** only for the macOS `.dmg` (`release.yml`, started by hand: unit tests, packaging smoke test, adds the `.dmg` and its checksum to the release); no CI on pull requests (the free quota is spared). Not yet tried: it needs the account's billing fixed, and a release to add to

## Phase 2: change files on disk
- [x] `core/fs/names.ts` (what a name may be; Windows rules on Windows) and `core/fs/ops.ts` (`createEntry`, `renameEntry`, `moveEntry`, `removeEntry`): never replace (a file is hard-linked to its new name, which fails if it is taken), never leave the root (the parent is resolved, so a symbolic link is renamed, moved or removed as the link), never put a folder inside itself, nothing inside a ZIP; `RootRegistry` lets go of the ZIPs it had read
- [x] Create file and folder (a field in the tree, from the header buttons, the menu of a folder and the empty part of the tree), **rename** (`F2` or the menu, in the row, the name without its extension selected), **move** (Move to… with a folder picker, and drag and drop onto a folder or onto the empty part), **delete** (`Delete` or the menu, asks; to the trash, and for good only when the trash refused and the user said yes again)
- [x] Open tabs follow a renamed or moved item (key, path, place, preview, pin, zoom, and the bytes tab of it) and close with a deleted one; the tree reads again without taking its rows away
- [x] Tests: path traversal, symbolic links out of the root, move onto an existing name, move a folder into itself, names (unit); the tree's field, menu, keys and drops (component); the whole flow in the real app (e2e `fileops.spec.ts`)
- [x] Several rows selected (Ctrl/⌘+click, Shift+click, Shift+arrows, Ctrl+A) to move, copy, delete, cut, paste and compare at once; extract at once is still to do
- [x] Copy by dragging with Shift (also a duplicate in the same folder; numbered, never replacing); Shift+Delete for the permanent delete; folders that open while an item is dragged over them
- [x] Copy, cut and paste (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`; ⌘ on macOS) of files and folders in the tree and in the right-click menu; pasting a copy where it came from is a duplicate (numbered)

## Several rows and the file clipboard (between phases 5 and 6)
- [x] The tree marks several rows: **Ctrl/⌘+click** toggles one, **Shift+click** marks a range from the last row clicked, **Shift+arrows** extend it, **Ctrl/⌘+A** marks every row on screen, **Esc** or a plain click lets them go; a Ctrl or Shift click only marks (nothing opens); marks go with their row (`src/workbench/selection.ts`, `ExplorerTree`)
- [x] An action on a marked row is on all of them, once, and what is in a marked folder is left out (`topmost`): **Delete** and `Shift+Delete` (one question, one notice; the ones the trash cannot take are asked about again, for good), **Move to…** (`MoveDialog` takes the list), dragging (the marked rows go together; Shift copies; a file dragged with others is not a file for the editor), and **Compare Selected** for two text files; the menu of marked rows says how many
- [x] **Cut, Copy and Paste** (`Ctrl/⌘+X`, `+C`, `+V`, and in the menu of a file, a folder, marked rows and the empty part of the tree): the application's own clipboard (`src/workbench/fileClipboard.ts`); Paste goes into the folder (or ZIP file) that has the focus, next to the file that has it, or into the root; a paste of a copy is numbered, a paste of a cut is a move and is done once, and what was cut is dimmed; in a ZIP it works inside the same ZIP; the macOS Edit menu has Cut, Copy and Paste
- [x] Tests: `selection.test.ts`, the tree (marks, keys, menus, drag and drop, the clipboard), `MoveDialog.test.tsx`, the real app (`e2e/multiselect.spec.ts`)

## Phase 3: editor
- [x] Editable CodeMirror 6 with the language modes (`EditView`, `editableExtensions`); the dot on the tab; `Ctrl+S` / Save All; the question when tabs or the window close with changes; binary, non-UTF-8 and over-5-MB files are shown, not edited, with the reason
- [x] Atomic save (temporary file and rename, permissions kept) and the check of time and size against the disk (Overwrite / Load from Disk); line endings and byte order mark kept (`core/fs/edit.ts`)
- [x] Format Document (undoable); Save As… of the text on screen; the text of a renamed tab goes with it
- [x] Edit the CSV and TSV **table** (cells), with sorting, filtering by column and value, search and a SQL query: see "Phase 3b" below

## Phase 3a: unsaved changes kept, and editing bytes
- [x] Drafts (`core/drafts.ts`, `fb:draft-*`, `src/state/drafts.ts`): the changes of a text or hex tab are kept in the app's folder a moment after typing, restored at the next start as modified tabs, removed on save, reload or close; the window closes without asking; Settings ▸ Keep changes that are not saved
- [x] Edit the bytes in the hex view (`core/hexEdit.ts`, `HexEditView`, `HexView` editing): overwrite by digit or character, Insert, Delete, Backspace, add at the end, undo and redo, Save with the atomic write and the disk check, drafts of bytes

## Phase 4: diff
- [x] Select two text files with **Select for Compare** and **Compare with Selected** in the tree's menu (as VS Code), including entries in a ZIP and files of two different open folders; the tab follows a rename of a side and closes when a side is deleted or its folder closed (`core/diff.ts`, `open-diff` in `src/state/workspace.ts`)
- [x] `@codemirror/merge` in `DiffView`: side by side and in one column, with the colours of each file's language and of the theme; changes counted, Previous / Next Change (`F7`, `Shift+F7`), Swap Sides, Collapse Unchanged; line endings are not compared (and the toolbar says when they differ); files that are not UTF-8 text, or over 5 MB, are refused with the reason
- [x] **Drag to compare**: a text file of the tree dropped on another text file, or a tab dropped in the middle of another text tab, asks **Open Side by Side**, **Compare (Diff)** or Cancel (`ChoiceDialog`); a drop on a folder, a file that is not a text, or with Shift (a copy) is as before
- [x] **Two editor groups** (`Tab.group`, `Workspace.focus` / `other`, `move-to-group`; `src/state/groups.ts`): a tab can be split to the right (tab menu **Split Right**, **Move to Left / Right Group**), or dragged, or a file of the tree dragged, to the right half of the editor (with two groups: to the one the pointer is over); each group has its own tabs, tab in front, Find, language and print; the second ends when it has no tab; the layout is kept for the next start
- [x] A text file of the tree (or a tab) dropped on the middle of the editor or of a text tab asks Open Side by Side / Compare (Diff); the sides still open in the group on that side
- [x] Some unit tests (`HexEditView`, `DiffView`, the About window) failed at random when the whole suite ran under load: the wait of the component tests is five seconds (`src/test/setup.ts`)
- [x] Ctrl+click to select two rows of the tree and **Compare Selected** in their menu

## Phase 5: edit inside a ZIP
- [x] `core/archive/edit.ts`: `create`, `replace`, `mkdir`, `remove`, `move` (rename) and `copy`; one rewrite for many operations, into a temporary file next to the ZIP, then renamed over it (the old ZIP is looked at again before the rename); ZIP in a ZIP taken out, changed and put back; the entries it did not touch are copied as they were (method, date, mode, order)
- [x] Edit and save a text entry (`FileVersion.crc32`: the entry is compared by size and CRC-32, another entry changing is not a conflict); create, rename, move, copy and delete entries and folders from the tree (menu, `F2`, `Delete`, drag, Shift-drag, Move to…), also in a ZIP opened as the root and in a ZIP in a ZIP; the tabs follow
- [x] ZIP64, encrypted entries, other methods, names that could leave a folder, repeated names and over 100,000 entries stay read-only and say why; a `.wsnp` is never changed inside; no move or copy between the disk and a ZIP or between two ZIPs; the delete of an entry is permanent and asked at once (a ZIP has no trash)
- [x] Tests: the operations, hostile and read-only ZIPs, nested ZIPs, a change by someone else, permissions, big entries (`core/archive/edit.test.ts`); the registry with paths in ZIPs, links that leave the root, the trash, the queue (`core/roots.test.ts`); the tree, the menu, the move dialog; the real app (`e2e/zipedit.spec.ts`)

## Phase 6: finish
- [x] README, CHANGELOG, user guides (en and pt-BR) with pictures, the guide inside the application (Help ▸ User Guide, `F1`)
- [x] The About window's **User guide** link opens the bundled guide in a tab
- [x] Packages: `.deb`, `.rpm`, `.exe` built on the maintainer's computer and `.dmg` by the macOS workflow, all through `npm run package:smoke`; the `.rpm` installs on a clean Fedora (container) and next to WSNP Viewer
- [x] First release: **v0.1.2** (v0.1.0 and v0.1.1 are published without a `.dmg`: the unit tests failed on a Mac, then the `.icns` lacked two sizes)

## A new text in the window (after 0.1.2)
- [x] File ▸ New Text File (`Ctrl+N`): an Untitled-N tab with its text only in the window; Save As…; asks before it closes; compared (Select for Compare / Compare with Selected on a tab) or put beside a file (Split Right)
- [x] Drag a new text's tab onto the middle of a file's tab or editor (the compare / side by side question of two texts), and a file of the tree onto it; kept for the next start (a draft)

## Passwords
- [x] A PDF with a password asks for it (pdf.js `onPassword`)
