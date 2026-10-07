# Releasing

A release is up to four files (`.exe`, `.dmg`, `.deb`, `.rpm`). The checks and the `.exe`, `.deb` and `.rpm` are made **on the maintainer's computer** by `scripts/release-local.mjs`, and published to GitHub as a
release with their checksums and the notes from `CHANGELOG.md`. **Nothing runs on GitHub by itself**: to spare the free quota there is no CI on pull requests or on `main`, and the only workflow is
`.github/workflows/release.yml`, started by hand, which builds the macOS `.dmg` (it needs a Mac), runs the unit tests and the packaging smoke test there, and adds the `.dmg` and its checksum to the release already
published. (A Mac of your own can build it too: `--targets=mac`, on the Mac.)

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
2. **Open a pull request** and merge it. Nothing runs on GitHub for it; the checks are the next step, here.
3. **Build and check, from the merged `main`**:

   ```sh
   git checkout main && git pull --ff-only
   node scripts/release-local.mjs --e2e
   ```

   This runs `lint`, `typecheck`, `test`, `notices:check` (and, with `--e2e`, the end-to-end tests, which open windows: leave the computer alone while they run), builds the files into
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
6. **Add the macOS `.dmg`** (GitHub, by hand): in the repository's **Actions** tab choose **Release (macOS)** › **Run workflow**, give the tag (`v0.1.0`) and, if you want the end-to-end tests on the Mac too, tick
   **e2e** (about ten minutes of the quota, ten times what a Linux minute costs; the unit tests and the packaging smoke test always run). Or from the terminal: `gh workflow run release.yml -f tag=v0.1.0` (add `-f e2e=true`).
   It builds the `.dmg` from the tag, and uploads it and an updated `SHA256SUMS.txt` to the release. Run it again to replace the `.dmg`; it fails, saying so, if the release does not exist yet.
7. **Check the release page**: the files are there, the notes read well, and a file's checksum matches (`sha256sum -c SHA256SUMS.txt`).

If something fails half way nothing is published (the release is created last). To change the files or the notes of a release that exists, run it again with `--replace`. To withdraw a release:
`gh release delete v0.1.0 --cleanup-tag`.

## The files

| System | File | Target |
| --- | --- | --- |
| Windows | `folder-browser-<version>-win-x64.exe` | NSIS installer |
| macOS | `folder-browser-<version>-mac-universal.dmg` | one universal disk image (Apple Silicon and Intel); built on GitHub by the `Release (macOS)` workflow, started by hand |
| Debian, Ubuntu | `folder-browser-<version>-linux-amd64.deb` | `deb` |
| Fedora, Red Hat | `folder-browser-<version>-linux-x86_64.rpm` | `rpm` |

There is no AppImage. The installers register `.wsnp` (and on Linux a file type told from a plain ZIP by its first entry). They carry `LICENSE` and `THIRD-PARTY-NOTICES.md`, which the About window shows.

## Signing

**The files are not signed yet**, so Windows SmartScreen and macOS Gatekeeper warn on the first launch (the README says how to get past it). To sign, the secrets below are set in the repository
(**Settings › Secrets and variables › Actions**) for the macOS workflow, or as environment variables of the shell that runs `release-local.mjs` (it passes them to electron-builder, which ignores them when they are empty).

| Secret | For |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | the code-signing certificate (a `.p12` or `.pfx`, as a file link or base64), and its password: Windows code signing and the macOS Developer ID certificate |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarisation |

The macOS build has `"identity": null` in `package.json` (it does not sign); once the certificate and notarisation secrets exist, remove that line and add `"notarize": true` under `mac`. The `.deb` and `.rpm` can be signed with a
GPG key later (and a signed apt/dnf repository is a further option). Linux packages cannot be updated from inside the application: a new release is installed with the package manager.

## Updates

There is no automatic update yet. The release notes say which Electron a version has: a new Electron (which carries Chromium) is taken every few months, and at once for a security fix (`SECURITY.md`). Dependabot opens
the pull requests (Electron on its own).

## Lessons of the first releases

- **Rehearse the Mac before cutting a version.** The `.dmg` is the only file that is not made on the maintainer's computer, and the unit tests, the packaging and its smoke test run there for the first time. A release that fails there is published without a `.dmg` and cannot be mended without a new version (a tag is never moved). So run the rehearsal first: `git push` the branch and `gh workflow run release.yml --ref <branch> -f tag=<branch> -f dry_run=true` builds and checks it like a release and adds nothing to any release. Only then `prepare`, publish, and run the workflow for the tag.
- **Everything of a release comes from one commit**: the files of Linux and Windows are built again for each version (`release-local.mjs --e2e --publish`), so that a release never mixes the code of two versions.
- A step that fails stops the release and **nothing is published** (the release is created last); read the first error, not the last line.
- Do not `pkill -f` or `pgrep -f` a pattern that is in the same command line: it kills the shell that runs it.

## Checklist

- [ ] `CHANGELOG.md` read: every user-facing change is there, in words a user understands.
- [ ] If the release changes what the format says: the change is in [`wsnp-format`](https://github.com/asantos43/wsnp-format) first.
- [ ] `THIRD-PARTY-NOTICES.md` is up to date (`npm run notices:check`).
- [ ] `node scripts/release-local.mjs --e2e` passed (Linux and Windows files, packaging smoke test) and the `Release (macOS)` workflow passed for the tag.
- [ ] The release page has the four files and `SHA256SUMS.txt` (with the `.dmg` line).
