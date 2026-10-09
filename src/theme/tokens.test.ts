import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Tokens are written in `tokens.css`, one block per theme (`[data-theme='dark']`, `[data-theme='light']`).
// A test that reads the file keeps them in one place: a new theme or a colour that comes back to opaque
// is caught here, before the PDF paints opaque blocks over the glyphs again.
const tokens = fs.readFileSync(path.resolve(import.meta.dirname, 'tokens.css'), 'utf8')
const themeBlock = /:root\[data-theme=['"](\w+)['"]\]\s*\{([\s\S]*?)\n\}/gs
const token = (block: string, name: string): string | undefined => {
  const match = block.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))
  return match?.[1].trim()
}
/** A colour with alpha < 1: hex with alpha (#rrggbbaa, last byte not ff), `rgba(...)`, `hsla(...)`, or `color-mix(... transparent ...)`. */
function alphaBelow1(value: string): boolean {
  const v = value.trim().toLowerCase()
  const hex8 = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/)
  if (hex8) return parseInt(hex8[4], 16) < 255
  const functional = v.match(/^(rgba?|hsla?)\(\s*([\d.]+%?)\s*,?\s*([\d.]+%?)\s*,?\s*([\d.]+%?)\s*[,/]\s*([\d.]+%?)\s*\)$/)
  if (functional) {
    const a = functional[5]
    const num = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a)
    return num < 1
  }
  if (v.startsWith('color-mix(') && /\btransparent\b/.test(v)) return true
  return false
}

describe('the selection of a PDF (the text layer is invisible over the canvas of the page)', () => {
  for (const match of tokens.matchAll(themeBlock)) {
    const theme = match[1]
    it(`--wsnp-pdf-selection is defined in ${theme} with alpha < 1`, () => {
      const block = match[2]
      expect(token(block, 'wsnp-selection'), `--wsnp-selection in ${theme}`).toBeDefined()
      const pdf = token(block, 'wsnp-pdf-selection')
      expect(pdf, `--wsnp-pdf-selection in ${theme}`).toBeDefined()
      expect(alphaBelow1(pdf!), `${theme}: ${pdf} must have alpha < 1 (the canvas would be hidden otherwise)`).toBe(true)
    })
  }
})