# Plugins: the design sketch

Status: **a sketch, not built.** The plan and its boxes are in `TODO.md`, "Plugins". This file is what the plan rests on: the trust model, the package, the online catalog and the threat model.

**The word (decided 2026-10-09): "Plugins".** The interface says Plugins (the Plugins menu, "Install Plugin…", the guide "Create a plugin"), and so does this design. The names of the two plan files (`docs/EXTENSIONS-DESIGN.md`, `docs/todo/extensions.md`) are kept as they are so that no link breaks. The decisions of the owner of 2026-10-09 on the questions that were open are in section 11.

## 0. The decision of the owner (2026-10-09): the trust model

> "I wanted these plugins to be as flexible as possible with little limitation, because it is a way to extend the life of the application. At most a warning for the user to validate. Apart from that, everything would be allowed."

Of three models, the owner chose **a warning at install plus a safe mode**. It **replaces** the earlier model (a box without a network at level 1, a restricted process at level 2 off by default, enforced permissions, a typed confirmation for full trust). In short:

- **A plugin has full power**: Node, the network, processes, files. **There is no sandbox.** The design no longer tries to confine what a plugin can do; it makes sure the user **knows** what they install and can **always turn it off and see what it did**.
- **Two levels only**: **level 0** (declarative data: menu items, commands, themes, key schemes, file type associations) and **one level of code**: real code, in a **process separate from the main one**.
- **A warning at install** (publisher, signed or not, what the plugin *declares* it will use: informative, not restrictive) that the user confirms. **Installing an unsigned plugin is allowed** (side load is free, with the warning).
- **A catalog** hosted by the project, **curated and signed** (the project's name is in front of it). Manual install is free.
- **Safe mode** (`--safe-mode` and a button) starts with no plugin; an **activity log** records what each plugin did (files written, processes started): transparency, not restriction.
- **What the application's API protects, and what it does not.** A plugin that goes through the **application's API** gets its protections (trash, atomic writes, Local History, authorised roots); a plugin that does things on its own is on its own, and the install warning says so. The README and the user guide must say plainly: **the guarantees "nothing leaves the computer" and "writes only inside the authorised roots" hold for the core, not for third-party plugins.**

## 1. Principles

1. **Informed consent instead of confinement.** A plugin may do what the user can do. What it **declares** (files, network, processes) is shown at install, as information. The user confirms; nothing is silently granted, and nothing is silently restricted. *(Replaces "deny by default" and the permission-grant model.)*
2. **Data before code.** Most of what people want (themes, keys, languages, commands that start a program) is **data**: validated against a schema, never run. Level 0 stays, and stays the cheapest path.
3. **Code runs outside the main process.** A level 1 plugin is real code in a **separate process** (a utility process), so that one that hangs, loops or crashes **cannot take the application down**, and the user can always switch it off. This is the only isolation promised: it is about **stability**, not about confinement.
4. **The core keeps its promises; plugins carry their own.** "Nothing leaves the computer" and "only the authorised roots are written" are guarantees of the **core**. The application never runs a third-party plugin's code in the core's process, and says in the README, the guide and the install warning that those guarantees **do not extend to third-party plugins**.
5. **The API is the safe road, and the easy one.** A call through the application's API gets the protections (the guard on paths and roots, atomic writes, the trash, Local History). The API is made to be **more convenient than doing it alone**, so that most plugins take the safe road.
6. **Trust is a chain of signatures where there are signatures.** The catalog is signed and curated; a package may be signed by its publisher; the install warning shows whether it is and by whom. A download host is never trusted by itself. An **unsigned** package is allowed, labelled as such.
7. **Everything can be switched off and inspected.** A safe mode starts with no plugin; a plugin can be disabled, removed or **revoked** (a signed blocklist, for the catalog) without a release; the activity log shows what it did.
8. **Performance is part of the contract** (the rule at the top of `TODO.md`): nothing is loaded at start except a small index; code activates on demand and stops when idle; a runaway plugin can be killed.

## 2. Levels

> **Replaced (2026-10-09):** the old level 1 (code in a box with no network: a worker, a sandboxed frame, WebAssembly) and the old level 2 (a process, off by default, restricted by Node's permission model or "full trust" behind a typed confirmation) are **merged into one level of code**. The sandbox, the permission model, the per-root grants and the "off by default" setting are **dropped**.

| Level | What it is | Runs code? | What it can do | First version |
| --- | --- | --- | --- | --- |
| **0, declarative** | themes, key schemes, language packs, file-type to language, snippets, **Open With entries and commands that start a program** (run by the application, never by the plugin), menu entries | no | nothing by itself: the application applies the data | yes |
| **1, code** | everything else: viewers, tools on the selection, converters and readers, panels, helpers that run a program | yes, in a **separate process** from the main one | **everything the user can do** (Node, files, the network, processes). The application's API offers the protected way to do the common things | after the host exists |

The names "level 1" and "level 2" in older notes mean the **one** level 1 above.

## 3. The package: `.fbplugin`

A ZIP file (the application opens it itself, as it opens any ZIP). No symbolic links, no absolute or `..` names, no executables or scripts in level 0, at most N files and M MB (limits in the schema).

```
plugin.json          the manifest (below)
SIGNATURE            optional: a detached ed25519 signature over plugin.json, the file list and their hashes (required for the catalog)
README.md            shown in the plugins page (as text; never as HTML)
icon.png             a raster image only (an SVG icon is refused: it could carry script)
files…               themes/*.json, keymaps/*.json, locales/*.json, snippets/*.json, and for level 1 the code (main.js and what it needs, helper programs per system)
```

**Decided (2026-10-09), the package and the signature:** `.fbplugin` is a ZIP with `plugin.json`, the code and an **optional ed25519 signature**. A plugin without a signature **can be installed** (the warning says so). The same layout works as **a folder in a repository**. See section 11, decision 1.

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
    "configuration": { "title": "Solarized", "properties": { "contrast": { "type": "enum", "values": ["low", "normal", "high"], "valueLabels": ["contrast.low", "contrast.normal", "contrast.high"], "default": "normal", "label": "setting.contrast", "description": "setting.contrast.help" } } }
  },
  "activation": ["onTheme:solarized-dark"],   // when it is loaded; nothing is loaded at start
  "files": { "themes/dark.json": "sha256:9a1f…" } // illustrative abbreviated hash; a real manifest needs 64 hex digits
}
```

The key and hash above are illustrative abbreviations, not valid fixture values: `ed25519:` and `sha256:` each require 64 hexadecimal digits. The local setting `contrast` has the full registry key `acme.solarized:contrast` (`<pluginId>:<key>`); an already namespaced property key is also accepted. Enum `valueLabels` has one locale key per `values` entry.

A level 1 plugin adds `"main": "main.js"` (the entry of its process), a list of **declared uses** (below) and a hash for every file.

### Declared uses (informative, not restrictive)

> **Replaced (2026-10-09):** the table of *permissions* that were denied by default, granted per root and enforced by a broker and Node's permission model. Nothing is enforced any more; what a plugin **says** it will use is shown to the user at install so that the confirmation is informed.

| Declared use | What it tells the user |
| --- | --- |
| `files.read`, `files.write` | it reads, or writes, files (the manifest may name where: "the files you select", "the folder it opens", "anywhere") |
| `network` | it connects to the Internet (the manifest may name hosts) |
| `process` | it starts programs (the manifest names which, and any helper it ships) |
| `ui` | it draws a panel, a viewer or a status item |
| `commands` | it adds commands to the palette and menus |
| `storage` | it keeps data of its own |

The declaration is **a promise the publisher makes, not a lock**: the application does not stop a plugin that does more. Two reasons to declare honestly: the catalog's curators check the declaration against the code (§6), and the activity log (§4) shows what really happened. An update whose **declared uses grew** is not applied silently: the user is shown the difference and confirms again.

## 3b. Settings of a plugin

A plugin can have **options the user sets**. They are **declared, not coded**: `contributes.configuration` in the manifest lists them, so the application can **show, search, validate, store and reset them without running a line of the plugin's code** (no activation, no risk, no cost at start).

- **Declared**: each property has an id (unique inside the plugin; the full key is `<pluginId>:<key>`), a **type** (`boolean`; `enum` with `values` and a locale key in `valueLabels` for each; `number` with `min`, `max` and `step`; `string` with `maxLength`; `colour`; `list` of strings with `maxItems`; `key` (a key binding, checked against the reserved keys); `folder` or `file` (chosen with the application's own picker; the value is **held by the application** and given to the plugin by the API); `action` (a button that runs one of the plugin's commands)), a **default**, a label and a description as **keys of its locale files** (text, never HTML), an optional `group`, `order`, `keywords` and `enabledWhen` (a plain comparison with another setting of the same plugin: `"contrast == 'high'"`, no code), and flags: `scope` (`user` now, `folder` later), `reload` (the plugin is restarted when it changes) and `sensitive` (see below).
- **Shown in the Settings page** (the registry of "Settings" accepts contributions): **Settings ▸ Plugins ▸ <name>**, with the same search, the **modified** mark, **Reset** per option and **Reset all of this plugin**, the same export and import (only the keys the manifest declares, each checked against its declaration), and a **Settings** button on the plugin's card. A disabled plugin's options are shown, greyed.
- **Stored by the application**, in `settings.json` under `plugins.<id>` (never by the plugin), **validated on every write and every read**: a value of the wrong type, out of range, longer than its limit or not among the enum's values is **refused**, and a stored value that no longer fits (after an update) falls back to the default with a notice. Limits in the schema: at most **100 properties** per plugin, strings **4 KB**, lists **1,000 items**, a default of the declared type.
- **Read by the plugin** (level 1) through the application's API: `settings.get(key)`, `settings.getAll()` and an event `settings.onChange` (**debounced**, batched, only the keys that changed); a plugin can **read only its own** options and **cannot write them** except through a declared `action` or a UI of its own that asks the user (the value goes through the same validation). Level 0 contributions can **refer** to an option (`{setting:contrast}`) in a theme or a command's arguments; the application substitutes the **validated** value as **one argument**, never into a command string.
- **Versions and updates**: a new version may add, rename (`"renamedFrom": "oldKey"`, declared) or remove options; unknown stored keys are dropped; a type that changed resets that option to its default; an option that **changes what the plugin declares it reaches** (such as a folder to read) is **never kept silently** across an update that changes it, and **never applied from an imported settings file** without the user's confirmation.
- **Safety rules**: values are **data** (rendered as text, never as HTML or evaluated); there are **no regular-expression patterns** in version 1 (a pattern is a way to hang the page; presets such as `format: "identifier"` come later); a plugin **cannot add a setting to another's group** or to the application's own pages; **no secrets in `settings.json`**: a `sensitive` option (a token) is kept with the system's key store (Electron's `safeStorage`), never in `settings.json`, never exported (offered once the host exists); **uninstalling asks** whether to keep or delete the plugin's settings and data.
- **Performance**: the options are compiled into the settings registry **at install**, the page lists them with **no plugin code running**, reads are an O(1) lookup of a cached value, changes are batched, and a page with many plugins stays one frame to open and to filter.

## 4. Where a plugin lives and how it runs

- Installed copy: `userData/plugins/<id>/<version>/`, written from the verified package, **read-only**, never run from the downloaded file or from a folder of the user. An index `installed.json` (id, version, enabled, source, declared uses, hashes) is all that is read at start, with the lock file of §5b.
- Contributions of level 0 are compiled into the application's registries (settings, commands, key table, themes, languages) **at install time**, so start-up reads one small file.
- **Level 0** contributions are data and run nowhere.
- **Level 1 code runs in a process of its own. Decided (2026-10-09): one process per plugin**, an Electron `utilityProcess`, talking to the main process over a `MessagePort`. It is started on activation and stopped when idle, with **no access to the interface's window, its IPC or `window.fb`**. It has **full power** (§0): this is isolation for **stability** (a hang, a loop or a crash is the plugin's own: a notice and a restart button, never the window) and for the **kill switch**, not a confinement.
- **The application's API** is how the process asks the application to do things with protection: a message port `{ id, method, params }` to the main process. The calls that touch files go through the **guard** (`resolveInside`, no link out of a root), write **atomically**, delete **to the trash**, and make a **Local History** copy before overwriting an original; there are also notifications, commands, settings and the like. Every call is **validated as untrusted data** (`unknown` until checked) and batched/throttled by the same rules as the interface's IPC. **Using the API is optional**: the process may use Node directly, and then the protections do not apply (the install warning says so). The API is versioned (`api: 1`) with a stability and deprecation promise.
- **The activity log** (a registry of what each plugin did, **transparency, not restriction**): the files the plugin wrote through the API (and, where the application can know, the processes it started), with the time, kept per plugin in a bounded file, shown in **Plugins ▸ <name> ▸ Activity**. It records what the **API** saw and what the **host** started; it cannot see what a plugin does on its own with Node, and says so on that page.
- **Resources**: the host limits what it can without confining: it watches the process's memory and time without a reply, and **stops** a hung or runaway one (a notice, a **Restart** and a **Disable**). The user can always kill and disable it.
- **Safe mode**: `--safe-mode` and a button in the application (File ▸ **Restart Without Plugins**) start with **every plugin off**; it is offered after a crash at start-up. No plugin code runs in safe mode, and level 0 data is not applied either.
- **Helper programs**: a plugin that needs a program (a PDF tool, `ffmpeg`, `7z`) ships it per system inside its package or finds the one on the computer; it declares that in `uses` (`process`), and the hash of what it ships is in the manifest.

> **Replaced (2026-10-09), former §4 and §4b:** the `fb-ext://` frame with a CSP per plugin and no network; the broker as the only door with permission checks; quotas as a sandbox; level 2 "off by default", Node's permission model (`--permission`), the spike on its flags, restricted versus unrestricted mode, the typed confirmation, the status-bar mark of full trust, "Reviewed level 2" and killing the process on revocation only for level 2. A **spike** on `utilityProcess` is still useful, now only for what the host needs (how to start it, how to hand it a port, how to kill it on each system), not for confinement.

## 5. Installing

**Sources of installation.** The same plugin can reach the application from any of these, and the same checks and the same install warning apply to all:

1. **A local file or folder (side load)**: File ▸ Install Plugin from File…, a `.fbplugin` dropped on the Plugins page, a double click, or **an unpacked folder** (the same layout; useful for the author, see developer mode). Free; unsigned is allowed.
2. **A repository (a URL or Git repository)**: `owner/repo` of GitHub (shorthand), or the URL of any Git repository, **public or private**, using the credentials the user already has (the `gh` or Git credential helper, or an access token the user gives; §5b). Planned for a later phase; the design reserves it from the start.
3. **The curated catalog**: the project's signed list (§6), opt-in.

**The package works both ways.** A plugin is a **folder with `plugin.json`** (in a repository, or unpacked), and **the same folder packed as a `.fbplugin`** (a ZIP, with the optional `SIGNATURE`) is the same plugin: one layout serves a repository checkout and a release asset. The installer treats both identically after it has the files.

**The install warning** (always shown; **informative, not restrictive**; the user confirms): the **name and version**; the **publisher**; whether the package is **signed or not**, and by whom (the key's fingerprint); the **origin**: the **repository URL and the commit or tag** (or the file's path, or "catalog"); what it **contributes**; what it **declares it will use** (`uses`: files, network, processes, UI…); its size; and a plain line when the plugin has **code** that it **runs with full power and is not confined by the application**. **Install** is the default button only for a catalog entry; every other source needs the explicit confirmation. Installing an **unsigned** package is allowed.

- **Developer mode** (a setting, off by default, with a banner while on): load an **unpacked folder**, reload on change, show errors; it never persists across a start unless the user chose to.
- **Installation is atomic** (unpack to a temporary folder, verify, rename) and keeps the previous version for a **rollback**.
- **Updates are never automatic by default** (§5b): the user is told and chooses.
- **Uninstall** removes the plugin's folder and, if the user chooses, its data and settings; **revert** returns to the previous installed version.

### Trust labels

| Label | Meaning |
| --- | --- |
| **From the catalog** | in the project's curated, signed catalog; the entry pins this package's hash (reviewed by the project) |
| **Signed by a publisher you trust** | signed by a key the user trusted before (the store of trusted signers, `core/signers.ts`) |
| **Signed, unknown publisher** | valid signature, unknown key: the fingerprint is shown; trust is a conscious choice |
| **From a repository** | fetched from a Git repository at a pinned commit; the URL and commit are shown; says nothing about the code's quality |
| **Unsigned** | no signature: allowed, shown plainly. Every source can be unsigned except the catalog |

## 5b. Installing from a repository (planned; reserved by the design)

The owner wants to **install plugins from a repository in the future**, so the specification provides for it now, even if the implementation comes after the catalog (phase 7 in `docs/todo/extensions.md`).

- **The repository manifest ("marketplace"). Decided (2026-10-09): compatible with Claude Code's `marketplace.json`**, so that **one repository can serve both** Claude Code and Folder Browser. It **replaces** the earlier proposal of a separate `fb-marketplace.json`. The file lists several plugins: `name`, `owner`, and `plugins[]`, each with `name`, `description`, `version` and a **`source`**, in the shapes Claude Code already uses: a path **relative** to the repository (`"./plugins/pdf-pages"`) or **another repository** (a repo with a `ref` and a `commit`). The user adds a repository as a "source of plugins"; the application reads the file (and nothing else) to show the list. A repository with a single plugin may just have `plugin.json` at its root.
  - **Where the file is (the proposal)**: `.fb-plugin/marketplace.json`; the application **also accepts** `.claude-plugin/marketplace.json`, so a repository made for Claude Code works untouched. If both exist, `.fb-plugin/marketplace.json` wins. Entries are read with the fields Claude Code defines; a field the application does not know is ignored.
  - **Folder Browser's own fields are an optional addition, never a change of the shared ones.** They go in **one optional object `fb` in each entry** (and, for catalog-wide data, one `fb` object at the top of the file), so a tool that does not know it ignores a single key: `fb.signature` (the detached ed25519 signature of the package, or where to find it), `fb.exports` (the APIs it offers: name and semver version, §9b) and `fb.dependsOn` (the APIs it needs: name, semver range and source, §9b). A file with no `fb` object is a plain Claude Code marketplace and works here as one (every entry unsigned, no exports, no dependencies). **To check when it is built:** that Claude Code accepts the extra `fb` key; if it does not, these fields move into each plugin's own `plugin.json`, which already carries `exports` and `dependsOn`, and the marketplace file stays exactly Claude Code's.
- **Pinned versions**: an install is always at a **commit or tag**, never "the latest of the branch" without the user knowing. A tag or branch is **resolved to a full commit hash at install time and the hash is what is stored**; the warning shows both ("v1.2.0 = 9f3c…"). A tag that later points elsewhere is detected (§5b lock file) and reported.
- **The lock file** (`userData/plugins/plugins.lock.json`): for each installed plugin, the **source** (repository URL or path or catalog), the **ref asked for**, the **commit installed**, the manifest's `version`, the hash of the installed tree and the date. It makes an install **reproducible** (the same lock installs the same bytes on another computer) and is what updates and reverts compare against. A copy of the lock can be exported and imported (an import is an install, with the warning for each entry).
- **How the application fetches**: it must **not require Git to be installed**. The working proposal is to download the repository's **archive at the commit** (for GitHub, `https://api.github.com/repos/<owner>/<repo>/zipball/<sha>`, or the tarball), which the application already knows how to read as a ZIP, with **git-over-HTTPS** (a small implementation, or the library) as a fallback for hosts that offer no archive. Private repositories: see the open questions. The download is verified by the **commit hash** the host reports and by the tree's own hash that the lock records.
- **Updates**: **never automatic by default.** An opt-in "check for updates" (on demand, or at most daily if the user turns it on) compares each installed plugin's source with the lock and, when a newer tag or commit exists, **tells the user**. The update screen **shows what changed between the two commits** (the changed files and the manifest's difference: `version`, `uses`, `contributes`; a link to the compare page of the host), and the user confirms. An update that **grows the declared uses** needs the confirmation again with the difference highlighted.
- **Revert and uninstall**: the previous installed version is kept (one back) so **Revert** is one click, and the lock records it; **Uninstall** removes the folder, the lock entry, and (the user chooses) the plugin's data and settings.
- The origin is shown on every screen that names the plugin (the card, the warning, the update): the **repository URL, the commit or tag and the publisher**.

## 6. The online catalog (the sketch)

The catalog is **curated and signed by the project** (the project's name is in front of it): an entry means a maintainer read the plugin and checked that what it declares (`uses`) matches what its code does. It is one source among three (§5); manual install and repositories stay free. The catalog is a **static website**, no server code, no accounts, no database, no tracking: files in a public git repository (`folder-browser-plugins`) published as static pages (GitHub Pages or a release asset), so the only moving part is a pull request.

```
https://<host>/catalog/v1/index.json         the list
https://<host>/catalog/v1/index.json.sig     detached signature of the exact bytes of index.json
https://<host>/catalog/v1/revoked.json       the blocklist
https://<host>/catalog/v1/revoked.json.sig
packages are release assets of the plugin's own repository or of the catalog's; the URL is in the entry
```

```jsonc
// index.json
{
  "schema": 1,
  "generated": "2026-11-01T10:00:00Z",
  "sequence": 417,                       // grows with every publication: an older index is rejected (rollback attack)
  "plugins": [
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
  "plugins": [{ "id": "evil.thing", "versions": "*", "reason": "malicious: reads files and writes them elsewhere" }],
  "keys": [{ "key": "ed25519:ab12…", "reason": "key compromised" }] }
```

**Trust chain.** The application ships with the **catalog's public key** (and a second one, for rotation). It accepts an index only if the signature verifies, its `sequence` is not lower than the last one it saw, and its `generated` date is not stale beyond a limit. An entry pins the package's **SHA-256**; the package's own `SIGNATURE` must verify against the publisher key the entry names; the files inside must match the hashes in `plugin.json`. So a replaced release asset, a hijacked host, a man in the middle or a swapped file is **rejected**, whoever serves the bytes.

**What the application does, and only when the user turned the catalog on**
- A single HTTPS `GET` of `index.json` (and of `revoked.json`, and the two signatures) when the **Plugins ▸ Browse** page opens or **Check for updates** is pressed, never in the background and never at start. `If-None-Match` caching; a fixed `User-Agent: FolderBrowser/<version>`; no cookies, no identifier, no list of what is installed. (The host necessarily sees the IP address: the Settings text says so.)
- A download happens **on a click**, then every check above, then the install screen.
- An **update** is offered, never applied: the page says "1.3.0 is available" and shows the difference in the declared uses; the user clicks.
- **Revocation**: when the blocklist is fetched, an installed plugin or publisher key that appears in it is **disabled at once** with a notice. Without the catalog turned on the application cannot know, and the page says so.
- **Air gap and mirrors**: **Browse a catalog from a folder** (an `index.json` and its signature on disk, with the packages beside it) works with no network; a company can mirror the catalog, and the application still requires **the catalog key's signature** (a mirror is only a cache). A different catalog **key** is a developer-mode setting, never the default.

**Publishing (the repository's side).** An author opens a pull request that adds a manifest and a link to a release. CI checks the schema, the sizes, the hashes, that a level 0 package carries no code, that the declared `uses` are what the description says, the id's namespace (the publisher id must match the GitHub account or organisation that owns the package's repository, to stop **typosquatting** and impersonation), and runs the plugin-package **fuzz and bomb tests**. A **human review** is required for every plugin with code and for any growth of `uses`: the reviewer reads the source and checks it against the declaration. Merging publishes the next `sequence`, signed **offline** by a maintainer's key held on a hardware token (the catalog key is never on a CI server).

**Governance** (`docs/PLUGINS-POLICY.md`, to write): what may be published (no network, no telemetry, no obfuscated code, a licence), how to report a malicious plugin (a private security contact), the **takedown and revocation** process and its time target, key rotation and what happens when a publisher key leaks, and the API's **stability promise** (semver, a deprecation period).

## 7. Threat model (what the tests must cover)

| Threat | Defence |
| --- | --- |
| A package with `../` names, absolute paths, symlinks, a ZIP bomb, a million files | the package reader refuses them (`safeRelative`, limits on size, count and ratio) before anything is written |
| A tampered or replaced package | pinned SHA-256 in a signed entry, signature on the package, per-file hashes |
| A rolled back or frozen index (an old vulnerable version offered again) | `sequence` and a freshness limit; the installed version is never downgraded without a choice |
| A compromised publisher key | the signed blocklist disables it; keys are per publisher, so one leak is bounded |
| Typosquatting, impersonation, a look-alike name | the namespace rule, a visible publisher fingerprint, "From the catalog" shown only for catalog entries |
| An update that grows the declared uses | not applied until the user confirms again, with the difference shown; no automatic update by default |
| A setting used to attack: a huge default, a million-item list, a hostile string shown as HTML, a regular expression that hangs the page, a value that changes what the plugin reaches slipped in by an import or an update | declared and bounded in the schema, validated on every write and read, rendered as text, no patterns in version 1, folders held by the application, options that change what is reached need the user's confirmation |
| **Accepted, by the owner's decision (§0):** a plugin with code that reads or writes files, starts programs or uses the network on its own | **not prevented.** Defences are informative: the install warning (publisher, signed or not, origin, what it declares), the curated catalog, the activity log, the safe mode and the ability to disable or revoke. The README and the guide say the core's guarantees do not extend to plugins |
| A plugin that writes over an original through the API | the API's protections: the guard, an atomic write, the trash, a **Local History** copy first (so Local History must exist before such plugins) |
| A plugin installed by trickery (a dropped file, an imported settings file, a link, a `folder-browser://` link) | the install warning is **always** shown and needs the user's click; nothing installs from a link, a drop or an import without it; a settings import never installs or enables a plugin |
| A plugin process that hangs, loops, leaks or crashes | a separate process: the window survives; the host stops a hung one, shows a notice, a Restart and a Disable; started on activation and stopped when idle |
| A repository source: a tag moved after review, a branch that changes under the user, a replaced archive | the install is pinned to a **commit hash**; the lock file records source, commit and tree hash; an update is shown as a diff between commits and confirmed; a tag that moved is reported |
| A malicious or look-alike repository (`owner/repo` typo) | the warning shows the full repository URL, the commit and the publisher; nothing is trusted because of a name; the catalog's namespace rule applies only to the catalog |
| Credentials for a private repository leaking | the application does not store tokens in `settings.json`: it asks the `gh` or Git credential helper or uses the system's key store (`safeStorage`); a token is never sent anywhere but the repository's host |
| A dependency tree that hides a plugin (a harmless layer that pulls a harmful one), a cycle, a duplicated API name, a dependency whose source changes | the install warning lists the **whole tree** (origin, version, publisher, signed or not, declared uses of each); cycles and duplicate names are install errors; the lock records the resolved tree with commits; an update shows who depends on what changed |
| A call between plugins carrying a huge value, or a malformed one | the host mediates and validates every call as `unknown`; large data only as references; an inline size limit with a message |
| Exfiltration by a plugin | **not prevented** (accepted); the API itself sends nothing; the declared `network` is shown at install |
| A busy loop, a memory bomb | the process is separate, the host stops it, the user can kill it, a safe mode |
| UI spoofing (a panel that looks like the application's own dialog) | a plugin's panel is labelled with its name and a "from a plugin" mark; the application's own dialogs (the install warning among them) are never drawn by a plugin |
| Key hijacking (`Ctrl+S`, `Ctrl+W`, Delete) | a **reserved keys** list a plugin cannot bind |
| Injection through contributed strings (names, descriptions, commands) | rendered as **text**, never HTML; icons only as raster images |
| A command entry that starts a program | run by the application, **without a shell**, an argument list, `{file}` substituted as one argument, shown and confirmed at install and again on the first run |
| A malicious JSON (huge, deeply nested, prototype pollution) | a size and depth limit, `JSON.parse` then a strict schema that builds a **new** object |
| A catalog host that logs users | opt-in, a plain explanation, no identifier, a mirror and air-gap path |

## 8. What it does not do (version 1)

**Confining a plugin** (a sandbox, enforced permissions, per-root grants): dropped by the owner's decision (§0). Also not planned: dependencies between plugins, accounts, payments, ratings or comments, telemetry, **automatic updates by default**. Installing from a repository is **planned** (§5b), after the catalog.

## 9. First-party plugins: the application builds its own complex features on the same model

The most complex items of `TODO.md` (a 7z or tar reader, an audio decoder, subtitle rendering, image codecs, metadata readers, a SQLite viewer, a Git view, a duplicates finder, the playlists' formats) are **built as plugins**, not as code in the core, when they fit. Reasons: the **core stays small and fast** (a smaller installer, nothing loaded at start: the performance rule); **risky parsers run in a process of their own** (a crash or a hang in a 7z reader cannot take the window down; this is about stability, not confinement, §0); a **dependency with another licence** (7-Zip is LGPL, a decoder may be GPL) stays **out of the core's licence** and in a plugin of its own; a feature can be **installed, disabled or revoked** without a new release; and the API is **proved by real use** (a point is added to the API only when a built-in feature needs it).

**The rule of thumb.** *Core* when it is a security boundary (the roots, safe writes, the application's API itself), a safety net (Local History), the performance-critical interface (the tree, the tabs, the editors, the hex view) or the foundation others stand on (settings, commands, keys). *Plugin* when it is a **reader, writer, codec, viewer, tool or panel**, it can work through the application's API, it pulls a heavy or differently-licensed dependency, or it is not needed on the first run.

**Core and plugin, by the owner's decision (2026-10-09).** The **core keeps the basics**: browsing, viewing (PDF, images, media, hex), editing text, diff, ZIP, file operations, the trash. These are **plugins**: **PDF manipulation** (rotate, delete and reorder pages, merge, annotate, forms), **image editing and EXIF**, **tar and 7z**, **playlists**, and the **"file intelligence" packs**. **The first plugin that proves the API** is **"PDF: rotate, delete and reorder pages"** (or, as a fallback, rotate and crop an image): a real feature that writes over an original through the API, so it exercises the guard, the atomic write, the trash and Local History. **Local History must exist before, or together with, the first plugin that writes over originals.** (The reader/viewer for PDFs in the core stays: only the page manipulation is a plugin.)

**Built in, or from the catalog.** A first-party plugin is **signed by the project** and either **ships inside the installer** (enabled by default, marked *Built in*, can be turned off; for what nearly everyone needs) or is an **Official** entry of the catalog (installed on demand, for what is large or rare, such as a 7z engine or an audio decoder). The user can see and disable either kind in the same Plugins page, and the same revocation applies.

**Plugin-shaped before the plugin system exists.** The near-term items must not wait. Until the plugin points are real, such a feature is written **as if it were a plugin**: its own folder (`plugins/<id>/` with a `plugin.json` that already says its level and declared uses), its code reaching the application **only through an internal host interface shaped like the future API** (typed calls, no imports of the application's internals), its data in its own folder, its dependencies bundled with it, and its tests running against a **fake host**. Moving it into the box later is then a build step, not a rewrite.

See "Plugin-first" in `TODO.md` for which item goes where.

## 9b. Plugins on plugins (the onion)

**The owner's concept (2026-10-09):** "plugins on top of plugins, like an onion, where plugins can export an API of their own that other plugins can consume." A plugin can **export a contract** and other plugins **depend on it**, in layers. The core is the centre; each layer uses the ones inside it.

**The manifest.**
```jsonc
{
  "id": "acme.pdf-pages",
  "version": "1.2.0",
  "exports": [
    { "api": "pdf-pages", "version": "1.2.0", "types": "types/pdf-pages.d.ts" }   // name, semver, the contract as a .d.ts
  ],
  "dependsOn": [
    { "api": "pdf-pages", "range": "^1.0.0",
      "source": { "repo": "acme/pdf-pages", "ref": "v1.2.0", "commit": "9f3c…" } }   // the source may be a repository (§5b), the catalog or a file
  ]
}
```
`exports` lists the APIs this plugin offers (a name, a semver version, the `.d.ts` of the contract inside the package). `dependsOn` lists the APIs it needs (the name, a semver range and **where to get it**; the source is the same as an install source, so a missing dependency can be fetched from a repository, §5b, or the catalog). The `uses` declaration (§3) is separate: it says what the plugin itself touches.

**Layers without cycles.** The host builds the graph from the manifests. Plugins load **in the order of their dependencies** (an inner layer starts before the one that needs it; it starts on demand, when a layer outside it activates). **A cycle is an install error** (it names the cycle). Two installed plugins may not export the same `api` name (an error that names both).

**An exported API is a call mediated by the application.** Plugins run in **separate processes** (§4), so a call from one to another **goes through the host**: the consumer asks the host, the host finds the provider, forwards the call, returns the answer. Calls are **asynchronous and typed** by the contract; the host validates the shape of arguments and results as `unknown` (the same rule as every other call). **Large data pass as references, not as bytes**: a call carries a **file reference** (a path the API's guard knows, or a handle to a file or a stream the host holds), never a copy of the contents; a result that is big is likewise a reference to a (temporary) file or a stream. **Performance budget:** a 500-page PDF must never be copied between processes; a call that carries only small values adds under a millisecond locally beyond the process hop; the host limits the size of an inline value (a few hundred KB) and refuses more with a message that says to pass a reference. Cancellation and progress travel with the call.

**Clear failure.** A missing, disabled or incompatible dependency **turns off the plugin that depends on it**, with a message that says **what to install** (the API name, the range wanted, the source the manifest gave). Before removing, disabling or updating a plugin that others depend on, the application **warns and lists them**, and the user chooses. **Decided (2026-10-09), updating a plugin from the inside:** the outer plugins that depend on it **stay off until they are updated**, with a message that says **which ones** (and which version of the contract each needs). Safe mode (§4) turns all off, layers included.

**Installing a plugin that depends on others.** **Decided (2026-10-09): automatic after the warning of the whole tree.** The install warning (below) lists every plugin the install brings, with all origins, versions, publishers, signatures and declared uses; **one "Confirm" installs the whole tree**. The user does not install each layer by hand, and nothing in the tree installs without that one confirmation.

**The install warning covers the whole tree.** Installing a layer shows **every plugin it brings, transitively**: each one's origin (repository URL and commit, or catalog), version, publisher, signed or not, and declared uses, so the user confirms the whole tree at once. The **lock file** (§5b) records the **resolved tree** (every plugin, its source and the commit installed, who depends on whom), so the same install reproduces on another computer. An update of one layer shows who depends on it and whether the contract's version changed.

**Versions.** The exported contract is semver: **changing it in a way that breaks a consumer is a major-version change** (removing or renaming a method, changing a type, requiring a new argument); a new method is minor; a fix is patch. The host checks, before activating, that an installed provider's version satisfies the consumer's `range`; two consumers wanting incompatible majors of one API is a clear error. **Decided (2026-10-09): one provider version at a time.** When the ranges two consumers ask for have no version in common, the application says **which plugin has to be updated** (the one whose range is behind) and turns off the one that cannot be satisfied until then. Versions of a provider **side by side** are a possible evolution later, not planned now.

**Planned, not implemented now: intercepting calls.** Later, a plugin may **wrap** another's exported call, in the style of the `next(e)` of Claude Code's mods: the outer layer receives the call, may change it, calls `next` and may change the result. **The risk is real**: an outer layer can break the inner ones (a changed argument, a swallowed error, a delay on every call, an order between two wrappers). So it is **not built in the first version**, but the contract format is made **compatible**: every exported method is an async function with a plain-data signature (so it can later be wrapped without changing the types), the provider's name and version travel with each call, and the manifest reserves an `"intercepts"` key that the validator **rejects for now**. When it is built: an explicit declaration, a fixed and visible order, a limit on depth, an activity-log line for each wrapped call, and the wrapped plugin's author can see (and refuse) that it is wrapped.

**The authoring kit covers it** (§10): `fb-plugin new --depends-on <api>` makes a skeleton with the dependency's `.d.ts` and a consumer stub; `validate` checks the exported contract against the `.d.ts`, the semver bump against the previous published contract, the ranges and the graph (cycles, duplicates); the `test` harness **simulates the dependency** (a fake provider built from the `.d.ts`, or a recorded one), so a layer can be tested **without the inner layers installed**; the guide has a chapter and a worked example for exporting and consuming.

**The guide example.** A base plugin `pdf-pages` (rotate, delete and reorder pages, the first real plugin, phase 5) **exports** `pdf-pages` (operations on pages of a PDF, taking and returning file references). `pdf-merge` and `pdf-annotate` **depend on** `pdf-pages` and use its operations instead of reimplementing them. It also tests the onion: install `pdf-merge` from a repository and see the warning list `pdf-pages` too.

## 10. Authoring: zero entry cost

**The owner's requirement (2026-10-09):** "We will generate documentation that other agents can use to create the plugins; I want anyone with an idea in their head and the will to be able to create their plugin. This is **zero entry cost**."

So the **authoring kit is part of the API, not an afterthought**: it is born together with it, and **documentation comes first** (the contract is written before the code, and the code is checked against it). The earlier plan to write the guide "after phases 1 to 3" is **replaced**: the guide, the typed API and the first templates are written in the same phase as the host's API, and a phase does not close without them.

**The kit**

1. **An authoring guide for agents**: one **self-contained file**, in English, `PLUGIN-AUTHORING-FOR-AGENTS.md`, plus a Claude Code **skill** (`fb-plugin-author`) and an **`AGENTS.md`** the user can drop in any empty folder to start. It holds the mental model (what a plugin is, the two levels, what the application protects and what it does not), the manifest field by field, **each kind of contribution** (a command, a menu item, a file type, a viewer, "bytes in, bytes out" for a transformation), the API with **short examples**, the do's and don'ts, and the **common mistakes** with the fix for each. It is written for a reader that **cannot ask questions**: complete, exact, with examples that run.
2. **The typed API** (`.d.ts`): generated **from the application's own types**, published with the application and as a package, so that an editor and an agent can check a call before running anything. A broken or stale `.d.ts` fails the build.
3. **Templates and working examples** for the common cases: a command, a file type, a **PDF transformation**, an **image transformation**, a viewer; each one **builds, tests and installs** (checked by CI).
4. **A command-line tool, `fb-plugin`**: `new` (creates the skeleton from a sentence), `validate`, `test` (a harness that simulates the application), `pack` (makes the `.fbplugin`), `install --dev`; offline, with `--json` output and stable error codes.
5. **A development mode with automatic reload** inside the application (as Claude Code does with mods) and **clear errors that say what to fix** (the field, the rule, the example).
6. **The acceptance criterion of the kit. Decided (2026-10-09): the test ideas must expose every possibility the API offers, not a fixed number.** An agent that reads **only** the guide and the typed API can **write, validate, test and install a new plugin at the first attempt, without help**. The test: give a fresh agent a **one-sentence idea** and see whether a working plugin comes out. The ideas come from the **capability matrix** below. **The phase closes only when every row of the matrix passes** (a fresh agent for each row, the result recorded). It **replaces** the earlier proposal of "five ideas".

### The capability matrix

**What a row is.** Every **contribution** (what a plugin adds) and every **capability of the application's API** (what a plugin can ask the application to do) is **one row**. **Each row has at least one idea of one sentence** that a fresh agent, reading **only** the guide and the typed API, turns into a plugin that (1) `fb-plugin validate` accepts, (2) passes its own tests in `fb-plugin test`, (3) installs on the first try and (4) does what the sentence says, which a check written beforehand for that row verifies. A row passes only when all four hold with no help and no second attempt.

**The matrix grows with the API.** A new capability enters the API **in the same pull request** as its row and its idea; a pull request that adds an API method or a contribution key with no row **fails CI** (the matrix is kept as data in the repository once the kit exists, and a test compares it with the `.d.ts` and the JSON Schemas: every API method and every contribution key must be named by at least one row). Ideas are added freely; a row is never dropped while its capability exists. This is the initial matrix, written before any of it is built.

**Contributions**

| # | Row (what the plugin adds) | The one-sentence idea |
| --- | --- | --- |
| C1 | A command in the palette | "A command *Count selected files* that shows how many files are marked." |
| C2 | A menu item, by kind of file | "Add *Word count* to the right-click menu of text files, showing the words of the file." |
| C3 | A file type and its language | "Open files named `*.env.example` in the editor as shell text." |
| C4 | A viewer for a file type | "A viewer for `.gpx` files that lists the track points in a table." |
| C5 | A transformation "bytes in, bytes out" (a file) | "A *Base64 encode* transformation that writes the selected file's encoding next to it." |
| C6 | A transformation of the selected text | "A *Reverse the lines* tool on the text selected in the editor." |
| C7 | A setting: boolean, enum, number, string | "A *Greeter* plugin with a text option `name` and a yes/no option `loud`, shown in its command's message." |
| C8 | A setting: colour, list, key, folder or file, action | "A plugin with a colour, a list of words and a key-binding option, and an *action* button that resets its cache." |
| C9 | A sensitive setting (kept in the system's key store) | "A plugin that keeps an API token as a sensitive option and never writes it in `settings.json`." |
| C10 | A notification | "A command that shows a notice *Done* with a button that opens the file it made." |
| C11 | Progress with cancellation | "A command that walks a big folder, shows a progress bar and stops when the user cancels." |
| C12 | A status bar item | "A status bar item that shows the number of lines of the file in the active tab." |
| C13 | A side panel (labelled "from a plugin") | "A panel that lists the headings of the Markdown file in the active tab." |
| C14 | A theme | "A dark theme with a warm accent colour, with a preview and a reset." |
| C15 | A key scheme | "A key scheme that moves *Go to File* to `Ctrl+P` and is refused on a reserved key." |
| C16 | A language pack (locale) | "A Spanish language pack for the plugin's own messages." |
| C17 | A snippet | "A snippet *todo* that inserts a dated TODO line in any text file." |
| C18 | An Open With entry (starts a program, no shell) | "An *Open in GIMP* entry for PNG files that passes the file as one argument." |
| C19 | A helper program shipped per system | "A plugin that ships a small converter program per system and runs it on the selected file." |
| C20 | A declared use (`network`, `process`, `files`) shown at install | "A plugin that checks a URL and declares the `network` use so the install warning lists it." |
| C21 | An activation event (it loads only when needed) | "A plugin that loads only when a `.csv` file is opened and not at start." |
| C22 | Export an API for other plugins | "A plugin *text-stats* that exports `countWords` and `countLines` with a `.d.ts` contract." |
| C23 | Consume another plugin's API | "A plugin that calls `text-stats` and shows the count in a notification, without reimplementing it." |
| C24 | A dependency from a repository | "A plugin that depends on `text-stats` taken from a GitHub repository at a pinned commit." |
| C25 | A large value passed by reference | "A plugin that sends a 200 MB file to a provider as a file reference, never as bytes." |

**Capabilities of the application's API**

| # | Row (what the plugin asks the application) | The one-sentence idea |
| --- | --- | --- |
| A1 | Read a file by range | "A command that shows the first 4 KB of the selected file in hexadecimal without reading the rest." |
| A2 | Read a whole file | "A command that reads a small JSON file and reports whether it is valid." |
| A3 | List a folder and read its metadata | "A command that sums the sizes of the files in the open folder and shows it." |
| A4 | Write atomically with a Local History copy | "A command that rewrites the selected text file in upper case, keeping the original in Local History." |
| A5 | Create a new file next to an original | "A command that makes `name.bak` next to the selected file without touching the original." |
| A6 | Delete to the trash | "A command that moves the selected `.tmp` files to the trash." |
| A7 | The selection (the marked rows) | "A command that acts on every marked row and says what it did on each." |
| A8 | Run and register commands | "A command that runs another command of the application, then adds one of its own to the palette." |
| A9 | Bind a key (a reserved key is refused) | "A plugin that binds `Ctrl+Alt+K` to its command and handles the refusal of `Ctrl+S`." |
| A10 | Read its settings and react to a change | "A plugin whose command reads its option and updates its status bar item when the option changes." |
| A11 | Storage of its own | "A plugin that remembers the last folder it used and offers it next time." |
| A12 | A path that leaves the root is refused | "A command that tries to read `../outside` and reports the application's refusal in plain words." |
| A13 | A write that fails leaves the original untouched | "A command that fails halfway and proves the original file is unchanged." |
| A14 | Open a file or a folder in the application | "A command that opens the selected file in a tab and the folder it is in beside it." |
| A15 | Entries of a ZIP through the same calls | "A command that reads the first entry of a selected ZIP file without unpacking it." |
| A16 | Survive a crash and a restart | "A plugin whose process crashes on purpose, comes back after the *Restart* button and keeps its state." |
| A17 | Write to the activity log through the API | "A command that writes a file through the API, then shows it in its Activity page." |

The ideas are deliberately small. A row stays in the matrix even when a later, larger plugin (such as `pdf-pages`) also uses its capability.

`docs/PLUGINS.md` (the human guide, in English and Brazilian Portuguese) and the agents' file say the same things; one is generated from the other's sources so they cannot drift. Details of the longer outline follow; they are the table of contents of both.

- **Start here**: what a plugin is, the three levels and how to choose, what is not possible and why, the trust labels, the five-minute path (`fb-plugin init`, edit, `validate`, `pack`, install from file).
- **The manifest, field by field**: every key, its type and limits, a worked example per contribution point, and the **JSON Schema** files (`docs/schema/*.json`) that the validator and the catalog use, so a tool can read them directly.
- **The host API reference**: every method, its parameters and results, errors with **stable codes**, what the API protects, limits, and a runnable example; generated from the same TypeScript types the application uses, so it cannot drift.
- **Recipes**: a theme, a key scheme, a language pack, an Open With command, a command that transforms the selected text, a viewer for a file type, a converter, a metadata reader, a panel, a tool that writes over originals through the API (and what Local History does for it), and one that runs a helper program.
- **Security rules the plugin must follow, and what the host enforces**: no network, no HTML from data, strings are text, the reserved keys, the quotas, what is logged; the threat model's table written as a checklist an author can run through.
- **Testing**: a **test host** (`fb-plugin test`: a fake host API with fixtures, a virtual file system and a clock) that runs a plugin's tests with no application, **performance budgets** for the plugin (activation time, memory, call latency) and how to measure them.
- **Publishing**: the pull request flow to the catalog, signing, versions and the `engines` range, how a review works and how long it takes, how to take a version down, key rotation, the policy.
- **For agents**: a short **`AGENTS.md`** at the template's root and a `llms.txt`-style index of the guide (what to read first, the commands to run, the definition of done), **machine-readable output** from every `fb-plugin` command (`--json`, stable error codes with a one-line fix each), a **conformance checklist** that the catalog's CI runs and an agent can run first, and a rule written down: *never* declare a use the plugin does not have, and *never* use one it did not declare, *never* fetch or evaluate code at run time, and **stop and ask the person** before publishing.
- **Templates**: one repository template per kind (theme, keymap, language, command, viewer, converter, tool with a helper program), each with its tests, a `README`, the `AGENTS.md` and a release workflow that builds, packs and signs reproducibly.


## 11. Decisions and open questions

### Decided by the owner (2026-10-09)

1. **The package and the signature.** `.fbplugin` is a ZIP with `plugin.json`, the code and an **optional ed25519 signature**. A plugin **without a signature can be installed** (the install warning shows it as unsigned). The same layout also works **as a folder in a repository** (§5). The code of `core/validate/signature.ts` and the store `core/signers.ts` are reused. (The catalog is signed and pins each package's hash, §6; a publisher's signature on its package stays optional outside the catalog.)
2. **Where the code runs.** **One process per plugin**: an Electron `utilityProcess`, talking to the main process over a `MessagePort` (§4).
3. **The repository manifest.** **Compatible with Claude Code's `marketplace.json`**, so one repository can serve both. It replaces the proposal of `fb-marketplace.json`. The file is `.fb-plugin/marketplace.json`, and `.claude-plugin/marketplace.json` is accepted too; Folder Browser's own fields (signature, `exports`, `dependsOn`) are an **optional `fb` object** in each entry, never a change of the shared fields (§5b).
4. **The word in the interface.** **"Plugins"** (the Plugins menu, "Install Plugin…", the guide "Create a plugin"). The existing file names `docs/EXTENSIONS-DESIGN.md` and `docs/todo/extensions.md` stay as they are, so no link breaks.
5. **Versions of an exported API.** **One provider version at a time.** If the ranges two consumers ask for do not meet, the application says which plugin has to be updated. Versions side by side are a possible later evolution (§9b).
6. **Updating a plugin from the inside.** The outer plugins that depend on it **stay off until they are updated**, with a message that says which ones (§9b).
7. **Installing a plugin that depends on others.** **Automatic after the warning of the whole tree** (every origin, version, publisher, signature and declared use); one "Confirm" installs everything (§9b).
8. **The acceptance test of the authoring kit (phase 3b).** The test ideas **expose every possibility the API offers**, not a fixed number: a **capability matrix** with one row per contribution and per API capability, at least one one-sentence idea per row, and a phase that closes only when **every row** passes; the matrix **grows with the API** (§10).

### Still open (the owner decides; none is blocking the first phases)

1. **Where the catalog is hosted and who holds the signing key** (static pages with a mirror, signed offline, §6; the second key for rotation; the takedown time target; whether first-party plugins live in the catalog's repository or in this one). **To decide before phase 6.**
2. **Intercepting calls** between plugins (§9b): **postponed**. Is it worth building at all? The contract format stays wrappable and `intercepts` is rejected for now.
3. **The limit of a "large" inline value and the type of a reference** (a temporary file, a handle, a stream) for calls between plugins (§9b).
4. **Authentication to a private repository, and fetching without Git installed** (§5b): reuse the `gh` or Git credential helper, the system's key store or a pasted token? The host's archive at a commit with git-over-HTTPS as a fallback, and for hosts other than GitHub? How the commit is pinned and verified (the commit hash plus a tree hash; what to do when a force-push removes the commit)?

Not asked in this round, so **still open** too: how a helper program per system is packaged and hash-pinned (from decision 2); the minimum API a PDF plugin needs (read by range, atomic write with a Local History copy, the selection, a command and menu entry, progress and cancellation, a notification, settings) and which point is built first; safe mode and the activity log (what is recorded when a plugin uses Node directly, and whether safe mode skips level 0 data); and, for the authoring kit, where the skill and `AGENTS.md` ship, whether the `.d.ts` and `fb-plugin` are npm packages, how `new` makes a skeleton from a sentence, and whether the development mode reloads from an unpacked folder only.
