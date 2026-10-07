# TODO: PDFs

Part of the plan in [`TODO.md`](../../TODO.md) (the index, the performance rule and the roadmap). Open work of this area; what was delivered is in [`history.md`](history.md).

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
