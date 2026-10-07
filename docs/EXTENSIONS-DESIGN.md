# Extensions (plugins): the design sketch

Status: **a sketch, not built.** The plan and its boxes are in `TODO.md`, "Extensions". This file is what the plan rests on: the rules of trust, the package, the online catalog and the threat model. Security comes first: where a choice is between a feature and a way for a bad extension to do harm, the feature waits.

## 1. Principles

1. **Deny by default.** An extension can do nothing it did not declare, and the user saw and accepted what it declared.
2. **Data before code.** Most of what people want (themes, keys, languages, commands that start a program the user confirmed) is **data**. Data is validated against a schema and never runs.
3. **Code in a box first, and power as a visible, deliberate choice.** An extension with code at **level 1** runs with **no Node, no direct IPC, no network**, in a Web Worker, a sandboxed frame or a WebAssembly module, and reaches the application only through a **brokered API** whose every call is validated as untrusted input by the main process, with the same checks as every other operation (open roots only, `resolveInside`, no link out). **All levels are supported** (the user asked for it), so **level 2** exists too: Node code in a **process of its own**, **off by default behind a setting**, with **enforced** permissions where the platform can enforce them and an **explicit, typed confirmation** where it cannot (§4b). More power always means more friction, more review and more visibility.
4. **Nothing leaves the computer by default.** The application's promise stays. The **online catalog is opt-in**, one small read, no identifier; downloads happen on a click.
5. **Trust is a chain of signatures, not of addresses.** A download host is never trusted; a package is accepted only if its hash is pinned by a signed catalog entry (or the user chose to trust its publisher), and its contents match its signed file list.
6. **Everything can be switched off.** A safe mode starts the application with no extension; an extension can be disabled, removed or **revoked** (a signed blocklist) without a new release of the application.
7. **Performance is part of the contract** (the rule at the top of `TODO.md`): nothing is loaded at start except a small index; code activates on demand; a quota of time and memory is enforced and a runaway extension is killed.

## 2. Levels

| Level | What it is | Runs code? | Can it touch files? | First version |
| --- | --- | --- | --- | --- |
| **0, declarative** | themes, key schemes, language packs, file-type to language, snippets, **Open With entries and commands that start a program** (run by the application, never by the extension), menu entries | no | no | yes |
| **1, boxed code** | viewers and exporters (a sandboxed frame), converters and readers of formats (WebAssembly in a worker), commands that compute, panels | yes, isolated | only through the broker, read-only to begin with, per permission | later, one extension point at a time |
| **2, process** | Node code in a **utility process of its own** (its own memory; it can crash alone), started only when needed | yes | **restricted**: the permissions it declared, **enforced by Node's permission model** (read and write allow-lists of folders, no child processes, no network unless granted) plus the broker for the application's own features; **unrestricted** (`"trust": "full"`): whatever the user can, behind a typed confirmation (§4b) | phase 4, **off by default** behind a setting |

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

## 4b. Level 2: extensions that run as a process

For what a box cannot do: a tool that needs the file system beyond the open roots, a native helper (an archive or video tool), a language server, a converter that starts a program. It exists because the user wants **every level** supported, and it is built **last and most carefully**.

- **Off by default**: Settings ▸ Extensions ▸ **Allow extensions that run as a process** (a plain warning: such an extension is a program on your computer). Without it, a level 2 package cannot be enabled, and importing settings can **never** turn it on.
- **A process of its own** (`utilityProcess`), started on activation, with no access to the interface's window, its IPC or `window.fb`; it talks to the application only through the broker (a message port), which validates every call as untrusted input, rate-limits it and logs it. A crash or a hang is the extension's own: a notice, a restart button, never the window.
- **Two modes**, written in the manifest and shown at install:
  - **Restricted** (`"trust": "sandboxed"`): the process starts with **Node's permission model** (`--permission`) and an **allow-list** made from the permissions the user granted: folders it may read, folders it may write (its own data folder, and per-root grants), **no child processes, no worker threads of its own, no native addons, no WASI, no network** unless `network:<host>` was granted. The platform enforces it, not the extension's good will. (To be proved by a **spike** on the Electron and Node versions in use, with the findings written here: which flags a `utilityProcess` accepts, whether the model holds on Windows and macOS, and what an OS-level sandbox adds; if it cannot be enforced on a system, the restricted mode is **not offered there** and the extension falls to unrestricted with its warning.)
  - **Unrestricted** (`"trust": "full"`): no enforcement beyond the process boundary; it can do what the user can. It needs a **signature** (never unsigned), a **typed confirmation** that names the extension and its publisher fingerprint and says what it means, is **never "Reviewed" without a human security review** of its source and build, is shown with a **permanent mark in the status bar** while any is enabled, is **off in safe mode**, and **cannot be installed by a drag, a double click or an import without the confirmation**.
- **No access to what it was not given**: a restricted extension gets a **folder of its own** (`userData/extension-data/<id>/`, quota) and a handle to the roots the user granted; reading outside them is refused by the process's permission model **and** the broker.
- **Reviewed level 2** needs a human review of the source, a reproducible or inspectable build, a pinned hash, no obfuscation, and a record in the catalog; the catalog shows level 2 in its own section with the warning; the **revocation** list disables a level 2 extension at once and **kills its process**.

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
| **Process (level 2)** | an extra label on any of the above: *Restricted* or *Full trust*, in red for the second, always shown beside the name |
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
| An extension that reads files it should not | the broker only, per-root grants, `resolveInside`, a read-only copy of the extension, an activity log; for level 2 also Node's permission allow-list |
| A level 2 extension that starts programs, loads native code or opens sockets | restricted mode denies child processes, native addons and the network at the process level; unrestricted mode needs the typed confirmation, a signature and a status-bar mark, and is never reviewed without its source being read |
| A level 2 extension installed by trickery (a dropped file, an imported settings file, a link) | it cannot be enabled unless the setting is on, and the install needs the confirmation each time; a settings import never changes that setting |
| A level 2 process that outlives its need, leaks or spins | started on activation and stopped when idle, quotas on memory and CPU time, a kill switch, revocation kills the process |
| Exfiltration | no network permission in version 1; CSP `default-src 'none'`; every other request cancelled; no clipboard read; clipboard write only after a gesture |
| A busy loop, a memory bomb | quotas, a kill switch, a safe mode |
| UI spoofing (a panel that looks like the application's own dialog) | a frame the extension cannot draw outside, always labelled with its name and a "from an extension" mark; no access to the application's dialogs |
| Key hijacking (`Ctrl+S`, `Ctrl+W`, Delete) | a **reserved keys** list an extension cannot bind |
| Injection through contributed strings (names, descriptions, commands) | rendered as **text**, never HTML; icons only as raster images |
| A command entry that starts a program | run by the application, **without a shell**, an argument list, `{file}` substituted as one argument, shown and confirmed at install and again on the first run |
| A malicious JSON (huge, deeply nested, prototype pollution) | a size and depth limit, `JSON.parse` then a strict schema that builds a **new** object |
| A catalog host that logs users | opt-in, a plain explanation, no identifier, a mirror and air-gap path |

## 8. What it does not do (version 1)

A network permission and writing files for **level 1** (level 2 has them, with its own safeguards, in phase 4), starting programs from level 1 code, dependencies between extensions, accounts, payments, ratings or comments, telemetry, automatic updates, installing from a URL typed by the user. **Level 2 is planned (phase 4), not part of the first versions.**
