import { describe, expect, it } from 'vitest'
import { DOC_ASSETS, DOC_CSP, DocFiles, docPage, documentFlavour } from './docs.ts'

describe('documentFlavour', () => {
  it('sends each kind of document to the library that draws it best', () => {
    expect(documentFlavour(undefined, 'report.docx')).toBe('docx')
    expect(documentFlavour(undefined, 'macro.docm')).toBe('docx')
    expect(documentFlavour(undefined, 'deck.pptx')).toBe('pptx')
    expect(documentFlavour(undefined, 'show.ppsx')).toBe('pptx')
  })
  it('gives the OpenDocument family, the older Office files and the spreadsheets to the library that reads them all', () => {
    for (const name of ['a.odt', 'a.ods', 'a.odp', 'a.odg', 'a.doc', 'a.ppt', 'a.xls', 'a.xlsx', 'a.xlsm']) expect(documentFlavour(undefined, name), name).toBe('odf')
  })
  it('goes by the declared type when there is one (a snapshot’s manifest)', () => {
    expect(documentFlavour('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'download')).toBe('docx')
    expect(documentFlavour('application/vnd.oasis.opendocument.text', 'download')).toBe('odf')
  })
  it('says nothing about a file that is not a document', () => {
    for (const name of ['a.txt', 'a.zip', 'a.pdf', 'a.png', 'doc', 'docx']) expect(documentFlavour(undefined, name), name).toBeNull()
  })
})

describe('docPage and its policy', () => {
  it('loads only the script of its own flavour, from its own address', () => {
    for (const flavour of ['docx', 'pptx', 'odf'] as const) {
      const page = docPage(flavour, 'a.docx')
      expect(page).toContain(`<script src="/_v/${flavour}.js">`)
      expect(DOC_ASSETS[flavour]).toContain(`${flavour}.js`)
      expect(page.match(/<script/g)).toHaveLength(1)
    }
  })
  it('names the document in the page, without letting its name write markup', () => {
    const page = docPage('odf', '"><script>alert(1)</script>.odt')
    expect(page).not.toContain('<script>alert')
    expect(page).toContain('<meta name="doc-name" content="&#34;&#62;&#60;script&#62;alert(1)&#60;/script&#62;.odt">')
    expect(page.match(/<script/g)).toHaveLength(1)
  })
  it('reaches nothing outside itself: no network, an opaque origin', () => {
    expect(DOC_CSP).toContain('sandbox allow-scripts')
    expect(DOC_CSP).toContain("default-src 'none'")
    expect(DOC_CSP).not.toMatch(/https?:|\*/)
    expect(DOC_CSP).toContain("connect-src 'self' data:")
  })
})

describe('DocFiles', () => {
  const file = { bytes: new Uint8Array([1, 2, 3]), name: 'a.docx', flavour: 'docx' as const }
  it('names a document by an unguessable token, and forgets it when it is let go', () => {
    const docs = new DocFiles()
    const a = docs.add(file)
    const b = docs.add(file)
    expect(a).toMatch(/^d[0-9a-f]{24}$/)
    expect(a).not.toBe(b)
    expect(docs.get(a)).toBe(file)
    docs.release(a)
    expect(docs.has(a)).toBe(false)
    expect(docs.has(b)).toBe(true)
    docs.releaseAll()
    expect(docs.has(b)).toBe(false)
  })
})
