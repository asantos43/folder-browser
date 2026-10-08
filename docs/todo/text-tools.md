# TODO: Text tools (from Notepad++)

Part of the plan in [`TODO.md`](../../TODO.md) (the index, the performance rule and the roadmap). Open work of this area; what was delivered is in [`history.md`](history.md).

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
- [ ] **Document map**: the **minimap** is its own item, "A minimap" in `docs/todo/text.md`; and a **function list** (from the syntax tree of the language: each language needs its own list of nodes)
- [ ] **Macros** (record and play back a run of commands, save with a name) and a **clipboard history**
- [ ] **Open in a browser** for an HTML file, **file summary** (lines, words, characters, bytes) and a word count of the selection
- Not planned: plugins with full trust or with Node (a safe extension system is planned: see "Extensions"), the Run menu, FTP, spell checking

Decisions to make before this is started
- **Keys**: VS Code's where they exist (the app is styled after it), Notepad++'s where free (`Ctrl+U` / `Ctrl+Shift+U` for lower and upper case), and a place for the user to choose their own later?
- **`Ctrl+H`** is Show Hidden Files here (the file manager's key): Replace opens as the second row of `Ctrl+F` and gets another key (`Ctrl+Alt+F`?), or does `Ctrl+H` become Replace while the editor is in front?
- **With no selection** an operation acts on the whole document (undo brings it back, a notice says what was done): or should it ask first for the destructive ones (sort, remove duplicates)?
- **Where they live**: Edit submenus, the editor's right-click menu and the palette, in the editors of files and of a new text; the diff and the read-only views get none
- **Order**: group 1, then 2, then 3 and 4, and 5 as its own project: or Find and Replace first?
