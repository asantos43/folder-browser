// A folder of synthetic files to look at the application with (never real files): `node scripts/demo-folder.ts [folder]` makes it and prints where it is.
//   The pictures of the user guide (`scripts/screenshots.ts`) are made from it too.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makePdf } from '../fixtures/pdf.ts'
import { wavBuffer } from '../fixtures/audio.ts'
import { docxBuffer, odsBuffer, pptxBuffer } from '../fixtures/office.ts'
import { makePng, viewerFiles, writeWsnp } from '../fixtures/build.ts'
import { zipBuffer } from '../fixtures/zip.ts'

export async function makeDemoFolder(folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-demo-'))): Promise<string> {
  const at = (...p: string[]) => path.join(folder, ...p)
  const write = (name: string, data: string | Buffer) => {
    fs.mkdirSync(path.dirname(at(name)), { recursive: true })
    fs.writeFileSync(at(name), data)
  }
  write('README.md', '# Harbor Times\n\nNotes for the **Harbor Times** project.\n\n- [x] Browse folders and ZIP files\n- [ ] Write the March issue\n\n```ts\nconst issue = 3\n```\n')
  write('notes.txt', 'Shopping list\n  - bread\n  - coffee\n  - stamps\n\nCall the printer on Monday.\n')
  write('notes-old.txt', 'Shopping list\n  - bread\n  - tea\n  - stamps\n  - envelopes\n\nCall the printer on Tuesday.\n')
  write('todo.txt', 'Write the March issue\nPhone the harbour office\nBack up the photos\n')
  write('config.json', JSON.stringify({ name: 'harbor-times', version: '1.4.0', port: 8080, features: { search: true, comments: false }, authors: ['Ana', 'Bruno'] }))
  write('data.csv', 'city,country,population\nLisbon,Portugal,545796\nPorto,Portugal,231962\nSantos,Brazil,433656\nRecife,Brazil,1488920\nBergen,Norway,285911\nOslo,Norway,709037\nCádiz,Spain,113066\n')
  write('src/main.ts', "import { greet } from './util.ts'\n\nexport function main(): void {\n  console.log(greet('harbor'))\n}\n\nmain()\n")
  write('src/util.ts', 'export const greet = (name: string): string => `Hello, ${name}!`\n')
  write('docs/guide.md', '# Guide\n\nHow the harbor schedule is built, step by step.\n')
  write('docs/schedule.html', '<!doctype html><html><body><h1>Schedule</h1><p>Ferry at <b>08:30</b>.</p></body></html>')
  write('photos/harbor.png', makePng(640, 360, [30, 110, 160]))
  write('photos/boat.png', makePng(320, 240, [200, 90, 40]))
  write('music/chime.wav', wavBuffer(2, 523))
  write('manual.pdf', makePdf([{ lines: ['Harbor handbook', 'Chapter 1: arriving'] }, { lines: ['Harbor handbook', 'Chapter 2: leaving'] }]))
  write('report.docx', await docxBuffer())
  write('slides.pptx', await pptxBuffer())
  write('budget.ods', await odsBuffer())
  write('tool.bin', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, ...Array.from({ length: 120 }, (_, i) => (i * 7) & 0xff)]))
  write('archive.zip', await zipBuffer([{ name: 'readme.txt', data: 'Inside the ZIP.\n' }, { name: 'letters/', }, { name: 'letters/ana.txt', data: 'Dear Ana,\nSee you at the harbor.\n' }, { name: 'letters/bruno.txt', data: 'Dear Bruno,\nBring the maps.\n' }, { name: 'pictures/dot.png', data: makePng(32, 32), store: true }]))
  fs.mkdirSync(at('empty-folder'), { recursive: true })
  await writeWsnp(at('harbor-times.wsnp'), viewerFiles().filter((f) => f.path !== 'assets/files/page.html'), { title: 'Harbor Times — Local news', url: 'https://harbortimes.example/', viewport: { width: 1280, height: 800, device_pixel_ratio: 1 } })
  return folder
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await makeDemoFolder(process.argv[2] ? path.resolve(process.argv[2]) : undefined))
