# The PageKeep ZIP, and how the viewer converts it to `.wsnp`

Before the `.wsnp` format existed, PageKeep saved a page as a plain ZIP. PageKeep still offers it
("Save as" → `.zip`), and many such files exist. The viewer opens them and converts them to `.wsnp`
([`VIEWER-GUIDELINES.md`](VIEWER-GUIDELINES.md), "Converting and exporting"). This document records
the ZIP as it is found in the wild and the rules of the conversion.

It was written from PageKeep's source (`page-snapshot-extension/offscreen.js`, which writes both
formats, and `lib/helpers.js`) and from real files. PageKeep is the reference; if it changes, this
document changes with it. The example files come from private sites and must not be committed here:
tests use synthetic fixtures.

## 1. The ZIP

```
index.html        the page, with a few inline pieces described below
assets/<file>     every saved file, all in ONE folder (no subfolders)
snapshot.json     what was saved
```

There is no `mimetype` entry. Entries are stored or DEFLATE-compressed; names are UTF-8.

`assets/` file names are the original name plus a short hash suffix (`JetBrainsMono-Regular-1e9u9sx.woff2`),
unique ignoring case, and use only the characters the `.wsnp` path rules allow (`FORMAT.md` section 5).
Files a page links to for download are saved too.

### `snapshot.json`

| Field | Meaning |
| --- | --- |
| `source_url` | the address of the page |
| `title` | the page's title |
| `captured_at` | ISO 8601 capture time |
| `tool` | who wrote it: `"Page Snapshot 1.0.0"` in early files, `"PageKeep x.y.z"` later |
| `debugger` | `"used"` or `"unavailable: <reason>"` (whether the browser's debugger could be attached) |
| `editors`, `carousels`, `sliding_carousels` | reports of what was recorded (later files have `sliding_carousels`) |
| `resources` | `[{ url, file, bytes, source, type? }]`: one per file of `assets/`. `file` is `assets/<file>`, `source` is `page`, `network`, `tab` or `picture` (a picture of a frame from another site, whose `url` is a description, not an address). `type` (a media type) is missing in early files. |
| `failed` | `[{ url, reason }]`: what could not be saved |

There is no viewport, pixel ratio, description, canonical address, language or "load whole page" flag.

### `index.html`

- Starts with the doctype, then `<!-- Saved by <tool> from <url> on <time> -->`, and `<meta charset="utf-8">` is the
  first element of `<head>`.
- Page scripts are gone. What gives collapsible sections, tabs, carousels and editors their behaviour back is **one inline
  `<script>`** at the end of `<body>` (the "offline runtime"). A frame saved inline (`<iframe srcdoc>`) can carry its own.
- Recorded data for that script is in `<script type="application/json">` blocks (`id="snap-pagers"`, `id="snap-sliders"`); they never run.
- There are no inline event handlers. `<a href>` and `<link rel="canonical">` keep absolute addresses.
- Every reference to a saved file is `assets/<file>`, in attributes (`src`, `href`, `srcset`, `poster`, `style=""`) and in `<style>`.
- CSS files in `assets/` refer to their neighbours by bare name (`url(font.woff2)`), since everything is in one folder.

## 2. Recognising it

A `.zip` is a PageKeep ZIP when it has `index.html` and a valid `snapshot.json` (with `source_url`) and no `mimetype` entry.
Anything else (no `index.html`, an unreadable `snapshot.json`, ZIP64, ZIP-level encryption) is refused with a plain reason.
A `mimetype` entry means it is not this format: it goes through the ordinary `.wsnp` checks.

## 3. Converting to `.wsnp`

The result is what PageKeep itself writes for `.wsnp` (`wsnpEntries` in `offscreen.js`), rebuilt from the ZIP.

| Step | Rule |
| --- | --- |
| Folders | Each `assets/<file>` moves to `assets/{images,styles,fonts,media,files}/<file>` by media type: CSS → `styles`, pictures → `images`, fonts → `fonts`, audio, video and subtitles → `media`, everything else and the files a page links to for download → `files`. The media type comes from `resources[].type`; when it is missing, from the extension, then from the first bytes. |
| Names | Kept. If a name is not allowed by section 5 of `FORMAT.md`, or clashes ignoring case once folders are added, it gets a `-2`, `-3`… suffix before the extension. |
| HTML references | `assets/<file>` becomes its new path everywhere it appears (attributes, `srcset` lists, `style=""`, `<style>`), including inside `srcdoc` frames. Absolute links to the web stay. |
| CSS references | `url()` and `@import` to a neighbour become relative to the new folders (`font.woff2` in `styles/` → `../fonts/font.woff2`). |
| Scripts | Each inline `<script>` that is not `application/json` moves to `_wsnp/offline.js` and the tag becomes `<script src="_wsnp/offline.js">`. Identical text shares one file; a frame with a different script gets `_wsnp/offline-2.js`, and so on. JSON blocks stay. |
| Cleanup | Anything else section 7 of `FORMAT.md` forbids is removed and reported as a warning: other inline script, inline event handlers, `ping`, references that would load from the network. |
| Manifest | `format` `"wsnp"`, `format_version` `"1.0"`; `created` = `captured_at`; `source.url` = `source_url`; `title` from `snapshot.json` (else `<title>`); `description` (`<meta name="description">`, else `og:description`), `source.canonical` and `source.language` read from the page, `""` when absent; `pages` with the one page; `files` with `path`, `original_url` (for files from the web), `media_type`, `bytes`, `sha256` and `source`; `failed` copied. |
| Unknown facts | The ZIP does not record `viewport`, `device_pixel_ratio` or `capture.load_whole_page`. The manifest gets `1280 × 800`, `1` and `false`, and this is shown to the user as "not recorded". |
| Origin | `generator` names the viewer. The optional field `converted_from` (`{ "format": "zip", "tool": "<tool of snapshot.json>" }`, defined in `FORMAT.md` section 6) says where the file came from. |
| Preview | The page is rendered in a hidden view and its first screen is saved as `_wsnp/preview.jpg` (JPEG, at most 1280 px wide), like PageKeep's own preview. |
| Packing | `mimetype` first, stored, no extra field; then `manifest.json`, `index.html`, the assets and `_wsnp/*`, every file listed in the manifest. The result is written to a temporary file, checked with the viewer's own validator (`FORMAT.md` section 10) and only then moved into place. If the check fails, nothing is delivered and the reason is shown. |

The conversion never contacts the network, and never changes the original ZIP.

## 4. Opening a ZIP without converting

The viewer converts to a temporary `.wsnp` (`core/convert/pagekeep.ts`; the folder goes away when the snapshot is closed) and shows the result, because a page with an inline script cannot be shown under the
strict Content Security Policy of `FORMAT.md` section 10. A bar says it is a PageKeep ZIP and offers **Save as .wsnp**.

### What is implemented

`core/convert/pagekeep.ts` follows this document, except that no `_wsnp/preview.jpg` is made yet (the option exists; a hidden view still has to draw it). `isPageKeepZip` decides by the two
entries and the missing `mimetype` (after a look at the first bytes, so a large `.wsnp` is not read twice). `SnapshotRegistry.openPath` converts, opens the result with `openWsnp`, and
`checkedConversion` runs `verifyContents` on it before **Save as .wsnp** copies it (by a temporary name, then renamed). The tests are `core/convert/pagekeep.test.ts`, `core/snapshots.test.ts` and `e2e/convert.spec.ts`.
