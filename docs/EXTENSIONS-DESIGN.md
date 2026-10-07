# Extensions (plugins): the design sketch

Status: **a sketch, not built.** The plan and its boxes are in `TODO.md`, "Extensions". This file is what the plan rests on: the rules of trust, the package, the online catalog and the threat model. Security comes first: where a choice is between a feature and a way for a bad extension to do harm, the feature waits.

## 1. Principles

1. **Deny by default.** An extension can do nothing it did not declare, and the user saw and accepted what it declared.
2. **Data before code.** Most of what people want (themes, keys, languages, commands that start a program the user confirmed) is **data**. Data is validated against a schema and never runs.
3. **Code only in a box.** An extension with code (later) runs with **no Node, no direct IPC, no network**, in a Web Worker, a sandboxed frame or a WebAssembly module, and reaches the application only through a **brokered API** whose every call is validated as untrusted input by the main process, with the same checks as every other operation (open roots only, `resolveInside`, no link out).
4. **Nothing leaves the computer by default.** The application's promise stays. The **online catalog is opt-in**, one small read, no identifier; downloads happen on a click.
5. **Trust is a chain of signatures, not of addresses.** A download host is never trusted; a package is accepted only if its hash is pinned by a signed catalog entry (or the user chose to trust its publisher), and its contents match its signed file list.
6. **Everything can be switched off.** A safe mode starts the application with no extension; an extension can be disabled, removed or **revoked** (a signed blocklist) without a new release of the application.
7. **Performance is part of the contract** (the rule at the top of `TODO.md`): nothing is loaded at start except a small index; code activates on demand; a quota of time and memory is enforced and a runaway extension is killed.

## 2. Levels

| Level | What it is | Runs code? | Can it touch files? | First version |
| --- | --- | --- | --- | --- |
| **0, declarative** | themes, key schemes, language packs, file-type to language, snippets, **Open With entries and commands that start a program** (run by the application, never by the extension), menu entries | no | no | yes |
| **1, boxed code** | viewers and exporters (a sandboxed frame), converters and readers of formats (WebAssembly in a worker), commands that compute, panels | yes, isolated | only through the broker, read-only to begin with, per permission | later, one extension point at a time |
| **2, full trust** | arbitrary code in a process of its own | yes | whatever the user has | **not planned** |

## 3. The package: `.fbplugin`

A ZIP file (the application opens it itself, as it opens any ZIP). No symbolic links, no absolute or `..` names, no executables or scripts in level 0, at most N files and M MB (limits in the schema).

```
plugin.json          the manifest (below)
SIGNATURE            a detached ed25519 signature over plugin.json, the file list and their hashes
README.md            shown in the extensions page (as text; never as HTML)
icon.png             a raster image only (an SVG icon is refused: it could carry script)
files…               themes/*.json, keymaps/*.json, locales/*.json, snippets/*.json, wasm/*.wasm, ui/*.html (level 1)
```

```jsonc
// plugin.json
{
  "schema": 1,
  "id": "acme.solarized",                 // publisher.name, lowercase, [a-z0-9-.]; unique in the catalog
  "name": "Solarized Colours",
  "version": "1.2.0",                     // semver
  "publisher": { "id": "acme", "name": "Acme", "key": "ed25519:2f9c…" },
  "description": "A pair of Solarized themes.",
  "license": "MIT",
  "homepage": "https://example.org/solarized",
  "engines": { "folderBrowser": ">=0.2.0 <0.4.0", "api": 1 },
  "permissions": [],                      // level 0 asks for none
  "contributes": {
    "themes":     [{ "id": "solarized-dark", "label": "Solarized Dark", "base": "dark", "tokens": "themes/dark.json" }],
    "keymaps":    [],
    "languages":  [],
    "openWith":   [],
    "commands":   [],
    "locales":    []
  },
  "activation": ["onTheme:solarized-dark"],   // when it is loaded; nothing is loaded at start
  "files": { "themes/dark.json": "sha256:9a1f…" }
}
```

A level 1 extension adds `"main": "worker.js"` or `"wasm"` entries, a list of **permissions** (below) and a hash for every file; a `.wasm` module is checked to import **only** the host functions the broker offers.

### Permissions (level 1; none are granted by installing)

| Permission | Meaning |
| --- | --- |
| `files.read` | read files of the open roots the user allowed for this extension (a per-root grant, shown by name), only through the broker, never a path of the disk |
| `files.write` | **not in version 1**; later, each write confirmed by the user or limited to a folder the extension owns |
| `ui.panel`, `ui.statusItem`, `ui.viewer:<ext>` | draw in a frame of its own, labelled with its name, that cannot draw outside it |
| `commands` | add commands to the palette and menus (never a reserved key) |
| `clipboard.write` | put text on the clipboard after a user gesture |
| `storage` | a private folder with a quota |
| `network` | **not in version 1**; later a host allow-list shown at install, never `*` |
| `process` | **never**: a program is started only by a level 0 entry that the **application** runs after the user's confirmation, without a shell |

An update that asks for **more** permissions is **not** applied silently: the user is shown the difference and must accept again.

## 4. Where an extension lives and how it runs

- Installed copy: `userData/extensions/<id>/<version>/`, written from the verified package, **read-only**, never run from the downloaded file or from a folder of the user. An index `installed.json` (id, version, enabled, source, granted permissions, hashes) is all that is read at start.
- Contributions of level 0 are compiled into the application's registries (settings, commands, key table, themes, languages) **at install time**, so start-up reads one small file.
- Level 1 code is served to its worker or frame by a protocol of its own (`fb-ext://<id>/…`), read-only, with a **CSP per extension** (`default-src 'none'`, no network, scripts only its own); every other request is cancelled (as for snapshots and documents).
- The broker is the only door: a message `{ id, method, params }` is checked against the manifest's permissions, **validated as untrusted data**, rate-limited, logged (an **activity log** the user can read: which files an extension read and when), and answered.
- Quotas: wall time per call, total CPU share, memory, number of messages; over a limit the extension is **stopped and marked**, with a notice, and a crash never takes the window down.
- **Safe mode**: a menu item and a command-line flag start the application with every extension off; it is offered after a crash at start-up.

## 5. Installing

- **Side load**: File ▸ Install Extension from File…, a `.fbplugin` dropped on the Extensions page, or a double click (if registered). The same checks as an online install, with a clear label **"From a file: not reviewed by anyone"** unless the publisher's key is trusted.
- **Developer mode** (a setting, off by default, with a banner while on): load an **unpacked folder**, reload on change, show errors; it never persists across a start unless the user chose to.
- **Online catalog**: below.
- Every install shows: name, publisher and key fingerprint, version, **what it contributes**, **what it asks for**, its size, the source (catalog or file) and whether it is signed and by whom. **Install** is the default button only for a verified, reviewed entry of the catalog; the other cases need a second confirmation.
- Installation is **atomic** (unpack to a temporary folder, verify, rename) and keeps the previous version for a **rollback**.

### Trust levels

| Label | Meaning |
| --- | --- |
| **Reviewed** | in the catalog, whose entry pins this package's hash, signed by the catalog key (reviewed by the project; level 1 gets a human review) |
| **Signed by a publisher you trust** | signed by a key the user trusted before (the same store of trusted signers as for snapshots, `core/signers.ts`) |
| **Signed, unknown publisher** | valid signature, unknown key: the fingerprint is shown and trust is a conscious choice (trust on first use) |
| **Unsigned** | level 0 only, only from a file, only after a warning; **never** level 1 |

## 6. The online catalog (the sketch)

A **static website**, no server code, no accounts, no database, no tracking: files in a public git repository (`folder-browser-extensions`) published as static pages (GitHub Pages or a release asset), so the only moving part is a pull request.

```
https://<host>/catalog/v1/index.json         the list
https://<host>/catalog/v1/index.json.sig     detached signature of the exact bytes of index.json
https://<host>/catalog/v1/revoked.json       the blocklist
https://<host>/catalog/v1/revoked.json.sig
packages are release assets of the extension's own repository or of the catalog's; the URL is in the entry
```

```jsonc
// index.json
{
  "schema": 1,
  "generated": "2026-11-01T10:00:00Z",
  "sequence": 417,                       // grows with every publication: an older index is rejected (rollback attack)
  "extensions": [
    {
      "id": "acme.solarized",
      "name": "Solarized Colours",
      "summary": "A pair of Solarized themes.",
      "level": 0,
      "categories": ["themes"],
      "publisher": { "id": "acme", "name": "Acme", "key": "ed25519:2f9c…" },
      "version": "1.2.0",
      "minApp": "0.2.0",
      "permissions": [],
      "size": 18342,
      "package": { "url": "https://github.com/acme/solarized/releases/download/v1.2.0/acme.solarized-1.2.0.fbplugin", "sha256": "…" },
      "reviewed": { "by": "folder-browser-maintainers", "at": "2026-10-30", "pr": 12 },
      "icon": "icons/acme.solarized.png"
    }
  ]
}
```

```jsonc
// revoked.json
{ "schema": 1, "sequence": 9, "generated": "…",
  "extensions": [{ "id": "evil.thing", "versions": "*", "reason": "malicious: reads files and writes them elsewhere" }],
  "keys": [{ "key": "ed25519:ab12…", "reason": "key compromised" }] }
```

**Trust chain.** The application ships with the **catalog's public key** (and a second one, for rotation). It accepts an index only if the signature verifies, its `sequence` is not lower than the last one it saw, and its `generated` date is not stale beyond a limit. An entry pins the package's **SHA-256**; the package's own `SIGNATURE` must verify against the publisher key the entry names; the files inside must match the hashes in `plugin.json`. So a replaced release asset, a hijacked host, a man in the middle or a swapped file is **rejected**, whoever serves the bytes.

**What the application does, and only when the user turned the catalog on**
- A single HTTPS `GET` of `index.json` (and of `revoked.json`, and the two signatures) when the **Extensions ▸ Browse** page opens or **Check for updates** is pressed, never in the background and never at start. `If-None-Match` caching; a fixed `User-Agent: FolderBrowser/<version>`; no cookies, no identifier, no list of what is installed. (The host necessarily sees the IP address: the Settings text says so.)
- A download happens **on a click**, then every check above, then the install screen.
- An **update** is offered, never applied: the page says "1.3.0 is available" and shows the permission difference; the user clicks.
- **Revocation**: when the blocklist is fetched, an installed extension or publisher key that appears in it is **disabled at once** with a notice. Without the catalog turned on the application cannot know, and the page says so.
- **Air gap and mirrors**: **Browse a catalog from a folder** (an `index.json` and its signature on disk, with the packages beside it) works with no network; a company can mirror the catalog, and the application still requires **the catalog key's signature** (a mirror is only a cache). A different catalog **key** is a developer-mode setting, never the default.

**Publishing (the repository's side).** An author opens a pull request that adds a manifest and a link to a release. CI checks the schema, the sizes, the hashes, that a level 0 package carries no code, that the permissions are what the description says, the id's namespace (the publisher id must match the GitHub account or organisation that owns the package's repository, to stop **typosquatting** and impersonation), and runs the extension-package **fuzz and bomb tests**. A **human review** is required for level 1 and for any change of permissions. Merging publishes the next `sequence`, signed **offline** by a maintainer's key held on a hardware token (the catalog key is never on a CI server).

**Governance** (`docs/EXTENSIONS-POLICY.md`, to write): what may be published (no network, no telemetry, no obfuscated code, a licence), how to report a malicious extension (a private security contact), the **takedown and revocation** process and its time target, key rotation and what happens when a publisher key leaks, and the API's **stability promise** (semver, a deprecation period).

## 7. Threat model (what the tests must cover)

| Threat | Defence |
| --- | --- |
| A package with `../` names, absolute paths, symlinks, a ZIP bomb, a million files | the package reader refuses them (`safeRelative`, limits on size, count and ratio) before anything is written |
| A tampered or replaced package | pinned SHA-256 in a signed entry, signature on the package, per-file hashes |
| A rolled back or frozen index (an old vulnerable version offered again) | `sequence` and a freshness limit; the installed version is never downgraded without a choice |
| A compromised publisher key | the signed blocklist disables it; keys are per publisher, so one leak is bounded |
| Typosquatting, impersonation, a look-alike name | the namespace rule, a visible publisher fingerprint, "Reviewed" shown only for catalog entries |
| An update that adds permissions | refused until accepted again, with the difference shown |
| An extension that reads files it should not | the broker only, per-root grants, `resolveInside`, a read-only copy of the extension, an activity log |
| Exfiltration | no network permission in version 1; CSP `default-src 'none'`; every other request cancelled; no clipboard read; clipboard write only after a gesture |
| A busy loop, a memory bomb | quotas, a kill switch, a safe mode |
| UI spoofing (a panel that looks like the application's own dialog) | a frame the extension cannot draw outside, always labelled with its name and a "from an extension" mark; no access to the application's dialogs |
| Key hijacking (`Ctrl+S`, `Ctrl+W`, Delete) | a **reserved keys** list an extension cannot bind |
| Injection through contributed strings (names, descriptions, commands) | rendered as **text**, never HTML; icons only as raster images |
| A command entry that starts a program | run by the application, **without a shell**, an argument list, `{file}` substituted as one argument, shown and confirmed at install and again on the first run |
| A malicious JSON (huge, deeply nested, prototype pollution) | a size and depth limit, `JSON.parse` then a strict schema that builds a **new** object |
| A catalog host that logs users | opt-in, a plain explanation, no identifier, a mirror and air-gap path |

## 8. What it does not do (version 1)

Full-trust code, Node in an extension, a network permission, writing files, starting programs from extension code, dependencies between extensions, accounts, payments, ratings or comments, telemetry, automatic updates, installing from a URL typed by the user.
