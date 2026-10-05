// A small, valid PDF for the tests (real readers open it): pages of text in Helvetica. Synthetic, like every fixture.
export interface PdfPage {
  width?: number
  height?: number
  lines: string[]
}

const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`)

export function makePdf(pages: PdfPage[]): Buffer {
  const objects: string[] = []
  const fontId = 3 + pages.length * 2
  const pageIds = pages.map((_, i) => 3 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  pages.forEach((page, i) => {
    const width = page.width ?? 595
    const height = page.height ?? 842
    const stream = `BT /F1 24 Tf 72 ${height - 100} Td 30 TL ${page.lines.map((l) => `(${escape(l)}) Tj T*`).join(' ')} ET`
    objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${pageIds[i] + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
