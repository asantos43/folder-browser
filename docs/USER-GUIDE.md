# User guide

Folder Browser looks at the folders on your computer and at what is in them. It opens **folders and ZIP files** as trees, shows **text, pictures, PDFs, office documents, tables, videos, sounds and the bytes of any file**, and **makes, renames, moves, edits and deletes** files and folders, in a folder or inside a ZIP file. It also opens **`.wsnp` files** (web pages saved by the [PageKeep](https://github.com/asantos43/webpage-snapshot) extension) as the pages they are. [Português do Brasil](USER-GUIDE.pt-BR.md).

## Opening a folder

![Folder Browser with the folder Meadow Times open: the tree on the left, a Markdown file on the right](images/workbench.png)

- **File ▸ Open Folder…** (`Ctrl+Shift+O`, `⇧⌘O` on macOS), or **drag** a folder, a ZIP file or any file onto the window, or name one on the command line.
- A **ZIP file** opens as a folder, also a ZIP inside a ZIP. The folder picker of **Open Folder…** chooses folders only on Linux and Windows (as those systems' dialogs cannot choose both), so a ZIP file is opened with **File ▸ Open ZIP File…**, the **zip icon in the activity bar** (the column of icons on the left, under Open Folder), the zip icon of Open Folders, or the **Open ZIP File** button when no folder is open); on macOS **Open Folder…** takes either. A file that you name on its own opens in a tab, with its folder opened beside it.
- **File ▸ Open File…** (`Ctrl+O`) asks for a file; the installers register `.wsnp` and `.zip` with the application, so a double click in the file manager works too.
- When the application starts with nothing to open it **opens again what was open** (the folders and the tabs, in the same order, with the same tab in front): **Settings ▸ Reopen the files that were open**; turn it off and nothing is kept.
- The folders open are listed in **Open Folders** in the side bar; the × next to one closes it and its tabs.

## The window

It is laid out like Visual Studio Code: a **title bar** with the menu, an **activity bar**, a **side bar**, **tabs** with the path under them, the file in the middle, and a **status bar**. `Ctrl+B` hides and shows the side bar; drag its edge to resize it.

- When there are more **tabs** than fit, a thin **scroll bar** shows under them (as in VS Code): drag it, or turn the mouse **wheel** over the tabs, to move along them; the tab that comes to the front is always brought into view.
- The **arrows** of the title bar are **Go Back** and **Go Forward** through the tabs you visited (`Alt+Left`, `Alt+Right`).
- The **box in the middle** is **Go to File** (`Ctrl+E`): part of a name finds a file in the **open folders and ZIP files** (every file of the tree, at any depth, except what is in `node_modules` or `.git` and, unless hidden files are shown, what starts with a dot) and in the open snapshots; with nothing typed it lists your tabs, the latest first. It works whenever something is open; a click on the box or `Ctrl+E` opens it. Type `>` (or press `Ctrl+Shift+P`) for the **command palette**, which has every command that can run now and the colour themes.

### The side bar

- **Places**: Home, Desktop, Documents, Downloads, Music, Pictures, Videos, **Trash**, Computer (the ones this computer has), the **Favorites** you pinned, the **Recent Folders** and the mounted **Devices**. A click opens that folder as the tree. Pin a folder with **Add to Favorites** in its menu, or drag a folder onto the Favorites; move them up and down, remove them from their own menu. **Clear Recent Folders** is in the menu of that list.
- **Files**: the folder you chose, as a tree that reads one level at a time (a folder of a hundred thousand files is not read until you open it). A **click** opens a **preview tab** (its name in italics) that the next click replaces; a **double click** or `Enter` **keeps** it. On a **folder** (or a ZIP file), a click on its **name** selects it and opens it if it was closed, but never closes it; the **arrow** to its left opens and closes it, and a **double click** on the name leaves it in the opposite state to the one it had before. Arrow keys move, `→` and `←` open and close, and typing jumps to a name.
- The icons of the Files header: **New File…**, **New Folder…**, **Sort** (by name, date or size, up or down; folders stay first), **Show Hidden Files** (`Ctrl+H`) and **Refresh**. Each row shows the size and the date it changed, small and to the right: with little room the one the order is by, with a wide side bar both.
- **Hidden files** (a name that starts with a dot) are listed but shown only when you ask: the eye, **View ▸ Show Hidden Files** or **Settings**. The same goes for the entries of a ZIP.
- The **Trash** place opens your system's trash as a folder (Linux and macOS): **Restore** puts an item back where it was (never over something that is there now) and **Empty Trash** deletes them for good after asking. On Windows it opens the Recycle Bin.

### The right-click menu

![The right-click menu of a text file](images/context-menu.png)

The menu of a row depends on what it is. A folder: expand, refresh, **Open as Explorer Root**, **New File…**, **New Folder…**, **Rename**, **Move to…**, **Delete**, add to Favorites. A ZIP file: expand, **Open as List**, **Open as Explorer Root**. A `.wsnp`: **Open** (its page) or **Show Contents**. A file: **Open** (or **Play**); a text file also **Select for Compare** (and, once another is chosen, **Compare with Selected**). **For every file**: **Open as Hex**, **Open With…**, **Open with Default Application**, **Save As…**, **Show in File Manager**, **Copy Path**, **Copy Name**, **Properties**.

**Open as Explorer Root** (on a folder or a ZIP file of the disk) makes that folder the **root of the Files** area of the Explorer: it is opened as a folder of its own (it is added to **Open Folders**, and the one you were in stays there) and the tree starts in it, so a deep folder can be worked in without its parents above it. The row of the folder in **Open Folders** takes you back.

**Open With…** asks your system which application should open the file (Windows' dialog, macOS's chooser, and on Linux a dialog of the application's own, with the applications registered for the type first, then all the others, a search box and **Always use for this file type**). The application is given a **read-only copy** in your temporary folder, removed when the application quits. A kind of file that can run as a program (`.exe`, `.bat`, `.sh`, `.desktop`, `.jar`…) is never handed over: use **Save As…**.

## Making, renaming, moving and deleting

![Renaming a file in its row of the tree](images/rename.png)

These work on the files and folders of a folder you opened, and on what is inside a ZIP file (see "Inside a ZIP" below); not in the Trash place.

- **New File…** and **New Folder…** (the icons of the Files header, the menu of a folder, or the empty part under the tree for the root) put a field in the tree: type the name and press `Enter` (`Esc` gives up). The new item is made in the **last row you have marked**, else in the **row you clicked last** (a folder or a ZIP, the folder itself; a file, the folder it is in; `Esc` or a click on the empty part lets the row go), else in the folder of the **file open in the tab on screen**, else in the **root** — never in the row the keyboard focus happens to be on. The field shows where it will go: "New folder in `<name>`" (or "New file in `<name>`"), or "New folder in the root" when the target is the root.
- **Rename** (`F2`, or the menu) edits the name in its row, with the name without its extension selected. `Enter` renames; `Esc`, or leaving the field, gives up.
- **Move to…** opens a picker of the folders of the root; a folder is never offered itself or what is in it, nor the folder it is in. **Drag** a row onto a folder, or onto the empty part under the tree (the root) to move it there; a file dropped on a file goes to the folder that file is in. A closed folder **opens by itself** when you hold the item over it for a moment, and so on down, so you can reach a deep folder in one drag. Press **Shift** while dragging (before you drop) to **copy** instead of move: the pointer changes, the original stays, and a copy that would have the same name is numbered (`a (2).txt`), so dropping with Shift on a row of the folder an item is in makes a duplicate. Nothing is replaced.
- **Delete** (`Delete`, or the menu) asks, and moves the item to the **trash** (a folder with everything in it). To delete it **permanently** instead, press **`Shift+Delete`**, or hold **Shift** while you choose **Delete** in the menu, or while the question is on screen: it changes to "Delete permanently?" and back when you let go. That cannot be undone. If the trash cannot take an item, you are asked again whether to delete it permanently.
- **Nothing is ever replaced.** A name that is taken is refused, in words, and the field stays so you can type another. A name that no file can have (empty, `.` or `..`, with `/` or `\`, control characters, over 255 bytes; on Windows also `< > : " | ? *`, the names the system keeps such as `CON` or `NUL`, and a name ending in a space or a dot) is refused before anything is asked. A folder is never moved into itself. Nothing leaves the folder you opened: a symbolic link is renamed, moved or deleted as the link, never what it points to.
- The **tabs follow**: the tab of a renamed or moved file (or of a file in a renamed folder) keeps its place, its zoom and its preview, with the new name, and the tab of a deleted item closes.

## Several rows, Cut, Copy and Paste

![Three rows marked, and the menu for all of them](images/multiselect.png)

![Move to… for the marked rows](images/move-dialog.png)

![Rows that were cut are dimmed; Paste is in the menu of a folder](images/clipboard-menu.png)

- **Mark several rows** in the tree: **Ctrl+click** (`⌘+click` on macOS) marks or unmarks a row, **Shift+click** marks everything from the row you clicked last to this one, **Shift+↑ / ↓** (also `Shift+Home` / `End`) extends the marks from where they began, and **Ctrl+A** (`⌘A`) marks every row on screen. The marked rows are highlighted. A click with Ctrl or Shift only marks (nothing opens). A plain click, a plain arrow or **Esc** lets the marks go, and a mark goes with its row (when it is deleted or its folder is closed).
- **An action on a marked row is on all of them**, once: **Delete** (one question for all; `Shift+Delete` asks for the permanent delete), **Move to…** (one folder picker), **dragging** one of them onto a folder (they go together; with **Shift** held they are copied), and, for exactly two text files, **Compare Selected**. The right-click menu of a marked row is for all the marked rows and says how many. If a folder and something in it are both marked, only the folder is acted on. When something cannot be done to some of them, one message says how many and what went wrong first; the rest is done. This works inside a ZIP too.
- **Cut, Copy and Paste** (`Ctrl+X`, `Ctrl+C`, `Ctrl+V`; `⌘X`, `⌘C`, `⌘V` on macOS; also **Cut**, **Copy** and **Paste** in the right-click menu of a file, a folder, marked rows and the empty part of the tree) work on the files and folders of the tree: on the marked rows, or on the row that has the focus. **Paste** puts them in the folder (or ZIP file) that has the focus, next to the file that has it, or in the top folder. A pasted **copy** is numbered when the name is taken (`a (2).txt`), so Copy and Paste in the same folder makes a duplicate, and nothing is ever replaced; a pasted **cut** moves them, once, and the rows that were cut are dimmed until then. The clipboard is the application's own (it does not touch the system's), it works in the folder that was opened and inside one ZIP, and between two open folders, or between a folder and a ZIP, it says it cannot yet. In a name field and in the editor the keys are the usual ones.

## What a tab can show

| File | What you get |
| --- | --- |
| Source, text and data: HTML, CSS, JavaScript, TypeScript, JSON, XML, YAML, TOML, INI, `.env`, shell, SQL, Dockerfile, and source in Python, C, C++, C#, Java, Kotlin, Scala, Go, Rust, Swift, Dart, PHP, Ruby, Perl, Lua, R, Groovy, Haskell, Julia, Clojure, Erlang, Pascal, PowerShell, CMake, Diff, Protocol Buffers, SCSS, Sass, Less, plain text | Source with colours and line numbers. A text file **of a folder you opened is edited** (see "Editing text"); a text file of a snapshot, or one that cannot be edited, is read-only, and a minified or one-line HTML, CSS, JavaScript, JSON or XML file is then shown **laid out** (the toolbar's **Format** button shows it as saved; Save As always writes the file as it was saved). **Word Wrap** wraps long lines (`Alt+Z`). Both choices are kept and are in Settings too. Text over 5 MB is not opened in a tab; a **`.log`** opens up to 32 MB. |
| A file of a kind the application does not know | Shown as text when what it holds is text; otherwise as its bytes (hexadecimal). |
| Markdown (`.md`) | A **formatted page** (headings, lists, tables, code; a web link opens in your browser; a picture is not loaded and HTML inside is shown as text), with **Formatted / Text** buttons; **Full Width** and **Wrap Code**. |
| CSV and TSV | A **table** with sorting, filters, search, a SQL query and editing: see [Tables](#tables-csv-and-tsv). **Table / Text** buttons switch to the source. |
| Pictures | The picture with a **toolbar**: zoom out and in, a box (Fit, Fit Width, Fit Page, 25 % to 400 %…), actual size, **Save As…**. `Ctrl` and the wheel zoom around the pointer. |
| SVG | A picture at first, with **Image / Code** buttons for the source. |
| PDFs | The pages with selectable text, a toolbar with the same zoom, previous and next page, a box to go to a page. A PDF **with a password** asks for it in its tab: type it and press Open (a wrong one asks again); the password is used to open that file and is kept in memory for that version of it, so it is asked again only the next time the application starts (never saved on disk). Not yet: links and forms inside the PDF, and changing or removing a PDF's password. |
| Fonts | A sample at several sizes. |
| **Office documents**: Word (`.docx`), PowerPoint (`.pptx`), LibreOffice and OpenDocument (`.odt`, `.ods`, `.odp`, `.odg`), Excel (`.xlsx`, `.xls`), and the older `.doc` and `.ppt` | Drawn **as a page** by ready-made libraries (docx-preview, pptx-renderer and odr-core), in a frame that has no network and cannot reach the rest of the window, so a hostile file can at most draw itself badly. A workbook shows one sheet at a time, with a bar of sheet names. Up to 48 MB. Fonts the document asks for and the computer lacks are replaced, charts are approximate, and nothing animates. A file that cannot be drawn says why, with **Save As…** and **View as hex**. A drawn document is kept while you look at another tab. |
| **Bytes**: programs and libraries (`.exe`, `.dll`, `.so`, `.o`, `.class`, `.wasm`…), disk images, databases, and any file of an unknown type that is not text | **Hexadecimal view**: the offset, 16 bytes in hex (eight and eight) and the same bytes as text. Click a byte (`Shift`+click or the arrows to extend); `Ctrl+C` copies the bytes as hex (the toolbar also copies as text); **Go to offset** takes hex, `0x…` or `#decimal`; **Find** looks for bytes or text, forwards and backwards through the whole file (`Ctrl+F` goes to its box). The toolbar says what the header is (ELF, PE, Mach-O, Java class, ZIP, PDF, PNG, SQLite…) by reading it, never by running the file. A file of a folder of any size is read a window at a time. Any file can be opened this way: **Open as Hex** in the menu, or **View as hex** in the toolbar. |
| A video or a sound | **Played** in a tab with the browser's own player (play, seek, volume, speed, repeat, full screen for video, Previous and Next through the media of the folder; the system's media keys work; it goes on playing when another tab is in front). Also from a ZIP, and from a snapshot. What the browser cannot decode (HEVC…) is said, with **Open With…** and **Save As…**. |
| ZIP files | The **list of files** (see below). |
| A `.wsnp` | The **page it holds** (see below). |
| Anything else (a file that is too large) | A card with its name, type and size, and **Save As…**, **Open With…** and **View as hex**. |

**Open With…** and **View as hex** are in the toolbar of the document, the table, the bytes and every text, and on the cards.

In **Settings ▸ Files ▸ Open With commands**, choose **Add command**, enter a name and a program (an absolute path or a name in PATH), and enter **one argument per line**. Save, edit or remove commands there. They appear under **Your commands** in Open With and in its file context submenu, including `.wsnp` and ZIP entries. `{file}` is the absolute file path, `{dir}` its directory and `{name}` its basename. Spaces, quotes, `$`, `&`, `;` and `~` remain literal: do not add shell quotes around `{file}`. A filename starting with `-` is safe through `{file}` because its path is absolute; for `{name}`, add a separate `--` argument if your program supports it. The newline editor cannot enter an embedded newline or a sole empty argument; advanced argument values, optional `cwd` (absolute or `{dir}`) and `timeoutMs` can be set in settings.json.

Programs run with **your permissions**. Before the first run, a native dialog shows the complete literal program and arguments. Choose **Run** to launch or **Cancel** to do nothing. **Always for this command** remembers that exact program, argument list and working directory; changing any of them asks again. Importing settings asks for an extra safety confirmation and still requires this execution confirmation. No shell interprets the arguments unless you explicitly choose a shell program yourself. Your commands receive the original disk file; ZIP entries receive a read-only temporary copy (up to 256 MiB, executable names refused), removed when Folder Browser quits. As for every other application, the Open With dialog does not offer files whose names could run as a program (`.sh`, `.exe`…); the commands in the file context submenu do.

A few of the views, from the folder used for these pictures:

| | |
| --- | --- |
| ![A PDF](images/pdf.png) | ![A picture](images/image.png) |
| ![A sound in the player](images/media.png) | ![The bytes of a file in hexadecimal](images/hex.png) |
| ![A Word document](images/docx.png) | ![A spreadsheet](images/spreadsheet.png) |

## Editing text

![A text file with a change not saved: the dot on the tab and Modified in the toolbar](images/editing.png)

A text file of a folder you opened, or inside a ZIP, opens ready to edit, with the colours of its language, undo and redo (`Ctrl+Z`, `Ctrl+Shift+Z`), automatic closing of brackets, `Tab` to indent, and Word Wrap.

- **Save** with `Ctrl+S` (`⌘S`), the **Save** button of the toolbar, or **File ▸ Save**; **Save All** (`Ctrl+Alt+S`, `⌘⌥S`) writes every tab with changes. A tab with changes shows a **dot** where the × is (the × comes back when the pointer is over the tab), and the toolbar says **● Modified**.
- The file is written **whole and safely**: to a temporary file next to it, then renamed over it, with its permissions kept, so a crash or a full disk leaves the old file. Its **line endings** (LF, CRLF or CR, shown in the toolbar) and its **byte order mark** (UTF-8 with BOM) are kept, so a file you open and save without changing is the same bytes. A file whose lines end in a mix of styles is made uniform when you save.
- If the file **changed on disk** since you opened it (another program wrote it), Save does not write: it asks whether to **Overwrite** it with your text or **Load from Disk** (your changes are lost). Cancel leaves everything as it is.
- **Closing a tab** with changes asks **Save / Don't Save / Cancel**, also for Close All, Close Others and closing the folder; **closing the window** asks too, for all the tabs with changes. The changes, and the undo history, stay with a tab while you look at another one, and follow it if you rename or move the file.
- **Format Document** (HTML, CSS, JavaScript, JSON, XML) lays the text out for reading as an edit that **can be undone**. **Save As…** writes the text on screen to a file you choose. A formatted Markdown page or a CSV table of the same file shows what you have typed, saved or not.
- Only **UTF-8 text up to 5 MB** is edited. A file in another encoding, a binary file, a bigger file, the files of a snapshot and the files of a ZIP that cannot be rewritten (see "Inside a ZIP") are shown, not edited, and the toolbar says why.

- **Unsaved changes are kept.** What you typed (or changed in the bytes) stays in a draft in the application's own folder a moment after you stop. If you close the window or quit, nothing is asked: at the next start the tab comes back **with your changes, marked as modified**, and a message says so. Save writes it as usual (and still notices a file that changed on disk meanwhile). **Settings ▸ Keep changes that are not saved** turns this off: the window then asks Save / Don't Save before it closes, and drafts are deleted.
- **Editing bytes.** In a hex tab (any file: **Open as Hex**, or **View as hex** on a text), the **Edit** button makes the bytes editable. Click a byte and type **hexadecimal digits** (two to a byte; the changed bytes turn bold), or click the text column and type characters. **Insert** switches between overwriting (`OVR`) and inserting (`INS`); **Delete** and **Backspace** remove the byte or the selection; after the last byte you can add more. `Ctrl+Z` / `Ctrl+Y` undo and redo; **Save** works as for text. Only files of a folder up to 16 MiB are edited; bigger files and the files of a ZIP or a snapshot are only looked at.

## Tables (CSV and TSV)

![A CSV file as a table](images/table.png)

A CSV or TSV file opens as a **table** (**Table / Text** in the toolbar switch to the source; the choice is kept). The first row is the header and stays in view; the rows are numbered with their line in the file; the delimiter (comma, semicolon, tab, bar) is found by itself. Only the rows in view are drawn, so a file of hundreds of thousands of rows scrolls at once (up to 500,000 rows and 500 columns; said when cut).

- **Sort**: the arrow in a column's header sorts it up, then down, then back to the file's order. Numbers and ISO dates are sorted as such (the type is found from the values), text the way people sort it (`item 2` before `item 10`), and empty cells always last. Sorting never changes the file.
- **Filter**: the funnel in a header opens a panel with a condition (contains, equals, starts with, greater than, is empty… ) and a value, or the **distinct values of the column to tick**, with how many rows have each. Filters of several columns add up; **Clear Filters** shows every row again. The status says "2 of 4 rows".
- **Search**: `Ctrl+F` marks the cells that have the text, steps with Enter and `Shift+Enter`, and selects the cell it is on.
- **Header**: the **Header** button says whether the first row holds the names of the columns (off, the columns are A, B, C…).
- **Query**: the **Query** button opens a box for one SQL `SELECT` on the table, called `t`, whose columns are named by the header (`SELECT Kind, count(*) FROM t GROUP BY Kind`; a name with spaces goes in double quotes; `rowid` is the number of the row). Numbers compare as numbers, empty number cells are NULL. `Ctrl+Enter` runs it. The rows of the result take the place of the table (**Show All Rows** goes back) and **Export Result** saves them as a CSV. Only one statement, only a `SELECT` or `WITH`: nothing in the file is changed by a query, and one that runs over ten seconds is stopped. SQLite runs inside the application, in a worker; nothing is sent anywhere.
- **Edit cells** (a file of a folder): click a cell and press `Enter`, `F2` or just type; double click does the same. `Enter` keeps the text and goes down, `Tab` keeps it and goes right, `Esc` gives up, `Alt+Enter` starts a new line in the cell. `Delete` empties the cell. The header's names are edited the same way. **Add Row**, **Delete Row**, **Add Column** and **Delete Column** (the toolbar, or the right-click menu of a cell) work on the selected cell; `Ctrl+Z` and `Ctrl+Y` undo and redo, one action at a time.
- A cell you edit is a change of **the file's text**, exactly at that cell: everything else stays byte for byte as it was (quotes, line endings, the byte order mark); a value that needs quotes gets them. So the dot on the tab, **Save** (`Ctrl+S`), the check against a file that changed on disk, and the changes kept for the next start are the text editor's, and the **Text** button shows the same text. A file with more rows or columns than are drawn, a file in a ZIP or a snapshot, and the result of a query are only looked at.

## A new text, only in the window

**File ▸ New Text File** (`Ctrl+N`, `⌘N` on macOS) opens an empty tab, **Untitled-1**, that exists only in the window: nothing is written anywhere. It is made to hold a piece of text you copied from a file, so that you can compare it with another file or keep it beside one:

1. Copy the text in any file (or anywhere else) and paste it into the new tab (`Ctrl+V`).
2. **Compare it:** right-click the tab and choose **Select for Compare**, then right-click a text file in the tree (or the tab of another text) and choose **Compare with Selected**. It also works the other way round: select the file first, then use **Compare with Selected** in the menu of the new tab. The comparison reads the text as it is when you choose it; if you change the text afterwards, open the comparison again.
3. **Put it beside a file, or compare, by dragging:** drag the tab onto the **middle** of another text's tab (or onto the middle of the editor that shows it) and choose **Open Side by Side** or **Compare (Diff)**; a text file of the tree dropped on the new text's tab asks the same. Or right-click the tab and choose **Split Right**, or drag it to the side of the editor.

The language of a new text is **detected from what you paste** (HTML, CSS, JavaScript, JSON, XML and the like): the status bar says, for example, `HTML (detected)`, the text gets the colours of that language, and **Format Document** appears, with no need to save first. You can also choose the language yourself: click it in the status bar (**Select Language Mode**); a language chosen by hand is always kept (Plain Text too) and the text never changes it, and **Auto Detect** gives the choice back to the text. The language is kept with the text for the next start.

A new text has Word Wrap and the zoom of any text, and **Save As…** (or `Ctrl+S`) writes it to a file of your choice; after that **the tab is the saved file**: it takes the file's name (`page.html` instead of **Untitled-1**), its type comes from the extension (a name with no extension keeps the language that was detected; a language you chose by hand stays), it is clean, and the next `Ctrl+S` saves that file with no question. Opening the file from the tree brings the same tab. If you save in a folder that is not open, that folder is opened beside the others. Cancelling the question changes nothing. A tab that has text asks before it closes (an empty one closes at once). Like the changes of a file, the text is **kept for the next start** (the setting that keeps unsaved changes governs it): the window closes without asking, and the tab comes back with its number and its text, still not saved. Closing the tab also closes the comparisons that have it. Several can be open (**Untitled-2**, …).

## Comparing two text files

![Two files side by side, the changes marked and counted](images/diff.png)

Right-click a text file in the tree and choose **Select for Compare**, then right-click another and choose **Compare with Selected**: the two open in one tab, `a.txt ↔ b.txt`, the first as the left side. Either may be a file of a folder or an entry of a ZIP (also inside another ZIP), of the same open folder or of two different ones; the choice stays, so more files can be compared with the same first one. The menu of a **tab** of a text has the same two items, and so has a [new text](#a-new-text-only-in-the-window). Only a text of up to 5 MB in UTF-8 can be compared; anything else is refused with its name and the reason.

- **Side by Side** and **Inline** (one column, the removed lines above the added ones) switch the layout; the choice is kept. The colours of each file's language are kept, removed lines are red, added ones green, and the words that changed inside a line are marked more strongly.
- The toolbar says how many changes there are. **Previous Change** and **Next Change** (`Shift+F7`, `F7`) go from one to the next; **Swap Sides** turns the two round.
- **Collapse Unchanged** folds the long stretches of lines that are the same (three lines stay around each change); the button turns it off, and the choice is kept.
- A file saved with another line ending (`LF` and `CRLF`) is not different on every line: the endings are not compared, and the toolbar says when they differ.
- You can also **drag** a text file of the tree onto the middle of the editor, onto a tab or onto another file of the tree to compare them: see [Two editor groups](#two-editor-groups).
- A comparison only looks: nothing is written, and both files are read from the disk (or the ZIP) as they are saved, not with the changes you have not saved in their tabs. The tab follows a side that is renamed or moved, closes when a side is deleted or its folder is closed, zooms like a text (`Ctrl+=`, `Ctrl+-`), and is not kept for the next start. **Find** (`Ctrl+F`) searches the lines in view.

## Two editor groups

![Two editor groups side by side](images/split.png)

The editor can show **two groups of tabs side by side**, as VS Code does. There are three ways to make the second one: **Split Right** in the menu of a tab (the tab goes to a new group on its right), dragging a tab to the **right half of the editor**, and dragging a **file of the tree** to the right half (it opens there). While one of these is being dragged the half that will take it is lit; with two groups, the whole group under the pointer takes it. A tab can be moved back with **Move to Left Group** or by dragging it to the other group (onto a tab of it, it lands next to that tab).

- Each group has its own tabs and its own tab in front. The group you clicked last has the focus: **Find**, **Copy**, **Print**, **Save**, the language in the status bar, the zoom keys and the next and previous tab (`Ctrl+PageDown`, `Ctrl+PageUp`) act on it. A tab is one file, so it is in one group at a time: opening a file that is in the other group brings it over.
- The second group ends when its last tab is closed or moved away; closing every tab of the first leaves the second as the only group. The layout is remembered for the next start.
- **Dropping one file on another** asks what to do when both are texts: **Open Side by Side** (the one you dragged on the left, the other on the right), **Compare (Diff)** or Cancel. This is a **text file of the tree dropped on the middle of the editor** that shows a text file (the middle 40 % is lit, with "Drop here to compare, or to open side by side"), **in the middle of a text tab**, or **on another text file of the tree** (nothing is moved, and with `Shift` held it is still a copy); or a **tab** dropped on the middle of the editor or of another text tab. The file you drag is the left side. Dropped on the **right** of the editor (or its left), a file only opens, in the group on that side; dropped on the edge of a tab it opens in that tab's group (a tab is only reordered). A picture or any other kind of file is never asked about.

## ZIP files

A ZIP file opens in the tree like a folder, and the entries open in tabs like files. **Open as List** shows its entries as a table of names, sizes, packed sizes and dates, where you can select (click, `Ctrl` and `Shift`, the boxes, `Ctrl+A`) and **Extract** to a folder: one file asks for a name, **Extract All…** writes everything, and a file that is already there is never overwritten (the new one is called `name (2)`). Nothing is written to disk until you extract. Names that could leave the folder you chose are never written, links are not followed, and an entry protected with a password is shown dimmed and skipped. A ZIP over 256 MB is only offered with Save As. ZIP64 and encrypted ZIPs are read-only.

## Inside a ZIP

![A text file inside a ZIP being edited, with the menu of another entry](images/zip-edit.png)

A ZIP file, also a ZIP inside a ZIP, is changed like a folder, and what you change is written back into the ZIP file.

- **New File…** and **New Folder…** work in the menu of a ZIP file (they make the item at its top) and of its folders; **Rename** (`F2`), **Move to…** (or a drag onto a folder of the same ZIP), a **Shift-drag copy** (numbered when the name is taken) and **Delete** work on its entries. A ZIP has no trash, so **Delete** asks "Delete permanently?" at once, and that cannot be undone. A folder that you empty stays in the ZIP, as it would on a disk. Nothing is replaced, and a folder never goes into itself.
- A **text entry opens ready to edit**, like a file of a folder (see "Editing text"): **Save** (`Ctrl+S`) writes the ZIP again. If another program changed that same entry meanwhile, Save asks **Overwrite** or **Load from Disk**; a change to another entry of the ZIP is not a conflict.
- The ZIP is **rewritten whole and safely**: the entries you did not touch are copied as they were (compressed or stored, with their dates and permissions) to a temporary file next to the ZIP, and the file is renamed over it only when it is complete, so a crash or a full disk leaves the old ZIP. If something else changed the ZIP while it was being written, nothing is written and you are told to try again. A big ZIP takes a moment for each change. A ZIP inside a ZIP is taken out to a temporary file, changed and put back.
- A ZIP that **cannot be written back faithfully** is shown but not changed, and says why: ZIP64, an encrypted entry, a compression method other than stored and DEFLATE, a name that could leave the folder it is extracted to (`..`, an absolute path, a backslash), two entries with one name, or over 100,000 entries. A `.wsnp` is never changed inside (editing would break its signature); the whole file can be renamed, moved or deleted. Names in an old encoding are written back as UTF-8.
- **Nothing moves between a folder and a ZIP file, or from one ZIP file to another**: the drop or the **Move to…** is refused in words and both are as they were. The ZIP file itself is renamed, moved and deleted (to the trash) like any file of its folder. The bytes of an entry are only looked at in the hex view.

## Zoom, Find, Copy and Print

![Find in a source file, with the matches marked](images/find.png)

- **Zoom** belongs to the **tab**, never to the whole application. `Ctrl+=`, `Ctrl+-` and `Ctrl+0` (`⌘` on macOS), or `Ctrl` and the wheel (also over a document or a page), zoom the page of a snapshot, a text, a table, a document and the rows of the hexadecimal view (25 % to 500 %). The **status bar** has **−**, the level (click it for 100 %) and **+**. A picture and a PDF keep their own zoom (the same keys step it). Each tab has its own; a closed tab forgets it.
- **Find** (`Ctrl+F`, **Edit ▸ Find**) works in every tab that has text: a source file (over the whole text), a table, a PDF, a document (in its frame; in a workbook, the sheet on screen), the metadata and the lists. The box says which match of how many; `Enter` and `Shift+Enter` go to the next and the previous, **Aa** matches the case, `Esc` closes. In the bytes of a file `Ctrl+F` goes to the box that looks for bytes or text.
- **Copy** (`Ctrl+C`) copies what is selected.
- **Print** (`Ctrl+P`, **File ▸ Print…**, or the printer icon) prints a text as the tab shows it, a picture, the page of a snapshot, and a **document whole** (every sheet, every slide). **Save as PDF…** writes the same as a PDF. A ZIP's list, a PDF, a table and the bytes of a file cannot be printed yet.

## `.wsnp` files

![A .wsnp snapshot open in a tab, with the integrity check in the status bar](images/snapshot.png)

A `.wsnp` is a ZIP "photo" of a web page for offline reading: the page, every file it needs and a manifest. In Folder Browser it is **a file like the others** in the tree: a click shows its page in a preview tab, a double click keeps it, and **Show Contents** lists its entries. When the tab of a snapshot (its page, its metadata or one of its files) is in front, **Files** shows the folder that contains the `.wsnp`, opened down to it, with its row highlighted like the file of a tab; the files inside the snapshot are never listed there. The page runs as the format says (carousels, menus), in a frame that has no network. Links in it open in a tab (a picture, a PDF, source, a ZIP as a list), or in your browser for a web address, only when you click. The **status bar** says what the check found, and the **Metadata** tab (from the tab's menu or the status bar) shows what the manifest says. Files inside a snapshot open from its links, from the metadata and from Go to File. For anything more (a tree of its files, exporting), use **Open With…** and hand it to [WSNP Viewer](https://github.com/asantos43/wsnp-viewer).

The file is checked when it opens, and again in the background: its **structure**, the **SHA-256 and size of every file** against the manifest, and its **signature**. If a file is not what the manifest says, or a signed manifest was edited, the snapshot is **not valid** and its page is not shown until you choose **Show Anyway**. PageKeep signs what it writes; the signer is shown as a fingerprint, and **Trust this signer** in the metadata remembers a key you know is yours (design: [`MANIFEST-SIGNING.md`](https://github.com/asantos43/wsnp-format/blob/main/MANIFEST-SIGNING.md)). A ZIP saved by an older PageKeep opens converted to a temporary `.wsnp`, with a bar that says so and can **Save as .wsnp…**.

## Shortcuts

| Action | Windows, Linux | macOS |
| --- | --- | --- |
| New text file (only in the window) | `Ctrl+N` | `⌘N` |
| Open Folder / Open File | `Ctrl+Shift+O` / `Ctrl+O` | `⇧⌘O` / `⌘O` |
| Show hidden files | `Ctrl+H` | `⌘H` |
| Rename / Delete the item in the tree | `F2` / `Delete` | `F2` / `Delete` |
| Mark several rows in the tree | `Ctrl+click`, `Shift+click`, `Shift+↑↓`, `Ctrl+A` | `⌘+click`, `Shift+click`, `Shift+↑↓`, `⌘A` |
| Cut / Copy / Paste files and folders in the tree | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` | `⌘X` / `⌘C` / `⌘V` |
| Close the tab | `Ctrl+W` | `⌘W` |
| Next / previous tab | `Ctrl+PageDown` / `Ctrl+PageUp` | `⌘PageDown` / `⌘PageUp` |
| Through the tabs, most recently used first | `Ctrl+Tab`, `Ctrl+Shift+Tab` | `⌃Tab`, `⌃⇧Tab` |
| Go to tab 1…9 | `Alt+1…9` | `⌘1…9` |
| Hide / show the side bar | `Ctrl+B` | `⌘B` |
| Settings | `Ctrl+,` | `⌘,` |
| Open the user guide | `F1` | `F1` |
| Zoom the tab in / out / reset | `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, or `Ctrl` + wheel | `⌘=` / `⌘-` / `⌘0`, or `⌘` + wheel |
| Word Wrap in a source tab | `Alt+Z` | `⌥Z` |
| Next / previous change in a comparison | `F7` / `Shift+F7` | `F7` / `Shift+F7` |
| Go Back / Go Forward | `Alt+Left` / `Alt+Right` | `⌃-` / `⌃⇧-` |
| Go to File | `Ctrl+E` | `⌘E` |
| Command palette | `Ctrl+Shift+P` | `⇧⌘P` |
| Find in the tab | `Ctrl+F` | `⌘F` |
| Copy | `Ctrl+C` | `⌘C` |
| Print | `Ctrl+P` | `⌘P` |

The shortcuts work wherever the focus is, also inside a page or a document.

## Your own keys

Open **Settings ▸ Keyboard** to search commands by title, id or key, or show only modified keys. Each row shows its category and effective key. Choose **Record key**, press a chord and review it before Apply: Escape cancels, modifiers alone do nothing, reserved chords are refused and conflicts with other commands are shown before you confirm. **Remove key** clears the shortcut; **Reset** restores that command, and **Reset All…** asks before restoring every key. **Export…** saves `keybindings.json`; **Import…** opens a JSON file up to 256 KB and previews valid entries, skipped warnings and conflicts. Only Apply replaces your user keys; Cancel keeps them. Changes immediately update menus and the command palette.

Every command has a built-in key (the table above). You can also edit a file named `keybindings.json` in the application's own folder (`~/.config/folder-browser` on Linux, `%APPDATA%\folder-browser` on Windows, `~/Library/Application Support/folder-browser` on macOS; the same folder as `settings.json`). It is created when you save keys in the panel or make it yourself, and nothing changes while it does not. It is a list (between `[` and `]`, entries separated by commas), for example:

- `{ "key": "Ctrl+Alt+J", "command": "toggleSideBar" }`
- `{ "key": "Ctrl+B", "command": "-toggleSideBar" }`

The first entry gives **Hide / show the side bar** the key `Ctrl+Alt+J` (`Ctrl` is `⌘` on macOS); the second, with a `-` before the command, **removes** the built-in `Ctrl+B` from it. The new key shows in the menus and in the command palette, and works also while a page of a snapshot has the focus. An optional `"when"` (for example `"hasEditor"`) limits a key to when that is true; such a key does not work while a snapshot's page has the focus. The file is read when the application starts and again a moment after you save it. An entry that is wrong (a key that cannot be read, a command that does not exist, or a key the editor or the system needs, such as `Ctrl+V`) is skipped with a message, and the other entries still apply; a file that cannot be read at all is left as it is, and only the built-in keys are used.

## Settings, Help and About

**Settings ▸ Plugins** or **File ▸ Install Plugin from File…** installs a local `.fbplugin` file or unpacked plugin folder after confirmation; you can also drop either on the Plugins page, enable/disable, open its folder or remove it keeping/deleting its settings, but contributions are not applied yet.

![The Settings tab](images/settings.png)

**Settings** (the gear in the activity bar, **File ▸ Preferences ▸ Settings**, or `Ctrl+,`) opens in a tab with a box that filters them: **Color Theme** (Dark+, Light+ or Auto), **Divider Line Colour** (the line between the Explorer and the editors, and between two editor groups: the theme's own, or a colour you pick), **Display Language** (English, Brazilian Portuguese or automatic), whether to **reopen what was open**, **Show hidden files**, and for source files **Word Wrap** and **Format source files**. The other choices (Markdown, SVG, CSV, the sort order and comparisons) also appear here and remain available where they are used. Settings are kept on your computer, in the application's own folder, and nowhere else: see [`../PRIVACY.md`](../PRIVACY.md).

Search finds labels, descriptions and keywords regardless of accents or case. **Modified** marks choices that differ from their defaults. **Reset** restores one choice; **Reset section** restores every choice in that section, including those hidden by search. **Show Only Modified** limits the list to your changed choices. Plugin options appear under **Plugins ▸ name** when registered. A **Restart required** note means you need to close and reopen the application for that choice to take effect.

**Help ▸ User Guide** (or `F1`) opens this guide in a tab, inside the application, with its pictures and no network: it is in the language of the interface, its links to other parts scroll, and `Ctrl+F` searches it. **Help ▸ About Folder Browser** shows the version, what it runs on, the licence and the notices of the libraries inside it, and copies the version information for a bug report. Report a problem at <https://github.com/asantos43/folder-browser/issues>, **without attaching a private file**; a vulnerability goes the way [`../SECURITY.md`](../SECURITY.md) says.

The Settings toolbar has **Export…** and **Import…**, which open the system's file chooser. Import accepts JSON up to 256 KB and shows current and new values before applying anything. Unknown keys and invalid values are listed and skipped; malformed JSON or an oversized file applies nothing. Choose **Apply** to import the valid listed changes; a safety option always asks for an additional confirmation. Cancel leaves your settings alone. Export includes choices different from their defaults; import leaves absent keys alone. **Reset All…** asks before restoring every registered option to its default. **Show Settings File** reveals `settings.json` in the file manager. You can edit it with an external editor; the application reads it at the next start.

## What is not here yet

Moving or copying between a folder and a ZIP file (or between two ZIP files), adding a file from the disk into a ZIP, and editing the bytes of an entry of a ZIP are not here yet (see [`../TODO.md`](../TODO.md)). Selecting several rows at once (so a comparison is chosen from the menu, not with `Ctrl+click`), comparing a file with the changes not yet saved in its tab, more than two editor groups, dragging onto a place of the side bar, and printing the bytes of a file or a table as a table are on the list too.
