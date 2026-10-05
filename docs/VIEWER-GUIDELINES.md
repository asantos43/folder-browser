# Guidelines for the WSNP viewer

The viewer is the application that opens `.wsnp` files ([`FORMAT.md`](FORMAT.md)). It will live in
a repository of its own; these are the requirements it starts from, to be approved in its own
plan. Whether it is an installable web app or a desktop app is decided there.

The extension stays as simple as it is: it captures and saves. Everything about reading, managing
and protecting snapshots belongs to the viewer.

## Look and feel

The interface, named **Folder Browser**, is as close to Visual Studio Code (its Dark+ and Light+ themes) as possible, in looks and in behaviour
([`UI-DESIGN.md`](UI-DESIGN.md) says how):

- The same layout and behaviours (tabs with preview and pinned tabs, split editor, breadcrumbs, quick open): a title bar with the menu (File, Edit, View, Go, Help), an activity bar, a side bar with a tree, an editor group with tabs
  and breadcrumbs, a find widget, a status bar, a command palette and quick open, with VS Code's shortcuts.
- The title bar's arrows go back and forward through the tabs visited, and its box is quick open: Go to File over every open snapshot, and `>` for the commands (Ctrl+E, Ctrl+Shift+P).
- Open snapshots are tabs (several at once); the files of a snapshot are a tree in the side bar, and opening one shows it as
  read-only source (or picture) in a preview tab, or offers to save it when it cannot be shown (see "Files inside a snapshot").
- Menus are drawn as VS Code's are (rounded panel, grouped items, shortcuts at the right, submenus: File ▸ Open Recent, File ▸ Preferences).
- Two themes, **Dark+ and Light+**. The default follows the operating system and can be changed in Settings; the colours are design tokens named like VS Code's, so each theme is one set of values.
- It follows the platform where VS Code does (the native application menu on macOS, the native window buttons on
  Windows and Linux) and stays usable and accessible (keyboard, focus rings, screen-reader roles) at every display scale.
- It is *inspired by* VS Code and never uses its name, logo or icon: the viewer has its own name and icon.

## Opening files

- The file picker lists `.wsnp` and `.zip` files (an older PageKeep's ZIP is opened converted), each kind alone, and all files.
- When there is no file to open at start, the snapshots and files that were open at the end of the last session are opened again (a setting, on by default; only their names are kept).
- Open one or several `.wsnp` files at once (by the file picker, by dragging them in, and by
  double-click where the platform allows it: `file_handlers` for an installable web app, a file
  association for a desktop app).
- Show the open snapshots as tabs or a list, each with its preview, title, source address and
  capture date.
- Validate every file with the checklist of `FORMAT.md` (section 10) before showing it
  (`tests/wsnp-check.mjs` shows one implementation), and say in plain words why a file is refused,
  including a newer major version ("made by a newer version").
- A `.zip` saved by PageKeep (with `snapshot.json`) can be opened too, and converted to `.wsnp`
  (see "Converting and exporting").

## Showing the page

- Read the files from the archive in memory, by its central directory; never unzip to disk.
- Show the page in a sandboxed frame without `allow-same-origin` (or from an origin of its own),
  under a Content Security Policy that blocks every request leaving the snapshot, as in
  `FORMAT.md` section 10: the snapshot's own offline scripts (`_wsnp/`) run, nothing else does.
- Serve each file with its `media_type` from the manifest.
- The page must look and behave as it does unzipped: responsive, carousels, tabs, menus and
  galleries working.

## Snapshots with an application (`.wsnpx`)

Supporting `.wsnpx` (`FORMAT.md` section 8) can come after `.wsnp`; until then the viewer says the
file holds an application it cannot run yet. When it does support them:

- Open a `.wsnpx` with its scripts off and a bar naming the application, what it does and what it
  asks for (its permissions and the sites it wants to contact), with **Enable** and **Keep off**.
  Remember the choice only for that exact application (its hashes); ask again when it changes.
- Never run scripts of a file whose hashes do not match.
- Grant only the permissions the user accepted, through the reader API of section 8.5, and open
  the network only to the origins listed, only with `network`.
- **Save** (with the `save` permission) writes a new `.wsnpx` with the application's data, after
  the user confirms; protected files stay protected.
- Offer to turn a `.wsnp` into a `.wsnpx` when the viewer adds an application of its own (notes,
  highlights…), and to remove an application, turning it back into a `.wsnp`.

## Information bar

For the snapshot on screen: its source address (clickable, opens in the browser), capture date,
the program that made it, the viewport it was captured at, what could not be saved (`failed`),
and the integrity result (every file's SHA-256 checked: "intact" or which files changed).

## Search and print

- Text search inside the snapshot on screen, with the matches highlighted, and across all the
  open snapshots, listing where each match is. *Done:* Find (`Ctrl+F`) in the tab on screen: the page, source, a PDF, a ZIP's list, the metadata and Settings, with the count and the
  current match. *Still to come:* across all the open snapshots.
- **Copy** works on the selection of every view that has text (the page, source, a PDF, the viewer's own lists and texts), from Edit ▸ Copy as from the keyboard.
- Print the page as saved, with an optional header or footer naming the source address and the
  capture date. *Done:* Print (`Ctrl+P`, File ▸ Print…, the printer icon of the activity bar) with the system's dialog, for the page, a text file as shown, and a picture; the optional
  header and footer, and printing a PDF, a ZIP's list or the metadata, are still to come.

## Links

- Links inside the page (`#section`) work offline.
- Links to files saved in the snapshot (`assets/files/…`) open or save those files.
- Links to the web open in the user's default browser, only when clicked: the only moment the network is
  used. The viewer never follows them inside the snapshot's frame and never opens a tab of its own for them: tabs hold
  snapshots and their files, not live web pages.

## Metadata and validity

- **Show Metadata** (View menu, the tab's context menu, and "Show all metadata…" in Information) opens a tab with everything the manifest says, in words (format and version, who made it and when, the page's title,
  description, address, canonical address and language, the capture's window, how many files and how big, what could not be saved) and what the viewer has checked: the **structure**, the **contents** (the SHA-256 of
  every file) and the **signature**. The raw `manifest.json` opens as source from there, and the metadata can be copied as JSON.
- A snapshot whose files are not what the manifest says (a SHA-256 or a size that does not match, a file that cannot be read) is **not valid**: its page is not shown. The notice lists the files, and offers
  Show Anyway, Close Snapshot and Show Metadata; the status bar says "Invalid". Because the file is a ZIP, anyone can unzip it, edit a file or the manifest's list of files, and zip it again: that is caught.
- Editing the manifest's other fields (title, address, date) cannot be caught by the hashes, and nothing in the file is secret enough to stop someone who recomputes them. That is what the **signature** is for
  (`FORMAT.md` section 12, `MANIFEST-SIGNING.md`): a file signed by its writer's key is **not valid** as soon as its manifest is edited, with no check of the files needed, and its page is held back the same way.
  Who signed is the user's to trust: a key the viewer does not know is shown with its fingerprint and a button **Trust this signer**, with a name the user may give; a trusted key is named. A file with no signature
  (every file PageKeep wrote before it began to sign) opens, with a quiet "Not signed" in the status bar and in the metadata view: its metadata is not protected.

## Files inside a snapshot

- Open one from the tree, and it opens in a tab in the form that suits it: read-only source (JSON, HTML, CSS, JavaScript, text), a picture, a PDF, or a font sample.
- **The address of a link** shows as a tooltip when the pointer rests on a link of a page (the web address, the path of a file of the snapshot, or the `#fragment`), drawn by the interface, not the page.
- **Zoom is the tab's own**, never the whole application's: the page of a snapshot (25 % to 500 %, laid out again as a browser's zoom does), a text, and, for their own toolbars, pictures and PDFs. `Ctrl+=`, `Ctrl+-`, `Ctrl+0` and `Ctrl` with the wheel, also over the page; the status bar has zoom controls (−, the level, which takes it back to 100 %, and +) that follow the keys and the wheel; the menus have no zoom.
- **SVG** files open as a picture and switch to their source (and back) with buttons in the toolbar of either; the choice is kept.
- **Source files** are shown as text with the colours of their language: the web's own (HTML, CSS, JavaScript, TypeScript, JSON, XML, YAML, Markdown) and Python, C, C++, C#, Java, Kotlin, Scala, Go, Rust, Swift, Dart, PHP, Ruby, Perl, Lua, R, Groovy, Haskell, Julia, Clojure, Erlang, Pascal, shell, PowerShell, SQL, TOML, properties (INI, `.env`), Dockerfile, CMake, Diff, Protocol Buffers, SCSS, Sass and Less. The language comes from the media type, else from the extension or the name (`Dockerfile`); the name of the language is on the right of the toolbar.
- When the viewer takes a text file for the wrong language, the status bar's language item opens **Select Language Mode** (a list of the languages, with Auto Detect to undo it); the choice is for that file while the window is open.
- **Markdown** files open formatted and switch to their text (and back) with buttons in the toolbar of either; the choice is kept. The formatted page shows no raw HTML, loads no picture and follows no link but a web one, which opens in the browser.
- A file of no known type (as a ZIP's entries often are) is read and shown as text when its bytes are text (no NUL byte, valid UTF-8); otherwise it is offered with Save As.
- **Pictures** have a toolbar with zoom: out, in, a box with "Fit", "Fit Width", "Fit Page" and percentages, actual size (100 %), and Save As. Ctrl and the wheel
  zoom around the pointer, `+` `-` `0` zoom from the keyboard, and a zoomed picture is dragged to move it. The zoom stays with the tab.
- **PDFs** open in a tab, drawn by the viewer itself (no plug-in, no script of the PDF runs, nothing is fetched), page after page, with the text selectable. The toolbar has
  the same zoom, the page (previous, next, a box to go to a page, "of N") and Save As. Not yet: links and forms inside the PDF, a password for a protected PDF (it says so, and can be saved).
- **ZIP files** (up to 256 MB) open as the list of their entries (name, size, packed size, date). Entries are selected as in a file manager and **extracted** to a folder the user picks (one file asks for a name, as Save As
  does; the ZIP's folders are kept; nothing is overwritten; unsafe names, links and entries the viewer cannot read are skipped and counted), or **viewed**: an entry opens in a tab of its own by its path
  `zip!/entry`, and a ZIP inside the ZIP as a list again. A ZIP is read in memory and never unzipped to disk unless the user extracts.
- **Open With…** (the tree's context menu) asks the system which application to open a file with, and hands it a read-only copy in a temporary folder, removed at quit; a file that could run as a program is never handed over.
- A file the viewer cannot show (an office document, audio, video, any unknown type, anything too large) is offered with **Save As…**, which writes it to a place the
  user picks. Save As is also in the tree's context menu for every file, and on the toolbar of a picture or a PDF. A click on a link to a saved file in the page opens what a tab can show, and offers Save As for the rest. The bytes are streamed from the archive to the chosen file, so a large file never has to fit in memory.

## Password protection

The viewer is where snapshots are protected, never the extension:

- **Save with password**: the password typed twice, at least 8 characters, with a clear warning
  that a forgotten password cannot be recovered; writes a protected `.wsnp` as `FORMAT.md`
  section 9 defines (`tests/wsnp-crypt.mjs` shows one implementation).
- **Opening** a protected file asks for the password, decrypts in memory only and says clearly when
  the password is wrong.
- A protected file can be saved again without a password (an explicit choice).
- The password is never stored, logged or sent anywhere.

## Converting and exporting

- **PageKeep ZIP to `.wsnp`** ([`PAGEKEEP-ZIP.md`](PAGEKEEP-ZIP.md)): *done for one file at a time:* opening a `.zip` saved by PageKeep shows it (converted to a temporary `.wsnp`) with a bar offering **Save as .wsnp**; several ZIPs can be converted at once into a chosen folder, with a report of
  the warnings for each. The original is never changed, and a result that fails the checklist of `FORMAT.md` section 10 is
  never delivered. Facts the ZIP does not record (viewport, pixel ratio) are shown as "not recorded".
- **Export to images:** the snapshot on screen (or several selected) to PNG or JPG, as the whole page or the visible area, at a
  chosen width (by default the viewport the page was captured at) and scale, with JPG quality. A page too tall for one image
  is split into numbered files, and the user is told.
- **Export to PDF:** paginated (A4, Letter or custom, orientation, margins, scale) or as one long page, with an optional
  header and footer naming the source address and capture date, and a choice between the page's print styles and "as on
  screen". Text stays selectable and links keep working.
- Both exports render like the snapshot view (same isolation, no network), never disturb the snapshot on screen, show
  progress with a way to cancel, and suggest the file name `<title>-<date>.<extension>`. A protected file is exported only
  after it is unlocked, and nothing decrypted is written to disk except the exported file.

## Languages and privacy

- English and Brazilian Portuguese, like the extension, following the system's language.
- Nothing leaves the computer: no account, no analytics, no network use except the links the
  user clicks.
