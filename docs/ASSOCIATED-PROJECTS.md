# Associated projects: what can be reused

Folder Browser has sibling projects on this computer (`~/Dev/AI/projetos/github/`). **Look here before writing something new** (see "Reuse before you write" in `CLAUDE.md`). Surveyed on 2026-10-07; read the code again before you port it, and keep a note of where it came from.

| Project | What it is | Licence | Reuse |
| --- | --- | --- | --- |
| `wsnp-viewer` | The viewer this application was copied from (0.1.0). | MPL-2.0 (relicensed from MIT) | **Nothing newer to take today**: its only commits after the copy are the move of the format description to `wsnp-format` and the relicensing, both done here already. The two share `core/` code (the ZIP reader, signatures, validation): a fix made in one should be looked at for the other. |
| `wsnp-format` | The WSNP format description and the signing description (`FORMAT.md`, `MANIFEST-SIGNING.md`). | (see its `LICENSE`) | Documentation only; the code and docs here only link to it. |
| `mdiff` (v1.2.0) and `mdiff-electron` (0.0.2, the older Electron one) | **Compare two folders**: every added, deleted and modified text file, side-by-side or unified diffs, search in the contents, download a patch, open in an editor, and an AI explanation of each change. By Max Oliver (`maxoliverbr`, a collaborator of this repository). | **MIT**: compatible with MPL-2.0; keep its copyright and licence text in `THIRD-PARTY-NOTICES.md` when code is taken | See below. |
| PageKeep | The program that makes `.wsnp` and PageKeep ZIP files. | not on this computer | Cannot be surveyed here. |

## What `mdiff` has that this plan needs

| `mdiff` file | What it does | Where it helps here |
| --- | --- | --- |
| `src/lib/compare.ts` (and its tests) | The **folder comparison**: pairs the files of two folders, classifies each as `added`, `deleted`, `modified` or `same` (by line counts with `diffLines`), skips binary files, respects **every `.gitignore`** of the tree (the `ignore` package) and `.git/`, with counts for a sidebar. It reads through the browser's folder handles, so the **logic is portable and the reading is not**: here it would run over `RootRegistry` lists in `core/`. | The open item **a diff of two folders** (`docs/todo/text.md`); the **names to hide** and `.gitignore` of Search folders and Settings (`docs/todo/search-git.md`, `docs/todo/settings.md`). |
| `src/lib/patch.ts` (and tests) | A **unified patch writer** (`createTwoFilesPatch`) with **git-style path escaping** (`gitPath`: quotes, backslash and control characters) so that `git apply` accepts the result; one patch for every change or for one file. | **Export a comparison as a `.patch`** from the diff tab and from a folder diff; the Git view (`docs/todo/search-git.md`). Pure functions: easy to port with their tests. |
| `src/lib/diff-view.ts` | The **large-file policy**: above 5,000 lines (both sides together) a diff opens with **only the changes and 3 lines of context** and a **Show full file** toggle; syntax highlighting is skipped past 20,000 lines of the rendered patch. | `DiffView` (`@codemirror/merge`) today folds unchanged lines but has no limits for a huge pair: the performance rule asks for them. Take the **thresholds and the toggle**. |
| `src/lib/search.ts` (and tests) | **Content search** in both versions of each file: a minimum query length, a **5 MB cap per file** (bigger files are reported as skipped, not read), batches of 32, a small cache, and a **lowercasing that keeps the length** (a few characters such as `İ` grow when lowercased, which shifts every match after them). `find-in-diff.ts` marks the matches in a drawn diff. | The **content search** of Search folders (`docs/todo/search-git.md`) and Find and Replace (`docs/todo/text-tools.md`): the length-safe case folding is a **bug to avoid**, worth copying with its test. |
| `src/lib/editor.ts` (and tests) | "Open in editor": presets (VS Code `code -g {file}:{line}`, Sublime, Zed, gedit, Kate, the system default) and a **template parser** (`parseTemplate`: quotes and escapes, `{file}` and `{line}`, **run as a program with arguments, never through a shell**). | The **custom commands** of Open With and of Open in Terminal (`docs/todo/files.md`, `docs/todo/settings.md`, `docs/todo/extensions.md`): the same rule and a tested parser. |
| `mdiff-electron/electron/find-claude.ts` | Finds the `claude` program on the computer to use a subscription without a key. | Not needed now; an idea for an **optional extension** (level 2) that explains a diff with a program the user already has. |
| `src/lib/ai.ts`, `report.ts`, `report-html.ts` | **AI Explain** and **AI Report** of a comparison (five providers). | **Not for the core**: the application's promise is that nothing leaves the computer. If ever wanted, an **opt-in extension** (see `docs/EXTENSIONS-DESIGN.md`) that asks for a network permission. |
| the rest (`components/`, `server/`, `tauri.ts`, `web-folders.ts`, `desktop.ts`) | The web page, a dev server for folders, the desktop shells. | Not reusable: this application has its own interface and reads the disk in the main process. |

## How to take code from a project here

1. Read the file and its test; port the **logic** into `core/` (plain TypeScript, no Electron) with its tests, adapted to our types and to the safety rules (`resolveInside`, no shell, limits).
2. Keep a header comment with the origin and the licence, add the project to `THIRD-PARTY-NOTICES.md` when its code is copied (MIT needs the copyright and the licence text), and say it in the `CHANGELOG.md` line.
3. Apply the performance rule (a budget and a test) as for any new code, and add the item to `TODO.md` first if it is a new feature.
