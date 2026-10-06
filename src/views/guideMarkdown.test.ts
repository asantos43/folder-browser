import { describe, expect, it } from 'vitest'
import { renderGuide, slugOf } from './guideMarkdown.ts'

describe('slugOf', () => {
  it('makes the address of a heading as GitHub does, which is what the guide links to', () => {
    expect(slugOf('Tables (CSV and TSV)')).toBe('tables-csv-and-tsv')
    expect(slugOf('Two editor groups')).toBe('two-editor-groups')
    expect(slugOf('`.wsnp` files')).toBe('wsnp-files')
    expect(slugOf('Várias linhas, Recortar, Copiar e Colar')).toBe('várias-linhas-recortar-copiar-e-colar')
    expect(slugOf('Zoom, Find, Copy and Print')).toBe('zoom-find-copy-and-print')
  })
})

describe('renderGuide', () => {
  it('gives each heading its address, so a link to it scrolls', () => {
    const html = renderGuide('## Tables (CSV and TSV)\n\ntext')
    expect(html).toContain('<h2 id="tables-csv-and-tsv">')
  })
  it('shows a picture of the guide, read from the build, and nothing else: a path elsewhere and an address of the web are only their description', () => {
    expect(renderGuide('![A table](images/table.png)')).toContain('<img src="./guide/images/table.png" alt="A table" loading="lazy">')
    for (const src of ['https://example.com/x.png', '../secret.png', '/etc/passwd', 'images/../x.png', 'images/x.svg', 'file:///x.png']) {
      const html = renderGuide(`![the picture](${src})`)
      expect(html, src).not.toContain('<img')
      // (markdown-it itself refuses an address like file: and leaves it as text.)
      expect(html, src).toMatch(/md-image|!\[the picture\]/)
    }
  })
  it('keeps a link to another part of the guide and a link to the web, and drops any other (a file of the repository, a script)', () => {
    expect(renderGuide('[a](#two-editor-groups)')).toContain('href="#two-editor-groups"')
    expect(renderGuide('[a](https://example.com/)')).toContain('href="https://example.com/"')
    for (const href of ['../TODO.md', 'javascript:alert(1)', 'file:///etc/passwd', 'docs/x.md']) expect(renderGuide(`[a](${href})`), href).not.toContain('href=')
  })
  it('shows raw HTML as text', () => {
    expect(renderGuide('<script>alert(1)</script>')).toContain('&lt;script&gt;')
  })
})
