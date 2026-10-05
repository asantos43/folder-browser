#!/usr/bin/env node
// Release helpers (docs/RELEASING.md):
//   node scripts/release.mjs prepare <version>   moves the lines under "Unreleased" in CHANGELOG.md into a section for <version> (dated today)
//                                                and sets <version> in package.json and package-lock.json
//   node scripts/release.mjs notes <version>     prints the section of CHANGELOG.md for <version>: the release notes
import fs from 'node:fs'
import path from 'node:path'

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** The text of a version's section (without its heading), or undefined when CHANGELOG.md has none. */
export function notesFor(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
  if (start < 0) return undefined
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## ['))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
}

/** CHANGELOG.md with what was under "Unreleased" moved into a section for `version`, and an empty "Unreleased" left above it. */
export function prepareChangelog(changelog, version, date) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a version (1.2.3, or 1.2.3-beta.1)`)
  if (notesFor(changelog, version) !== undefined) throw new Error(`CHANGELOG.md already has a section for ${version}`)
  const text = changelog.replace(/\r\n/g, '\n')
  const at = text.search(/^## \[Unreleased\]\s*$/m)
  if (at < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" section')
  const after = text.slice(at).replace(/^## \[Unreleased\]\s*$/m, '')
  const next = after.search(/^## \[/m)
  const body = (next < 0 ? after : after.slice(0, next)).trim()
  if (!body) throw new Error('nothing under "Unreleased": there is nothing to release')
  const rest = next < 0 ? '' : after.slice(next)
  return `${text.slice(0, at)}## [Unreleased]\n\n## [${version}] - ${date}\n\n${body}\n\n${rest}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** The same version in a package.json-shaped JSON text, keeping its formatting. */
export function setVersion(json, version) {
  return json.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)
}

/** The end of each release file's name, by the system it is built for (the `artifactName` of package.json, docs/RELEASING.md). */
export const TARGET_FILES = { linux: ['linux-amd64.deb', 'linux-x86_64.rpm'], win: ['win-x64.exe'], mac: ['mac-universal.dmg'] }

/** The names of the files a release of `version` has for these systems. */
export function expectedFiles(version, targets) {
  return targets.flatMap((target) => {
    if (!TARGET_FILES[target]) throw new Error(`"${target}" is not a system to build for (${Object.keys(TARGET_FILES).join(', ')})`)
    return TARGET_FILES[target].map((end) => `folder-browser-${version}-${end}`)
  })
}

/** The text of SHA256SUMS.txt (what `sha256sum` writes, `sha256sum -c` reads): one "hash  name" line per file, by name. */
export function checksumText(entries) {
  return `${[...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([name, hash]) => `${hash}  ${name}`).join('\n')}\n`
}

/** The text of a GitHub release: the notes of the version, and the checksums of the files, with the word that they are not signed. */
export function releaseNotes(notes, sums, targets) {
  const warns = targets.includes('mac') ? 'Windows and macOS warn' : 'Windows warns'
  return `${notes.trim()}\n\n## Files\n\nThe files are not signed yet: ${warns} on the first launch (see the README). Check a download against these SHA-256 sums:\n\n\`\`\`text\n${sums.trim()}\n\`\`\`\n`
}

function main() {
  const root = path.resolve(import.meta.dirname, '..')
  const [command, version] = process.argv.slice(2)
  const changelogFile = path.join(root, 'CHANGELOG.md')
  try {
    if (command === 'notes') {
      const notes = notesFor(fs.readFileSync(changelogFile, 'utf8'), version)
      if (!notes) throw new Error(`CHANGELOG.md has no section for ${version}`)
      process.stdout.write(`${notes}\n`)
    } else if (command === 'prepare') {
      const date = new Date().toISOString().slice(0, 10)
      fs.writeFileSync(changelogFile, prepareChangelog(fs.readFileSync(changelogFile, 'utf8'), version, date))
      for (const file of ['package.json', 'package-lock.json']) {
        const p = path.join(root, file)
        const text = fs.readFileSync(p, 'utf8')
        // package-lock.json has the version twice at the top (the package and its root entry): the first is enough for npm to agree.
        fs.writeFileSync(p, file === 'package-lock.json' ? text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`).replace(/("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*")[^"]+(")/s, `$1${version}$2`) : setVersion(text, version))
      }
      console.log(`prepared ${version}: CHANGELOG.md, package.json and package-lock.json. Commit them on a branch and open a pull request.`)
    } else {
      console.error('usage: node scripts/release.mjs prepare <version> | notes <version>')
      process.exit(2)
    }
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
