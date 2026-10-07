#!/usr/bin/env node
// Makes build/icon.icns from build/icon.png (1024 × 1024), the picture of the application on macOS, with every size an .icns can have. electron-builder makes one by itself
// when it is not given, but its has no 1024 × 1024 picture (`ic10`) and no 512 at twice the density (`ic14`), and the sharpest places (Finder's preview, a big Dock) show it softer.
//
//   node scripts/make-icns.mjs        needs ImageMagick (`magick`) to scale the picture; the result is committed, so only whoever changes the picture runs this.
//
// An .icns is `icns`, the length of the file, and then pictures: four letters for the kind, the length of the entry (8 + the size of the picture), and a PNG.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
// The kinds of picture, with their size in pixels (the "@2x" ones are the same pixels as the size above, for a screen of twice the density).
export const KINDS = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
]

/** The kinds of picture an .icns has, in the order they are in. */
export function kindsOf(bytes) {
  if (bytes.subarray(0, 4).toString('latin1') !== 'icns' || bytes.readUInt32BE(4) !== bytes.length) throw new Error('not an .icns, or its length is not right')
  const kinds = []
  for (let at = 8; at < bytes.length; at += bytes.readUInt32BE(at + 4)) kinds.push(bytes.subarray(at, at + 4).toString('latin1'))
  return kinds
}

export function makeIcns(source) {
  const entries = KINDS.map(([kind, size]) => {
    const png = execFileSync('magick', [source, '-filter', 'Lanczos', '-resize', `${size}x${size}`, 'PNG32:-'], { maxBuffer: 1 << 26 })
    const head = Buffer.alloc(8)
    head.write(kind, 0, 'latin1')
    head.writeUInt32BE(8 + png.length, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(entries)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.join(root, 'build/icon.icns')
  fs.writeFileSync(out, makeIcns(path.join(root, 'build/icon.png')))
  console.log(`${out}: ${kindsOf(fs.readFileSync(out)).join(' ')}`)
}
