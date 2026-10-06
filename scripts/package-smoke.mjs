#!/usr/bin/env node
// Smoke test of the release files in release/ (docs/ARCHITECTURE.md, "Testing", packaging): each file that is there is opened with the tool
// of its system, and the application inside is started and asked for its version. What cannot be checked on this system is skipped and said.
//
//   node scripts/package-smoke.mjs [--dir=release] [--no-sandbox]
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const dir = path.resolve(root, args.find((a) => a.startsWith('--dir='))?.slice(6) ?? 'release')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const MIME = 'application/vnd.wsnp+zip'

let failed = 0
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `: ${detail}`}`)
  if (!ok) failed++
}
const skip = (name, why) => console.log(`SKIP  ${name}: ${why}`)
const has = (tool) => spawnSync(tool, ['--version'], { stdio: 'ignore' }).error === undefined || spawnSync('which', [tool], { stdio: 'ignore' }).status === 0
const magic0 = (tmp) => fs.readFileSync(path.join(tmp, 'root/usr/share/mime/packages/folder-browser.xml'), 'utf8')
const out = (cmd, ...a) => execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28 })

/** What the file association needs on Linux, from a list of the files of a package and its install script. */
function linuxPackage(kind, file, listing, scripts) {
  check(listing.includes('/usr/share/applications/folder-browser.desktop'), `${kind}: has the menu entry`)
  // One file for the type, ours (by name and by the first entry of the ZIP, with the icon of the application): a second one (electron-builder makes it from a file association with a
  // `mimeType`) says the icon is a generic document, and the desktop may take that one.
  check(listing.includes('/usr/share/mime/packages/folder-browser.xml'), `${kind}: has the file type (by name, and by the first entry of the ZIP)`)
  check(listing.split('\n').filter((line) => /\/usr\/share\/mime\/packages\/[^/\s]+\.xml/.test(line)).length === 1, `${kind}: has only one file that says what a .wsnp is`)
  check(/folder-browser\.png/.test(listing), `${kind}: has the icon`)
  // The desktop's icon theme (hicolor) lists sizes up to 512: a lone 1024 × 1024 picture is not found by it, and the menu shows no icon.
  for (const size of ['16x16', '32x32', '48x48', '128x128', '256x256', '512x512']) check(new RegExp(`/usr/share/icons/hicolor/${size}/apps/folder-browser\\.png`).test(listing), `${kind}: has the icon at ${size}`)
  check(!/hicolor\/1024x1024/.test(listing), `${kind}: has no icon at a size the icon theme does not list`)
  check(/update-mime-database/.test(scripts), `${kind}: its install script tells the desktop about the new file type`)
  check(/chrome-sandbox/.test(scripts), `${kind}: its install script sets the permission of the sandbox helper`)
}

const files = fs.existsSync(dir) ? fs.readdirSync(dir) : []
if (!files.length) {
  console.error(`nothing in ${dir}: run npm run package:linux|win|mac first`)
  process.exit(2)
}

for (const name of files.filter((f) => f.endsWith('.deb'))) {
  if (!has('dpkg-deb')) {
    skip(name, 'dpkg-deb is not here')
    continue
  }
  const file = path.join(dir, name)
  check(out('dpkg-deb', '-f', file, 'Version') .trim() === version, `${name}: the package says version ${version}`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-deb-'))
  try {
    execFileSync('dpkg-deb', ['-e', file, path.join(tmp, 'ctl')])
    execFileSync('dpkg-deb', ['-x', file, path.join(tmp, 'root')])
    const desktop = fs.readFileSync(path.join(tmp, 'root/usr/share/applications/folder-browser.desktop'), 'utf8')
    check(desktop.includes(`MimeType=${MIME}`), `${name}: the menu entry handles ${MIME}`)
    check(/^Exec=.*%U$/m.test(desktop), `${name}: the menu entry takes the files it is opened with (%U)`)
    check(/^Icon=folder-browser$/m.test(desktop), `${name}: the menu entry has the icon`)
    const types = (/^MimeType=(.*)$/m.exec(desktop)?.[1] ?? '').split(';').filter(Boolean)
    check(types.length === new Set(types).size, `${name}: the menu entry lists each file type once`)
    check(magic0(tmp).includes('<icon name="folder-browser"/>') && !/x-office-document/.test(magic0(tmp)), `${name}: the file type has the icon of the application`)
    const magic = fs.readFileSync(path.join(tmp, 'root/usr/share/mime/packages/folder-browser.xml'), 'utf8')
    check(magic.includes(`type="${MIME}"`) && magic.includes('mimetypeapplication/vnd.wsnp+zip') && magic.includes('offset="30"'), `${name}: a file is told from a plain ZIP by its first entry`)
    linuxPackage(`${name}`, file, out('dpkg-deb', '-c', file).replace(/\/\.\//g, '/'), fs.readFileSync(path.join(tmp, 'ctl/postinst'), 'utf8'))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

for (const name of files.filter((f) => f.endsWith('.rpm'))) {
  if (!has('rpm')) {
    skip(name, 'rpm is not here')
    continue
  }
  const file = path.join(dir, name)
  check(out('rpm', '-qp', '--qf', '%{VERSION}', file).trim() === version, `${name}: the package says version ${version}`)
  linuxPackage(name, file, out('rpm', '-qpl', file), out('rpm', '-qp', '--scripts', file))
}

// macOS: the application the .dmg holds has its icon at every size up to 1024 (an .icns is a list of pictures: `ic10` is 512 at twice the density, `ic09` is 512).
for (const app of fs.readdirSync(dir).filter((d) => d.startsWith('mac')).flatMap((d) => fs.readdirSync(path.join(dir, d)).filter((a) => a.endsWith('.app')).map((a) => path.join(dir, d, a)))) {
  const icns = path.join(app, 'Contents/Resources/icon.icns')
  if (!fs.existsSync(icns)) {
    check(false, `${path.basename(app)}: has icon.icns`)
    continue
  }
  const bytes = fs.readFileSync(icns)
  const types = []
  for (let at = 8; at + 8 <= bytes.length; at += bytes.readUInt32BE(at + 4)) types.push(bytes.subarray(at, at + 4).toString('latin1'))
  check(bytes.subarray(0, 4).toString() === 'icns' && ['icp4', 'icp5', 'ic07', 'ic08', 'ic09', 'ic10'].every((t) => types.includes(t)), `${path.basename(app)}: icon.icns has the pictures from 16 to 1024 pixels`, types.join(' '))
}

for (const name of files.filter((f) => f.endsWith('.exe') || f.endsWith('.dmg'))) {
  const size = fs.statSync(path.join(dir, name)).size
  check(size > 50 * 2 ** 20, `${name}: is there and is a whole installer (${Math.round(size / 2 ** 20)} MB)`)
}

// The application itself starts and says its version (Linux: the unpacked folder electron-builder leaves next to the packages).
const unpacked = path.join(dir, 'linux-unpacked')
if (fs.existsSync(unpacked) && process.platform === 'linux') {
  const exe = path.join(unpacked, 'folder-browser')
  const run = spawnSync(exe, [...(args.includes('--no-sandbox') ? ['--no-sandbox'] : []), '--app-version'], { encoding: 'utf8', timeout: 60_000 })
  check(run.status === 0 && run.stdout.trim().split('\n').pop() === version, 'the application starts and says its version', `${run.status} ${run.stdout} ${run.stderr.slice(-300)}`)
} else skip('the application starts and says its version', 'no linux-unpacked folder on this system')

console.log(failed ? `\n${failed} check(s) failed` : '\nall packaging checks passed')
process.exit(failed ? 1 : 0)
