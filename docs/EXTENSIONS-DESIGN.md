# Extensions (plugins): the design sketch

Status: **a sketch, not built.** The plan and its boxes are in `TODO.md`, "Extensions". This file is what the plan rests on: the trust model, the package, the online catalog and the threat model.

## 0. The decision of the owner (2026-10-09): the trust model

> "I wanted these plugins to be as flexible as possible with little limitation, because it is a way to extend the life of the application. At most a warning for the user to validate. Apart from that, everything would be allowed."

Of three models, the owner chose **a warning at install plus a safe mode**. It **replaces** the earlier model (a box without a network at level 1, a restricted process at level 2 off by default, enforced permissions, a typed confirmation for full trust). In short:

- **An extension has full power**: Node, the network, processes, files. **There is no sandbox.** The design no longer tries to confine what an extension can do; it makes sure the user **knows** what they install and can **always turn it off and see what it did**.
- **Two levels only**: **level 0** (declarative data: menu items, commands, themes, key schemes, file type associations) and **one level of code**: real code, in a **process separate from the main one**.
- **A warning at install** (publisher, signed or not, what the extension *declares* it will use: informative, not restrictive) that the user confirms. **Installing an unsigned extension is allowed** (side load is free, with the warning).
- **A catalog** hosted by the project, **curated and signed** (the project's name is in front of it). Manual install is free.
- **Safe mode** (`--safe-mode` and a button) starts with no extension; an **activity log** records what each extension did (files written, processes started): transparency, not restriction.
- **What the application's API protects, and what it does not.** An extension that goes through the **application's API** gets its protections (trash, atomic writes, Local History, authorised roots); an extension that does things on its own is on its own, and the install warning says so. The README and the user guide must say plainly: **the guarantees "nothing leaves the computer" and "writes only inside the authorised roots" hold for the core, not for third-party extensions.**

## 1. Principles

1. **Informed consent instead of confinement.** An extension may do what the user can do. What it **declares** (files, network, processes) is shown at install, as information. The user confirms; nothing is silently granted, and nothing is silently restricted. *(Replaces "deny by default" and the permission-grant model.)*
2. **Data before code.** Most of what people want (themes, keys, languages, commands that start a program) is **data**: validated against a schema, never run. Level 0 stays, and stays the cheapest path.
3. **Code runs outside the main process.** A level 1 extension is real code in a **separate process** (a utility process), so that one that hangs, loops or crashes **cannot take the application down**, and the user can always switch it off. This is the only isolation promised: it is about **stability**, not about confinement.
4. **The core keeps its promises; extensions carry their own.** "Nothing leaves the computer" and "only the authorised roots are written" are guarantees of the **core**. The application never runs a third-party extension's code in the core's process, and says in the README, the guide and the install warning that those guarantees **do not extend to third-party extensions**.
5. **The API is the safe road, and the easy one.** A call through the application's API gets the protections (the guard on paths and roots, atomic writes, the trash, Local History). The API is made to be **more convenient than doing it alone**, so that most extensions take the safe road.
6. **Trust is a chain of signatures where there are signatures.** The catalog is signed and curated; a package may be signed by its publisher; the install warning shows whether it is and by whom. A download host is never trusted by itself. An **unsigned** package is allowed, labelled as such.
7. **Everything can be switched off and inspected.** A safe mode starts with no extension; an extension can be disabled, removed or **revoked** (a signed blocklist, for the catalog) without a release; the activity log shows what it did.
8. **Performance is part of the contract** (the rule at the top of `TODO.md`): nothing is loaded at start except a small index; code activates on demand and stops when idle; a runaway extension can be killed.

## 2. Levels

> **Replaced (2026-10-09):** the old level 1 (code in a box with no network: a worker, a sandboxed frame, WebAssembly) and the old level 2 (a process, off by default, restricted by Node's permission model or "full trust" behind a typed confirmation) are **merged into one level of code**. The sandbox, the permission model, the per-root grants and the "off by default" setting are **dropped**.

| Level | What it is | Runs code? | What it can do | First version |
| --- | --- | --- | --- | --- |
| **0, declarative** | themes, key schemes, language packs, file-type to language, snippets, **Open With entries and commands that start a program** (run by the application, never by the extension), menu entries | no | nothing by itself: the application applies the data | yes |
| **1, code** | everything else: viewers, tools on the selection, converters and readers, panels, helpers that run a program | yes, in a **separate process** from the main one | **everything the user can do** (Node, files, the network, processes). The application's API offers the protected way to do the common things | after the host exists |

The names "level 1" and "level 2" in older notes mean the **one** level 1 above.

## 3. The package: `.fbplugin`

A ZIP file (the application opens it itself, as it opens any ZIP). No symbolic links, no absolute or `..` names, no executables or scripts in level 0, at most N files and M MB (limits in the schema).

```
plugin.json          the manifest (below)
SIGNATURE            optional: a detached ed25519 signature over plugin.json, the file list and their hashes (required for the catalog)
README.md            shown in the extensions page (as text; never as HTML)
icon.png             a raster image only (an SVG icon is refused: it could carry script)
files…               themes/*.json, keymaps/*.json, locales/*.json, snippets/*.json, and for level 1 the code (main.js and what it needs, helper programs per system)
```

**Open question (the package and signature format):** `.fbplugin` as a ZIP with `plugin.json` and `SIGNATURE` is the working proposal; the owner has not confirmed it. See "Open questions" at the end.

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
  "uses": [],                             // declared uses (informative); level 0 declares none
  "contributes": {
    "themes":     [{ "id": "solarized-dark", "label": "Solarized Dark", "base": "dark", "tokens": "themes/dark.json" }],
    "keymaps":    [],
    "languages":  [],
    "openWith":   [],
    "commands":   [],
    "locales":    [],
    "configuration": { "title": "Solarized", "properties": { "contrast": { "type": "enum", "values": ["low", "normal", "high"], "default": "normal", "label": "setting.contrast", "description": "setting.contrast.help" } } }
  },
  "activation": ["onTheme:solarized-dark"],   // when it is loaded; nothing is loaded at start
  "files": { "themes/dark.json": "sha256:9a1f…" }
}
```

A level 1 extension adds `"main": "main.js"` (the entry of its process), a list of **declared uses** (below) and a hash for every file.

### Declared uses (informative, not restrictive)

> **Replaced (2026-10-09):** the table of *permissions* that were denied by default, granted per root and enforced by a broker and Node's permission model. Nothing is enforced any more; what an extension **says** it will use is shown to the user at install so that the confirmation is informed.

| Declared use | What it tells the user |
| --- | --- |
| `files.read`, `files.write` | it reads, or writes, files (the manifest may name where: "the files you select", "the folder it opens", "anywhere") |
| `network` | it connects to the Internet (the manifest may name hosts) |
| `process` | it starts programs (the manifest names which, and any helper it ships) |
| `ui` | it draws a panel, a viewer or a status item |
| `commands` | it adds commands to the palette and menus |
| `storage` | it keeps data of its own |

The declaration is **a promise the publisher makes, not a lock**: the application does not stop an extension that does more. Two reasons to declare honestly: the catalog's curators check the declaration against the code (§6), and the activity log (§4) shows what really happened. An update whose **declared uses grew** is not applied silently: the user is shown the difference and confirms again.

## 3b. Settings of an extension

An extension can have **options the user sets**. They are **declared, not coded**: `contributes.configuration` in the manifest lists them, so the application can **show, search, validate, store and reset them without running a line of the extension's code** (no activation, no risk, no cost at start).

- **Declared**: each property has an id (unique inside the extension; the full key is `<extension id>.<key>`), a **type** (`boolean`; `enum` with its values and a label for each; `number` with `min`, `max` and `step`; `string` with `maxLength`; `colour`; `list` of strings with `maxItems`; `key` (a key binding, checked against the reserved keys); `folder` or `file` (chosen with the application's own picker; the value is **held by the application** and given to the extension by the API); `action` (a button that runs one of the extension's commands)), a **default**, a label and a description as **keys of its locale files** (text, never HTML), an optional `group`, `order`, `keywords` and `enabledWhen` (a plain comparison with another setting of the same extension: `"contrast == 'high'"`, no code), and flags: `scope` (`user` now, `folder` later), `reload` (the extension is restarted when it changes) and `sensitive` (see below).
- **Shown in the Settings page** (the registry of "Settings" accepts contributions): **Settings ▸ Extensions ▸ <name>**, with the same search, the **modified** mark, **Reset** per option and **Reset all of this extension**, the same export and import (only the keys the manifest declares, each checked against its declaration), and a **Settings** button on the extension's card. A disabled extension's options are shown, greyed.
- **Stored by the application**, in `settings.json` under `extensions.<id>` (never by the extension), **validated on every write and every read**: a value of the wrong type, out of range, longer than its limit or not among the enum's values is **refused**, and a stored value that no longer fits (after an update) falls back to the default with a notice. Limits in the schema: at most **100 properties** per extension, strings **4 KB**, lists **1,000 items**, a default of the declared type.
- **Read by the extension** (level 1) through the application's API: `settings.get(key)`, `settings.getAll()` and an event `settings.onChange` (**debounced**, batched, only the keys that changed); an extension can **read only its own** options and **cannot write them** except through a declared `action` or a UI of its own that asks the user (the value goes through the same validation). Level 0 contributions can **refer** to an option (`{setting:contrast}`) in a theme or a command's arguments; the application substitutes the **validated** value as **one argument**, never into a command string.
- **Versions and updates**: a new version may add, rename (`"renamedFrom": "oldKey"`, declared) or remove options; unknown stored keys are dropped; a type that changed resets that option to its default; an option that **changes what the extension declares it reaches** (such as a folder to read) is **never kept silently** across an update that changes it, and **never applied from an imported settings file** without the user's confirmation.
- **Safety rules**: values are **data** (rendered as text, never as HTML or evaluated); there are **no regular-expression patterns** in version 1 (a pattern is a way to hang the page; presets such as `format: "identifier"` come later); an extension **cannot add a setting to another's group** or to the application's own pages; **no secrets in `settings.json`**: a `sensitive` option (a token) is kept with the system's key store (Electron's `safeStorage`), never in `settings.json`, never exported (offered once the host exists); **uninstalling asks** whether to keep or delete the extension's settings and data.
- **Performance**: the options are compiled into the settings registry **at install**, the page lists them with **no extension code running**, reads are an O(1) lookup of a cached value, changes are batched, and a page with many extensions stays one frame to open and to filter.

## 4. Where an extension lives and how it runs

- Installed copy: `userData/extensions/<id>/<version>/`, written from the verified package, **read-only**, never run from the downloaded file or from a folder of the user. An index `installed.json` (id, version, enabled, source, declared uses, hashes) is all that is read at start, with the lock file of §5b.
- Contributions of level 0 are compiled into the application's registries (settings, commands, key table, themes, languages) **at install time**, so start-up reads one small file.
- **Level 0** contributions are data and run nowhere.
- **Level 1 code runs in a process of its own** (an Electron `utilityProcess`), started on activation and stopped when idle, with **no access to the interface's window, its IPC or `window.fb`**. It has **full power** (§0): this is isolation for **stability** (a hang, a loop or a crash is the extension's own: a notice and a restart button, never the window) and for the **kill switch**, not a confinement.
- **The application's API** is how the process asks the application to do things with protection: a message port `{ id, method, params }` to the main process. The calls that touch files go through the **guard** (`resolveInside`, no link out of a root), write **atomically**, delete **to the trash**, and make a **Local History** copy before overwriting an original; there are also notifications, commands, settings and the like. Every call is **validated as untrusted data** (`unknown` until checked) and batched/throttled by the same rules as the interface's IPC. **Using the API is optional**: the process may use Node directly, and then the protections do not apply (the install warning says so). The API is versioned (`api: 1`) with a stability and deprecation promise.
- **The activity log** (a registry of what each extension did, **transparency, not restriction**): the files the extension wrote through the API (and, where the application can know, the processes it started), with the time, kept per extension in a bounded file, shown in **Extensions ▸ <name> ▸ Activity**. It records what the **API** saw and what the **host** started; it cannot see what an extension does on its own with Node, and says so on that page.
- **Resources**: the host limits what it can without confining: it watches the process's memory and time without a reply, and **stops** a hung or runaway one (a notice, a **Restart** and a **Disable**). The user can always kill and disable it.
- **Safe mode**: `--safe-mode` and a button in the application (File ▸ **Restart Without Extensions**) start with **every extension off**; it is offered after a crash at start-up. No extension code runs in safe mode, and level 0 data is not applied either.
- **Helper programs**: an extension that needs a program (a PDF tool, `ffmpeg`, `7z`) ships it per system inside its package or finds the one on the computer; it declares that in `uses` (`process`), and the hash of what it ships is in the manifest.

> **Replaced (2026-10-09), former §4 and §4b:** the `fb-ext://` frame with a CSP per extension and no network; the broker as the only door with permission checks; quotas as a sandbox; level 2 "off by default", Node's permission model (`--permission`), the spike on its flags, restricted versus unrestricted mode, the typed confirmation, the status-bar mark of full trust, "Reviewed level 2" and killing the process on revocation only for level 2. A **spike** on `utilityProcess` is still useful, now only for what the host needs (how to start it, how to hand it a port, how to kill it on each system), not for confinement.

## 5. Installing

**Sources of installation.** The same extension can reach the application from any of these, and the same checks and the same install warning apply to all:

1. **A local file or folder (side load)**: File ▸ Install Extension from File…, a `.fbplugin` dropped on the Extensions page, a double click, or **an unpacked folder** (the same layout; useful for the author, see developer mode). Free; unsigned is allowed.
2. **A repository (a URL or Git repository)**: `owner/repo` of GitHub (shorthand), or the URL of any Git repository, **public or private**, using the credentials the user already has (the `gh` or Git credential helper, or an access token the user gives; §5b). Planned for a later phase; the design reserves it from the start.
3. **The curated catalog**: the project's signed list (§6), opt-in.

**The package works both ways.** An extension is a **folder with `plugin.json`** (in a repository, or unpacked), and **the same folder packed as a `.fbplugin`** (a ZIP, with the optional `SIGNATURE`) is the same extension: one layout serves a repository checkout and a release asset. The installer treats both identically after it has the files.

**The install warning** (always shown; **informative, not restrictive**; the user confirms): the **name and version**; the **publisher**; whether the package is **signed or not**, and by whom (the key's fingerprint); the **origin**: the **repository URL and the commit or tag** (or the file's path, or "catalog"); what it **contributes**; what it **declares it will use** (`uses`: files, network, processes, UI…); its size; and a plain line when the extension has **code** that it **runs with full power and is not confined by the application**. **Install** is the default button only for a catalog entry; every other source needs the explicit confirmation. Installing an **unsigned** package is allowed.

- **Developer mode** (a setting, off by default, with a banner while on): load an **unpacked folder**, reload on change, show errors; it never persists across a start unless the user chose to.
- **Installation is atomic** (unpack to a temporary folder, verify, rename) and keeps the previous version for a **rollback**.
- **Updates are never automatic by default** (§5b): the user is told and chooses.
- **Uninstall** removes the extension's folder and, if the user chooses, its data and settings; **revert** returns to the previous installed version.

### Trust labels

| Label | Meaning |
| --- | --- |
| **From the catalog** | in the project's curated, signed catalog; the entry pins this package's hash (reviewed by the project) |
| **Signed by a publisher you trust** | signed by a key the user trusted before (the store of trusted signers, `core/signers.ts`) |
| **Signed, unknown publisher** | valid signature, unknown key: the fingerprint is shown; trust is a conscious choice |
| **From a repository** | fetched from a Git repository at a pinned commit; the URL and commit are shown; says nothing about the code's quality |
| **Unsigned** | no signature: allowed, shown plainly. Every source can be unsigned except the catalog |

## 5b. Installing from a repository (planned; reserved by the design)

The owner wants to **install extensions from a repository in the future**, so the specification provides for it now, even if the implementation comes after the catalog (phase 7 in `docs/todo/extensions.md`).

- **The repository manifest ("marketplace")**: a file in a repository (`fb-marketplace.json`, in the style of Claude Code's `marketplace.json`) that **lists several extensions**: `name`, `owner`, and `extensions[]`, each with `id`, `name`, `description`, `version`, and a **`source`**: a path **relative** to the repository (`"./extensions/pdf-pages"`) or **another repository** (`{ "repo": "owner/other", "ref": "v1.2.0", "commit": "9f3c…" }`). The user adds a repository as a "source of extensions"; the application reads the file (and nothing else) to show the list. A repository with a single extension may just have `plugin.json` at its root.
- **Pinned versions**: an install is always at a **commit or tag**, never "the latest of the branch" without the user knowing. A tag or branch is **resolved to a full commit hash at install time and the hash is what is stored**; the warning shows both ("v1.2.0 = 9f3c…"). A tag that later points elsewhere is detected (§5b lock file) and reported.
- **The lock file** (`userData/extensions/extensions.lock.json`): for each installed extension, the **source** (repository URL or path or catalog), the **ref asked for**, the **commit installed**, the manifest's `version`, the hash of the installed tree and the date. It makes an install **reproducible** (the same lock installs the same bytes on another computer) and is what updates and reverts compare against. A copy of the lock can be exported and imported (an import is an install, with the warning for each entry).
- **How the application fetches**: it must **not require Git to be installed**. The working proposal is to download the repository's **archive at the commit** (for GitHub, `https://api.github.com/repos/<owner>/<repo>/zipball/<sha>`, or the tarball), which the application already knows how to read as a ZIP, with **git-over-HTTPS** (a small implementation, or the library) as a fallback for hosts that offer no archive. Private repositories: see the open questions. The download is verified by the **commit hash** the host reports and by the tree's own hash that the lock records.
- **Updates**: **never automatic by default.** An opt-in "check for updates" (on demand, or at most daily if the user turns it on) compares each installed extension's source with the lock and, when a newer tag or commit exists, **tells the user**. The update screen **shows what changed between the two commits** (the changed files and the manifest's difference: `version`, `uses`, `contributes`; a link to the compare page of the host), and the user confirms. An update that **grows the declared uses** needs the confirmation again with the difference highlighted.
- **Revert and uninstall**: the previous installed version is kept (one back) so **Revert** is one click, and the lock records it; **Uninstall** removes the folder, the lock entry, and (the user chooses) the extension's data and settings.
- The origin is shown on every screen that names the extension (the card, the warning, the update): the **repository URL, the commit or tag and the publisher**.

## 6. The online catalog (the sketch)

The catalog is **curated and signed by the project** (the project's name is in front of it): an entry means a maintainer read the extension and checked that what it declares (`uses`) matches what its code does. It is one source among three (§5); manual install and repositories stay free. The catalog is a **static website**, no server code, no accounts, no database, no tracking: files in a public git repository (`folder-browser-extensions`) published as static pages (GitHub Pages or a release asset), so the only moving part is a pull request.

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
      "uses": [],
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
- An **update** is offered, never applied: the page says "1.3.0 is available" and shows the difference in the declared uses; the user clicks.
- **Revocation**: when the blocklist is fetched, an installed extension or publisher key that appears in it is **disabled at once** with a notice. Without the catalog turned on the application cannot know, and the page says so.
- **Air gap and mirrors**: **Browse a catalog from a folder** (an `index.json` and its signature on disk, with the packages beside it) works with no network; a company can mirror the catalog, and the application still requires **the catalog key's signature** (a mirror is only a cache). A different catalog **key** is a developer-mode setting, never the default.

**Publishing (the repository's side).** An author opens a pull request that adds a manifest and a link to a release. CI checks the schema, the sizes, the hashes, that a level 0 package carries no code, that the declared `uses` are what the description says, the id's namespace (the publisher id must match the GitHub account or organisation that owns the package's repository, to stop **typosquatting** and impersonation), and runs the extension-package **fuzz and bomb tests**. A **human review** is required for every extension with code and for any growth of `uses`: the reviewer reads the source and checks it against the declaration. Merging publishes the next `sequence`, signed **offline** by a maintainer's key held on a hardware token (the catalog key is never on a CI server).

**Governance** (`docs/EXTENSIONS-POLICY.md`, to write): what may be published (no network, no telemetry, no obfuscated code, a licence), how to report a malicious extension (a private security contact), the **takedown and revocation** process and its time target, key rotation and what happens when a publisher key leaks, and the API's **stability promise** (semver, a deprecation period).

## 7. Threat model (what the tests must cover)

| Threat | Defence |
| --- | --- |
| A package with `../` names, absolute paths, symlinks, a ZIP bomb, a million files | the package reader refuses them (`safeRelative`, limits on size, count and ratio) before anything is written |
| A tampered or replaced package | pinned SHA-256 in a signed entry, signature on the package, per-file hashes |
| A rolled back or frozen index (an old vulnerable version offered again) | `sequence` and a freshness limit; the installed version is never downgraded without a choice |
| A compromised publisher key | the signed blocklist disables it; keys are per publisher, so one leak is bounded |
| Typosquatting, impersonation, a look-alike name | the namespace rule, a visible publisher fingerprint, "From the catalog" shown only for catalog entries |
| An update that grows the declared uses | not applied until the user confirms again, with the difference shown; no automatic update by default |
| A setting used to attack: a huge default, a million-item list, a hostile string shown as HTML, a regular expression that hangs the page, a value that changes what the extension reaches slipped in by an import or an update | declared and bounded in the schema, validated on every write and read, rendered as text, no patterns in version 1, folders held by the application, options that change what is reached need the user's confirmation |
| **Accepted, by the owner's decision (§0):** an extension with code that reads or writes files, starts programs or uses the network on its own | **not prevented.** Defences are informative: the install warning (publisher, signed or not, origin, what it declares), the curated catalog, the activity log, the safe mode and the ability to disable or revoke. The README and the guide say the core's guarantees do not extend to extensions |
| An extension that writes over an original through the API | the API's protections: the guard, an atomic write, the trash, a **Local History** copy first (so Local History must exist before such extensions) |
| An extension installed by trickery (a dropped file, an imported settings file, a link, a `folder-browser://` link) | the install warning is **always** shown and needs the user's click; nothing installs from a link, a drop or an import without it; a settings import never installs or enables an extension |
| An extension process that hangs, loops, leaks or crashes | a separate process: the window survives; the host stops a hung one, shows a notice, a Restart and a Disable; started on activation and stopped when idle |
| A repository source: a tag moved after review, a branch that changes under the user, a replaced archive | the install is pinned to a **commit hash**; the lock file records source, commit and tree hash; an update is shown as a diff between commits and confirmed; a tag that moved is reported |
| A malicious or look-alike repository (`owner/repo` typo) | the warning shows the full repository URL, the commit and the publisher; nothing is trusted because of a name; the catalog's namespace rule applies only to the catalog |
| Credentials for a private repository leaking | the application does not store tokens in `settings.json`: it asks the `gh` or Git credential helper or uses the system's key store (`safeStorage`); a token is never sent anywhere but the repository's host |
| Exfiltration by an extension | **not prevented** (accepted); the API itself sends nothing; the declared `network` is shown at install |
| A busy loop, a memory bomb | the process is separate, the host stops it, the user can kill it, a safe mode |
| UI spoofing (a panel that looks like the application's own dialog) | an extension's panel is labelled with its name and a "from an extension" mark; the application's own dialogs (the install warning among them) are never drawn by an extension |
| Key hijacking (`Ctrl+S`, `Ctrl+W`, Delete) | a **reserved keys** list an extension cannot bind |
| Injection through contributed strings (names, descriptions, commands) | rendered as **text**, never HTML; icons only as raster images |
| A command entry that starts a program | run by the application, **without a shell**, an argument list, `{file}` substituted as one argument, shown and confirmed at install and again on the first run |
| A malicious JSON (huge, deeply nested, prototype pollution) | a size and depth limit, `JSON.parse` then a strict schema that builds a **new** object |
| A catalog host that logs users | opt-in, a plain explanation, no identifier, a mirror and air-gap path |

## 8. What it does not do (version 1)

**Confining an extension** (a sandbox, enforced permissions, per-root grants): dropped by the owner's decision (§0). Also not planned: dependencies between extensions, accounts, payments, ratings or comments, telemetry, **automatic updates by default**. Installing from a repository is **planned** (§5b), after the catalog.

## 9. First-party extensions: the application builds its own complex features on the same model

The most complex items of `TODO.md` (a 7z or tar reader, an audio decoder, subtitle rendering, image codecs, metadata readers, a SQLite viewer, a Git view, a duplicates finder, the playlists' formats) are **built as extensions**, not as code in the core, when they fit. Reasons: the **core stays small and fast** (a smaller installer, nothing loaded at start: the performance rule); **risky parsers run in a process of their own** (a crash or a hang in a 7z reader cannot take the window down; this is about stability, not confinement, §0); a **dependency with another licence** (7-Zip is LGPL, a decoder may be GPL) stays **out of the core's licence** and in an extension of its own; a feature can be **installed, disabled or revoked** without a new release; and the API is **proved by real use** (a point is added to the API only when a built-in feature needs it).

**The rule of thumb.** *Core* when it is a security boundary (the roots, safe writes, the application's API itself), a safety net (Local History), the performance-critical interface (the tree, the tabs, the editors, the hex view) or the foundation others stand on (settings, commands, keys). *Extension* when it is a **reader, writer, codec, viewer, tool or panel**, it can work through the application's API, it pulls a heavy or differently-licensed dependency, or it is not needed on the first run.

**Core and extension, by the owner's decision (2026-10-09).** The **core keeps the basics**: browsing, viewing (PDF, images, media, hex), editing text, diff, ZIP, file operations, the trash. These are **extensions**: **PDF manipulation** (rotate, delete and reorder pages, merge, annotate, forms), **image editing and EXIF**, **tar and 7z**, **playlists**, and the **"file intelligence" packs**. **The first extension that proves the API** is **"PDF: rotate, delete and reorder pages"** (or, as a fallback, rotate and crop an image): a real feature that writes over an original through the API, so it exercises the guard, the atomic write, the trash and Local History. **Local History must exist before, or together with, the first extension that writes over originals.** (The reader/viewer for PDFs in the core stays: only the page manipulation is an extension.)

**Built in, or from the catalog.** A first-party extension is **signed by the project** and either **ships inside the installer** (enabled by default, marked *Built in*, can be turned off; for what nearly everyone needs) or is an **Official** entry of the catalog (installed on demand, for what is large or rare, such as a 7z engine or an audio decoder). The user can see and disable either kind in the same Extensions page, and the same revocation applies.

**Extension-shaped before the extension system exists.** The near-term items must not wait. Until the extension points are real, such a feature is written **as if it were an extension**: its own folder (`extensions/<id>/` with a `plugin.json` that already says its level and declared uses), its code reaching the application **only through an internal host interface shaped like the future API** (typed calls, no imports of the application's internals), its data in its own folder, its dependencies bundled with it, and its tests running against a **fake host**. Moving it into the box later is then a build step, not a rewrite.

See "Extension-first" in `TODO.md` for which item goes where.

## 10. Authoring: zero entry cost

**The owner's requirement (2026-10-09):** "We will generate documentation that other agents can use to create the plugins; I want anyone with an idea in their head and the will to be able to create their plugin. This is **zero entry cost**."

So the **authoring kit is part of the API, not an afterthought**: it is born together with it, and **documentation comes first** (the contract is written before the code, and the code is checked against it). The earlier plan to write the guide "after phases 1 to 3" is **replaced**: the guide, the typed API and the first templates are written in the same phase as the host's API, and a phase does not close without them.

**The kit**

1. **An authoring guide for agents**: one **self-contained file**, in English, `PLUGIN-AUTHORING-FOR-AGENTS.md`, plus a Claude Code **skill** (`fb-plugin-author`) and an **`AGENTS.md`** the user can drop in any empty folder to start. It holds the mental model (what an extension is, the two levels, what the application protects and what it does not), the manifest field by field, **each kind of contribution** (a command, a menu item, a file type, a viewer, "bytes in, bytes out" for a transformation), the API with **short examples**, the do's and don'ts, and the **common mistakes** with the fix for each. It is written for a reader that **cannot ask questions**: complete, exact, with examples that run.
2. **The typed API** (`.d.ts`): generated **from the application's own types**, published with the application and as a package, so that an editor and an agent can check a call before running anything. A broken or stale `.d.ts` fails the build.
3. **Templates and working examples** for the common cases: a command, a file type, a **PDF transformation**, an **image transformation**, a viewer; each one **builds, tests and installs** (checked by CI).
4. **A command-line tool, `fb-plugin`**: `new` (creates the skeleton from a sentence), `validate`, `test` (a harness that simulates the application), `pack` (makes the `.fbplugin`), `install --dev`; offline, with `--json` output and stable error codes.
5. **A development mode with automatic reload** inside the application (as Claude Code does with mods) and **clear errors that say what to fix** (the field, the rule, the example).
6. **The acceptance criterion of the kit**: an agent that reads **only** the guide and the typed API can **write, validate, test and install a new extension at the first attempt, without help**. The test: give an agent a **one-sentence idea** and see whether a working extension comes out. **The phase closes only when this passes** (on several different ideas, with a fresh agent each time, and the result recorded).

`docs/EXTENSIONS.md` (the human guide, in English and Brazilian Portuguese) and the agents' file say the same things; one is generated from the other's sources so they cannot drift. Details of the longer outline follow; they are the table of contents of both.

- **Start here**: what an extension is, the three levels and how to choose, what is not possible and why, the trust labels, the five-minute path (`fb-plugin init`, edit, `validate`, `pack`, install from file).
- **The manifest, field by field**: every key, its type and limits, a worked example per contribution point, and the **JSON Schema** files (`docs/schema/*.json`) that the validator and the catalog use, so a tool can read them directly.
- **The host API reference**: every method, its parameters and results, errors with **stable codes**, what the API protects, limits, and a runnable example; generated from the same TypeScript types the application uses, so it cannot drift.
- **Recipes**: a theme, a key scheme, a language pack, an Open With command, a command that transforms the selected text, a viewer for a file type, a converter, a metadata reader, a panel, a tool that writes over originals through the API (and what Local History does for it), and one that runs a helper program.
- **Security rules the extension must follow, and what the host enforces**: no network, no HTML from data, strings are text, the reserved keys, the quotas, what is logged; the threat model's table written as a checklist an author can run through.
- **Testing**: a **test host** (`fb-plugin test`: a fake host API with fixtures, a virtual file system and a clock) that runs an extension's tests with no application, **performance budgets** for the extension (activation time, memory, call latency) and how to measure them.
- **Publishing**: the pull request flow to the catalog, signing, versions and the `engines` range, how a review works and how long it takes, how to take a version down, key rotation, the policy.
- **For agents**: a short **`AGENTS.md`** at the template's root and a `llms.txt`-style index of the guide (what to read first, the commands to run, the definition of done), **machine-readable output** from every `fb-plugin` command (`--json`, stable error codes with a one-line fix each), a **conformance checklist** that the catalog's CI runs and an agent can run first, and a rule written down: *never* declare a use the extension does not have, and *never* use one it did not declare, *never* fetch or evaluate code at run time, and **stop and ask the person** before publishing.
- **Templates**: one repository template per kind (theme, keymap, language, command, viewer, converter, tool with a helper program), each with its tests, a `README`, the `AGENTS.md` and a release workflow that builds, packs and signs reproducibly.


## 11. Open questions (the owner decides; none is blocking the first phases)

1. **The package and the signature**: is `.fbplugin` a ZIP with `plugin.json` plus an optional ed25519 `SIGNATURE` (the working proposal, reusing `core/validate/signature.ts` and `core/signers.ts`)? Is a folder in a repository the same layout (§5)? Who signs what: the publisher, the catalog, or both?
2. **Where the code runs and how it talks to the application**: an Electron `utilityProcess` per extension with a `MessagePort` to the main process (the proposal) or a child process with its own Node and a socket or stdio? One process per extension or a shared one? How a helper binary per system is packaged and hash-pinned?
3. **The minimum API a PDF extension needs** ("rotate, delete and reorder pages"): read a file's bytes (range or whole), write bytes atomically over the original with a Local History copy, a selection (which files are marked), a command and menu entry for PDFs, progress and cancellation, a notification, and settings. Is that the right floor, and which of these is the first API point to build?
4. **Safe mode and the activity log**: is the log kept per extension in a bounded file (the proposal)? What exactly is recorded when an extension uses Node directly and the application cannot see it (nothing, and the page says so; or a process-level record of children started)? Does safe mode also skip level 0 data?
5. **How the catalog is hosted**: static pages (GitHub Pages) with a mirror, signed offline (§6); who holds the catalog key; the takedown time target; do first-party extensions live in the catalog's repository or in this one?
6. **Installing from a repository** (§5b): how does the application authenticate to a **private** repository (reuse the `gh` or Git credential helper, the system's key store, or an access token pasted by the user)? How does it fetch without Git installed (the host's archive at a commit, with git-over-HTTPS as a fallback), and for hosts other than GitHub? How is the commit pinned and verified (the commit hash plus a hash of the tree in the lock file; what to do when a force-push removes the commit)? What is the `fb-marketplace.json` format exactly, and do we reuse Claude Code's `marketplace.json` shape field for field?
7. **The word** in the interface: Extensions (the proposal) or Plugins.
8. **The authoring kit** (§10): which agent(s) and how many ideas count as the acceptance test (the proposal: five one-sentence ideas of different kinds, a fresh agent each, all five working first time)? Are the skill and `AGENTS.md` shipped in the repository, in the application, or both? Is the `.d.ts` a separate npm package, and does `fb-plugin` become a package too (`npx fb-plugin new`)? How does "create from a sentence" work in `new` (a template picked by keywords, or the agent writes it and the tool only validates)? Does the development mode reload from an unpacked folder only?
