import crypto from 'node:crypto'
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

// ---- a PDF with a password (the standard security handler, version 2, revision 3: RC4 with a 128-bit key), written from the PDF 1.7 specification, section 7.6

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex')
const md5 = (...parts: Buffer[]): Buffer => crypto.createHash('md5').update(Buffer.concat(parts)).digest()

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i)
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
  }
  const out = Buffer.alloc(data.length)
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255
    j = (j + s[i]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255]
  }
  return out
}
const padded = (password: string): Buffer => Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32)
const xorKey = (key: Buffer, i: number): Buffer => Buffer.from(key.map((b) => b ^ i))

/** The same pages as `makePdf`, with the content of the pages encrypted: opening it asks for `password` (the owner's password is another one, so only this opens it). */
export function makeEncryptedPdf(pages: PdfPage[], password: string): Buffer {
  const id = md5(Buffer.from('folder-browser fixture'))
  const permissions = -4
  // Algorithm 3: the owner entry, from a password the user does not have.
  let digest = md5(padded(`${password}-owner`))
  for (let i = 0; i < 50; i++) digest = md5(digest)
  let owner = rc4(digest.subarray(0, 16), padded(password))
  for (let i = 1; i <= 19; i++) owner = rc4(xorKey(digest.subarray(0, 16), i), owner)
  // Algorithm 2: the key of the file.
  const flags = Buffer.alloc(4)
  flags.writeInt32LE(permissions)
  let key = md5(padded(password), owner, flags, id)
  for (let i = 0; i < 50; i++) key = md5(key.subarray(0, 16))
  key = key.subarray(0, 16)
  // Algorithm 5: the user entry.
  let user = rc4(key, md5(PAD, id))
  for (let i = 1; i <= 19; i++) user = rc4(xorKey(key, i), user)
  user = Buffer.concat([user, Buffer.alloc(16)])
  const objectKey = (n: number): Buffer => md5(key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 16)

  const fontId = 3 + pages.length * 2
  const encryptId = fontId + 1
  const pageIds = pages.map((_, i) => 3 + i * 2)
  const objects: Buffer[] = []
  const text = (value: string) => Buffer.from(value, 'latin1')
  objects[1] = text('<< /Type /Catalog /Pages 2 0 R >>')
  objects[2] = text(`<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  pages.forEach((page, i) => {
    const width = page.width ?? 595
    const height = page.height ?? 842
    const content = text(`BT /F1 24 Tf 72 ${height - 100} Td 30 TL ${page.lines.map((l) => `(${escape(l)}) Tj T*`).join(' ')} ET`)
    objects[pageIds[i]] = text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${pageIds[i] + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`)
    const encrypted = rc4(objectKey(pageIds[i] + 1), content)
    objects[pageIds[i] + 1] = Buffer.concat([text(`<< /Length ${encrypted.length} >>\nstream\n`), encrypted, text('\nendstream')])
  })
  objects[fontId] = text('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  objects[encryptId] = text(`<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${permissions} /O <${owner.toString('hex')}> /U <${user.toString('hex')}> >>`)

  const chunks: Buffer[] = [text('%PDF-1.4\n')]
  const offsets: number[] = []
  let length = chunks[0].length
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = length
    const body = Buffer.concat([text(`${n} 0 obj\n`), objects[n], text('\nendobj\n')])
    chunks.push(body)
    length += body.length
  }
  const xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  const hexId = id.toString('hex')
  chunks.push(text(`${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R /Encrypt ${encryptId} 0 R /ID [<${hexId}> <${hexId}>] >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(chunks)
}
