import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The text layer of a PDF is transparent on top of the canvas of the page, so an opaque selection colour
// paints opaque blocks over the glyphs (issue #63). The rule for `.textLayer ::selection` must use the
// translucent token (`--wsnp-pdf-selection`), and the editor's `--wsnp-selection` is for the editors.
const pdf = fs.readFileSync(path.resolve(import.meta.dirname, 'pdf.css'), 'utf8')
const rule = (which: '::selection') => pdf.match(new RegExp(`\\.textLayer\\s+${which}\\s*\\{([^}]+)\\}`))

describe('the selection colour of the text layer of a PDF', () => {
  it('.textLayer ::selection uses the translucent --wsnp-pdf-selection, not --wsnp-selection', () => {
    const block = rule('::selection')
    expect(block, '.textLayer ::selection rule is missing').not.toBeNull()
    expect(block![1]).toMatch(/var\(--wsnp-pdf-selection\)/)
    expect(block![1]).not.toMatch(/var\(--wsnp-selection\)/)
    expect(block![1]).toMatch(/color:\s*transparent/)
  })
  it('no opaque selection colour sneaks back into the text layer', () => {
    // A single match across the whole file keeps a regression that puts `var(--wsnp-selection)` back into
    // a `.textLayer` rule from being silenced by the per-rule check.
    expect(pdf).not.toMatch(/\.textLayer[^{]*\{[^}]*var\(--wsnp-selection\)/)
  })
})