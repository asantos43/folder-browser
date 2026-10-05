#!/usr/bin/env node
// Builds the release files on this computer and, when asked, publishes them as a GitHub release (docs/RELEASING.md). GitHub only hosts the files:
// nothing is built or tested by GitHub Actions. The files are built in a container (docker/release/Dockerfile: Node, wine, rpm), so the computer needs
// Docker, and nothing else installed for it.
//
//   node scripts/release-local.mjs [--targets=linux,win] [--skip-checks] [--e2e] [--publish] [--yes] [--replace]
//
//   (nothing)       the checks (lint, types, tests, notices, format copy), then the files in release/, a smoke test of those it can run, SHA256SUMS.txt
//   --targets=      the systems to build for: linux (.deb, .rpm) and win (.exe); mac needs a Mac, so it is not the default
//   --skip-checks   build without the checks (to try the build itself)
//   --rebuild-image make the image of the container again (a new Node, a new wine), instead of using the one that is there
//   --e2e           also run the end-to-end tests (they open windows: keep the computer free while they run)
//   --publish       then create the GitHub release v<version> with the files and the notes of CHANGELOG.md (main, clean, and as origin/main is required)
//   --yes           do not ask before publishing
//   --replace       replace the files and the notes of a release that exists
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { checksumText, expectedFiles, notesFor, releaseNotes } from './release.mjs'

const root = path.resolve(import.meta.dirname, '..')
const releaseDir = path.join(root, 'release')
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const targets = (option('targets') ?? 'linux,win').split(',').map((t) => t.trim()).filter(Boolean)

const say = (text) => console.log(`\n\u001b[1m${text}\u001b[0m`)
const fail = (text) => {
  console.error(`\n\u001b[31m${text}\u001b[0m`)
  process.exit(1)
}
const has = (tool) => spawnSync('which', [tool], { stdio: 'ignore' }).status === 0
const capture = (cmd, ...a) => execFileSync(cmd, a, { cwd: root, encoding: 'utf8' }).trim()
function run(cmd, a, env = {}) {
  console.log(`$ ${cmd} ${a.join(' ')}`)
  const result = spawnSync(cmd, a, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.status !== 0) fail(`${cmd} ${a.join(' ')} failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}`)
}

const IMAGE = 'folder-browser-release:node24'
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const tag = `v${version}`

// ---- what this computer needs, said before anything takes long
function preflight() {
  say(`Release ${version} for ${targets.join(' and ')}`)
  const problems = []
  let names
  try {
    names = expectedFiles(version, targets)
  } catch (err) {
    fail(err.message)
  }
  if (targets.includes('mac')) problems.push('a macOS file can only be built on a Mac (and this is not one)')
  if (!has('docker')) problems.push('docker is missing: the files are built in a container')
  else if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) problems.push('docker does not answer: is its service running, and may you use it? (sudo systemctl start docker)')
  if (flag('publish')) {
    if (!has('gh')) problems.push('gh is missing (to publish): sudo dnf install gh')
    else if (spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status !== 0) problems.push('gh is not logged in: gh auth login')
  }
  if (problems.length) fail(`This computer is not ready:\n  - ${problems.join('\n  - ')}`)

  // The same version everywhere, and notes for it.
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  if (lock.version !== version || lock.packages?.['']?.version !== version) fail(`package-lock.json says ${lock.version}, package.json says ${version}: run node scripts/release.mjs prepare ${version} on a branch`)
  const notes = notesFor(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version)
  if (flag('publish') && !notes) fail(`CHANGELOG.md has no section for ${version}: run node scripts/release.mjs prepare ${version} on a branch, and merge it`)
  if (!notes) console.log(`(CHANGELOG.md has no section for ${version}: fine to build, not to publish)`)

  const dirty = capture('git', 'status', '--porcelain')
  if (dirty) {
    if (flag('publish')) fail('The working tree has changes: a release is made from what is committed.\n' + dirty)
    console.log('(The working tree has changes: these files are built from them, so they are only to try)')
  }
  return { names, notes }
}

function checks() {
  if (flag('skip-checks')) return console.log('\n(checks skipped)')
  say('Checks')
  for (const script of ['lint', 'typecheck', 'test', 'notices:check', 'format-sync']) run('npm', ['run', script])
  if (flag('e2e')) run('npm', ['run', 'test:e2e'])
}

/** The image of the container, made from docker/release/Dockerfile when it is not there (or with --rebuild-image). */
function ensureImage() {
  const there = spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status === 0
  if (there && !flag('rebuild-image')) return
  say('The image of the container')
  run('docker', ['build', '-t', IMAGE, path.join(root, 'docker/release')])
}

/**
 * What runs in the container: the project is copied in (without what the host built: its node_modules are for the host, and `npm ci` would empty them), the
 * dependencies are installed from package-lock.json, and each system is built; only the installers come out (and the unpacked Linux application, which the smoke test starts), owned by the user that runs this.
 */
const inside = (list, uid, gid) => `set -euo pipefail
tar -C /src --exclude=./node_modules --exclude=./release --exclude=./dist --exclude=./dist-electron --exclude=./.git --exclude=./test-results -cf - . | tar -C /work -xf -
cd /work
npm ci --no-audit --no-fund
${list.map((t) => `npm run package:${t}`).join('\n')}
for f in release/*.deb release/*.rpm release/*.exe release/*.dmg; do
  if [ -e "$f" ]; then cp "$f" /out/; fi
done
${list.includes('linux') ? 'cp -r release/linux-unpacked /out/' : ''}
chown -R ${uid}:${gid} /out`

function build() {
  say('Building, in a container')
  if (targets.includes('mac')) fail('A macOS file can only be built on a Mac.')
  fs.rmSync(releaseDir, { recursive: true, force: true })
  fs.mkdirSync(releaseDir)
  ensureImage()
  const { uid, gid } = os.userInfo()
  // The caches (the dependencies, Electron, electron-builder's own tools) are volumes, so the next build does not download them again; wine's prefix lives in the container and is made in a moment.
  run('docker', ['run', '--rm', '-v', `${root}:/src:ro`, '-v', `${releaseDir}:/out`, '-v', 'wsnp-release-npm:/root/.npm', '-v', 'wsnp-release-cache:/root/.cache', IMAGE, 'bash', '-c', inside(targets, uid, gid)])
}

function verify(names) {
  say('The files')
  const found = fs.readdirSync(releaseDir).filter((f) => /\.(deb|rpm|exe|dmg)$/.test(f)).sort()
  const missing = names.filter((n) => !found.includes(n))
  const extra = found.filter((n) => !names.includes(n))
  if (missing.length || extra.length) fail(`The files are not the ones expected.\n  missing: ${missing.join(', ') || '-'}\n  unexpected: ${extra.join(', ') || '-'}`)
  for (const name of names) {
    const file = path.join(releaseDir, name)
    const size = fs.statSync(file).size
    if (size < 20 * 2 ** 20) fail(`${name} is only ${size} bytes: the build is not complete`)
    if (name.endsWith('.exe') && fs.readFileSync(file).subarray(0, 2).toString('latin1') !== 'MZ') fail(`${name} is not a Windows program`)
    console.log(`  ${name}  ${(size / 2 ** 20).toFixed(1)} MB`)
  }
  if (targets.includes('linux')) {
    say('Packaging smoke test (Linux files)')
    // Without a display of its own (a computer without a screen), a virtual one.
    const withDisplay = process.env.DISPLAY || process.env.WAYLAND_DISPLAY
    if (withDisplay || !has('xvfb-run')) run('node', ['scripts/package-smoke.mjs', '--no-sandbox'])
    else run('xvfb-run', ['-a', 'node', 'scripts/package-smoke.mjs', '--no-sandbox'])
  }
  if (targets.includes('win')) console.log('\nThe .exe was built, but not started: that needs Windows. Install it in a Windows machine before publishing a release.')
}

async function sha256(file) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function checksumsAndNotes(names, notes) {
  const entries = []
  for (const name of names) entries.push([name, await sha256(path.join(releaseDir, name))])
  const sums = checksumText(entries)
  fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), sums)
  const text = releaseNotes(notes ?? `Files of ${version}, built on a computer to try.`, sums, targets)
  fs.writeFileSync(path.join(releaseDir, 'RELEASE-NOTES.md'), text)
  say('SHA256SUMS.txt')
  process.stdout.write(sums)
}

async function publish(names) {
  say(`Publishing ${tag}`)
  const branch = capture('git', 'branch', '--show-current')
  if (branch !== 'main') fail(`A release is made from main, and this is ${branch}`)
  run('git', ['fetch', 'origin', 'main'])
  const head = capture('git', 'rev-parse', 'HEAD')
  if (head !== capture('git', 'rev-parse', 'origin/main')) fail('main is not the same as origin/main: git pull --ff-only (or push what is missing through a pull request)')
  const exists = spawnSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' }).status === 0
  if (exists && !flag('replace')) fail(`The release ${tag} exists. To replace its files and notes: --replace (to withdraw it: gh release delete ${tag} --cleanup-tag)`)
  const files = [...names, 'SHA256SUMS.txt'].map((n) => path.join(releaseDir, n))
  if (!flag('yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`\n${exists ? 'Replace' : 'Create'} the release ${tag} (${head.slice(0, 7)}) with ${files.length} files, in ${capture('gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner')}? [y/N] `)
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) fail('Not published.')
  }
  const notesFile = path.join(releaseDir, 'RELEASE-NOTES.md')
  const pre = version.includes('-') ? ['--prerelease'] : []
  if (exists) {
    run('gh', ['release', 'upload', tag, ...files, '--clobber'])
    run('gh', ['release', 'edit', tag, '--notes-file', notesFile, ...pre])
  } else run('gh', ['release', 'create', tag, ...files, '--title', `Folder Browser ${version}`, '--notes-file', notesFile, '--target', head, ...pre])
  console.log(`\nDone: ${capture('gh', 'release', 'view', tag, '--json', 'url', '-q', '.url')}`)
}

const { names, notes } = preflight()
checks()
build()
verify(names)
await checksumsAndNotes(names, notes)
if (flag('publish')) await publish(names)
else console.log(`\nThe files are in ${releaseDir}. To publish them: node scripts/release-local.mjs --publish`)
