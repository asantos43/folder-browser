import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { KINDS, kindsOf } from './make-icns.mjs'

// The picture of the application, on every system. electron-builder makes Windows' `.ico` and macOS's `.icns` from build/icon.png, and Linux
// takes the pictures of build/icons as they are: the desktop's icon theme lists sizes only up to 512, so a lone 1024 × 1024 picture is never found
// and the menu shows no icon (it did, in the first .rpm).
const root = path.resolve(import.meta.dirname, '..')
const png = (file: string) => {
  const bytes = fs.readFileSync(path.join(root, file))
  expect(bytes.subarray(1, 4).toString(), `${file} is a PNG`).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), depth: bytes[24], colour: bytes[25] }
}

describe('the icon of the application', () => {
  it('is a square picture big enough for the .icns of macOS (at least 512, 1024 for its sharpest size) and the .ico of Windows, with transparency', () => {
    const { width, height, colour } = png('build/icon.png')
    expect(width).toBe(height)
    expect(width).toBeGreaterThanOrEqual(1024)
    expect(colour, 'colour type 6 is RGBA').toBe(6)
  })

  it('has, for Linux, a picture at each size of the icon theme, as large as its name says', () => {
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    for (const size of sizes) {
      const { width, height, depth, colour } = png(`build/icons/${size}x${size}.png`)
      expect([width, height], `${size}x${size}.png`).toEqual([size, size])
      expect([depth, colour], `${size}x${size}.png is 8-bit RGBA`).toEqual([8, 6])
    }
    expect(fs.readdirSync(path.join(root, 'build/icons')).sort()).toEqual(sizes.map((s) => `${s}x${s}.png`).sort())
  })

  it('has, for macOS, an .icns with every size (16 to 1024 pixels, and the ones at twice the density), each a PNG as big as its kind says', () => {
    const bytes = fs.readFileSync(path.join(root, 'build/icon.icns'))
    expect(kindsOf(bytes)).toEqual(KINDS.map(([kind]) => kind))
    let at = 8
    for (const [kind, size] of KINDS) {
      const length = bytes.readUInt32BE(at + 4)
      const picture = bytes.subarray(at + 8, at + length)
      expect(picture.subarray(1, 4).toString(), `${kind} is a PNG`).toBe('PNG')
      expect([picture.readUInt32BE(16), picture.readUInt32BE(20)], kind).toEqual([size, size])
      at += length
    }
  })

  it('is given to electron-builder for macOS as that .icns, and for Linux as the folder of pictures', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build
    expect(config.mac.icon).toBe('build/icon.icns')
    expect(config.linux.icon).toBe('build/icons')
  })

  it('is given to electron-builder for Linux as that folder', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build
    expect(config.linux.icon).toBe('build/icons')
  })
})
