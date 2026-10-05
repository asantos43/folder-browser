# Releasing

A release is up to four files (`.exe`, `.dmg`, `.deb`, `.rpm`), checked and built **on the maintainer's computer** by `scripts/release-local.mjs`, and published to GitHub as a release with their checksums and the
notes from `CHANGELOG.md`. GitHub only hosts the files: no check or build runs on GitHub Actions (the `CI` and `Release` workflows are kept in `.github/workflows/` but disabled; they can be enabled again
when the repository is public, where Actions is free). **Without a Mac there is no `.dmg`**: a release has the `.exe`, `.deb` and `.rpm` until the `.dmg` can be built on one (`--targets=mac`, on a Mac).

## What the computer needs

**Docker**, and nothing else installed for the build: the files are made in a container (`docker/release/Dockerfile`: Node 24, wine for the `.exe`, `rpm` for the `.rpm`), from a copy of the working tree,
so the host's `node_modules` are not touched. The image is made the first time (a few minutes, a few hundred MB) and kept; `--rebuild-image` makes it again for a new Node or wine. The dependencies, Electron and
electron-builder's tools are cached in two Docker volumes (`wsnp-release-npm`, `wsnp-release-cache`), so the next build downloads nothing. To free the space: `docker volume rm wsnp-release-npm wsnp-release-cache`
and `docker rmi folder-browser-release:node24`.

On the host itself: Node (the checks run there, with the project's `node_modules`), `dpkg-deb` and `rpm` (the smoke test opens the `.deb` and `.rpm`), a screen (it starts the application; `xvfb-run` serves a
computer without one), and `gh`, logged in (`gh auth login`), to publish. The `.exe` is unsigned and **cannot be started on Linux**: install it on a Windows machine (a virtual machine is enough) before publishing.

`node scripts/release-local.mjs` checks that Docker answers, before it does anything slow.

## Making a release

1. **Prepare it on a branch from an up-to-date `main`** (never commit to `main`):

   ```sh
   git checkout main && git pull --ff-only && git checkout -b release-0.1.0
   node scripts/release.mjs prepare 0.1.0
   ```

   This moves what is under **Unreleased** in `CHANGELOG.md` into a section for `0.1.0` with today's date (and leaves an empty **Unreleased**), and sets `0.1.0` in `package.json` and
   `package-lock.json`. It refuses a version that exists, and an empty **Unreleased**. Read the notes: they become the release's text. A pre-release is `0.1.0-beta.1`.
2. **Open a pull request** and merge it. Nothing runs on GitHub; the checks are the next step, here.
3. **Build and check, from the merged `main`**:

   ```sh
   git checkout main && git pull --ff-only
   node scripts/release-local.mjs --e2e
   ```

   This runs `lint`, `typecheck`, `test`, `notices:check` and `format-sync` (and, with `--e2e`, the end-to-end tests, which open windows: leave the computer alone while they run), builds the files into
   `release/`, opens the `.deb` and `.rpm` and starts the application in them (`scripts/package-smoke.mjs`), and writes `release/SHA256SUMS.txt` and `release/RELEASE-NOTES.md`. `--targets=linux` or
   `--targets=win` builds one system; `--skip-checks` is only to try the build.
4. **Try the files**: install the `.rpm` (`sudo dnf reinstall ./release/folder-browser-0.1.0-linux-x86_64.rpm`) and, on a Windows machine, the `.exe`; open a `.wsnp` from a double click.
5. **Publish**:

   ```sh
   node scripts/release-local.mjs --publish
   ```

   With the same checks and build, then (it refuses unless the branch is `main`, as `origin/main`, with nothing uncommitted) it asks, and creates the GitHub Release `v0.1.0` **and its tag at that commit**
   with the files, `SHA256SUMS.txt` and the notes (a version with `-` in it is marked a pre-release). To skip the question: `--yes`. To build once and publish what was built, run it without
   `--publish` first, then with it (it builds again: the files are the ones of that run).
6. **Check the release page**: the files are there, the notes read well, and a file's checksum matches (`sha256sum -c SHA256SUMS.txt`).

If something fails half way nothing is published (the release is created last). To change the files or the notes of a release that exists, run it again with `--replace`. To withdraw a release:
`gh release delete v0.1.0 --cleanup-tag`.

## The files

| System | File | Target |
| --- | --- | --- |
| Windows | `folder-browser-<version>-win-x64.exe` | NSIS installer |
| macOS | `folder-browser-<version>-mac-universal.dmg` | one universal disk image (Apple Silicon and Intel); **not built for now** (needs a Mac) |
| Debian, Ubuntu | `folder-browser-<version>-linux-amd64.deb` | `deb` |
| Fedora, Red Hat | `folder-browser-<version>-linux-x86_64.rpm` | `rpm` |

There is no AppImage. The installers register `.wsnp` (and on Linux a file type told from a plain ZIP by its first entry). They carry `LICENSE` and `THIRD-PARTY-NOTICES.md`, which the About window shows.

## Signing

**The files are not signed yet**, so Windows SmartScreen and macOS Gatekeeper warn on the first launch (the README says how to get past it). To sign, the secrets below are set in the repository
(**Settings › Secrets and variables › Actions**) for the workflows, or as environment variables of the shell that runs `release-local.mjs` (it passes them to electron-builder, which ignores them when they are empty).

| Secret | For |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | the code-signing certificate (a `.p12` or `.pfx`, as a file link or base64), and its password: Windows code signing and the macOS Developer ID certificate |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarisation |

The macOS build has `"identity": null` in `package.json` (it does not sign); once the certificate and notarisation secrets exist, remove that line and add `"notarize": true` under `mac`. The `.deb` and `.rpm` can be signed with a
GPG key later (and a signed apt/dnf repository is a further option). Linux packages cannot be updated from inside the application: a new release is installed with the package manager.

## Updates

There is no automatic update yet. The release notes say which Electron a version has: a new Electron (which carries Chromium) is taken every few months, and at once for a security fix (`SECURITY.md`). Dependabot opens
the pull requests (Electron on its own).

## Checklist

- [ ] `CHANGELOG.md` read: every user-facing change is there, in words a user understands.
- [ ] `docs/FORMAT.md` (and `docs/MANIFEST-SIGNING.md`) are the same in PageKeep (`npm run format-sync`).
- [ ] `THIRD-PARTY-NOTICES.md` is up to date (`npm run notices:check`).
- [ ] CI passes on the three systems, the packaging smoke test included.
- [ ] The release page has the four files and `SHA256SUMS.txt`.
