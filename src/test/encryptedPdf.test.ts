import { describe, expect, it } from 'vitest'
import { makeEncryptedPdf } from '../../fixtures/pdf.ts'

// The fixture of a PDF with a password is written by hand from the specification: the real pdf.js is the judge of whether it is one (the same library that draws it in the application).
describe('makeEncryptedPdf', () => {
  it('asks for a password, refuses a wrong one, and opens with the right one', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(makeEncryptedPdf([{ lines: ['secret page'] }], 'meadow'))
    const open = (password?: string) => pdfjs.getDocument({ data: data.slice(), password, verbosity: 0 }).promise
    await expect(open()).rejects.toMatchObject({ name: 'PasswordException', code: 1 })
    await expect(open('wrong')).rejects.toMatchObject({ name: 'PasswordException', code: 2 })
    const page = await (await open('meadow')).getPage(1)
    expect((await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join('')).toBe('secret page')
  })
})
