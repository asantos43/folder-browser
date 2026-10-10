import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writePageKeepZip } from '../../fixtures/build.ts'
import { openArchive } from '../archive/reader.ts'
import { writeZip } from '../archive/writer.ts'
import { openWsnp, verifyContents } from '../validate/index.ts'
import { ConvertError, convertPageKeepZip, isPageKeepZip } from './pagekeep.ts'

let dir: string
beforeAll(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-convert-'))))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const GENERATOR = { name: 'Folder Browser', version: '1.0.0' }
const convert = async (zip: string, name = 'out.wsnp') => {
  const out = path.join(dir, name)
  return { out, report: await convertPageKeepZip(zip, out, { generator: GENERATOR }) }
}
const readAll = async (file: string) => {
  const archive = await openArchive(file)
  const names = archive.entries.map((e) => e.name)
  const text = async (name: string) => (await archive.read(name)).toString()
  return { archive, names, text }
}
/** A ZIP as PageKeep writes it, with a page of the test's own. */
async function zipOf(name: string, html: string, snapshot: unknown = { source_url: 'https://site.example/', title: 'T', captured_at: '2026-09-25T17:42:40.614Z', tool: 'PageKeep 1.5.0', resources: [], failed: [] }, extra: { name: string; data: string | Buffer }[] = []) {
  const file = path.join(dir, name)
  await writeZip(file, [{ name: 'index.html', data: html, compress: true }, { name: 'snapshot.json', data: JSON.stringify(snapshot) }, ...extra])
  return file
}

describe('isPageKeepZip', () => {
  it('knows a PageKeep ZIP by index.html and snapshot.json and no mimetype', async () => {
    const zip = path.join(dir, 'known.zip')
    await writePageKeepZip(zip)
    expect(await isPageKeepZip(zip)).toBe(true)
  })
  it('is false for a .wsnp, a ZIP without the two files, and what is not a ZIP', async () => {
    const plain = path.join(dir, 'plain.zip')
    await writeZip(plain, [{ name: 'a.txt', data: 'a' }])
    const notZip = path.join(dir, 'not.zip')
    fs.writeFileSync(notZip, 'not a zip')
    const wsnp = path.join(dir, 'with-mimetype.zip')
    await writeZip(wsnp, [{ name: 'mimetype', data: 'application/vnd.wsnp+zip' }, { name: 'index.html', data: '<p>' }, { name: 'snapshot.json', data: '{}' }])
    expect(await isPageKeepZip(plain)).toBe(false)
    expect(await isPageKeepZip(notZip)).toBe(false)
    expect(await isPageKeepZip(wsnp)).toBe(false)
  })
})

describe('convertPageKeepZip', () => {
  it.each([false, true])('turns a PageKeep ZIP (early format: %s) into a .wsnp that passes the checks of the format', async (old) => {
    const zip = path.join(dir, `ok-${old}.zip`)
    await writePageKeepZip(zip, { old })
    const { out, report } = await convert(zip, `ok-${old}.wsnp`)
    const opened = await openWsnp(out)
    if (!opened.ok) throw new Error(JSON.stringify(opened.issues))
    expect((await verifyContents(opened.archive, opened.manifest)).problems).toEqual([])
    await opened.archive.close()
    expect(report.manifest).toMatchObject({ format: 'wsnp', format_version: '1.0', title: 'Meadow news', source: { url: 'https://meadowtimes.example/news', canonical: 'https://meadowtimes.example/news', language: 'en' }, converted_from: { format: 'zip', tool: old ? 'Page Snapshot 1.0.0' : 'PageKeep 1.5.0' } })
  })

  it('moves each asset into its folder by type, keeps the names, and points the page and the stylesheets to the new places', async () => {
    const zip = path.join(dir, 'layout.zip')
    await writePageKeepZip(zip)
    const { out } = await convert(zip, 'layout.wsnp')
    const { archive, names, text } = await readAll(out)
    expect(names).toEqual(expect.arrayContaining(['mimetype', 'manifest.json', 'index.html', 'assets/styles/site-1x05wni.css', 'assets/styles/base-2b7c.css', 'assets/fonts/font-2ab.woff2', 'assets/images/logo-1qg48nw.png', 'assets/files/notes-9zz9zz.pdf', '_wsnp/offline.js']))
    expect(names[0]).toBe('mimetype')
    const page = await text('index.html')
    expect(page).toContain('assets/images/logo-1qg48nw.png')
    expect(page).toContain('<script src="_wsnp/offline.js">')
    expect(page).not.toMatch(/<script>[^<]/)
    expect(page).toContain('assets/files/notes-9zz9zz.pdf')
    const css = await text('assets/styles/site-1x05wni.css')
    expect(css).toContain('../fonts/font-2ab.woff2')
    expect(css).toContain('base-2b7c.css')
    expect(await text('_wsnp/offline.js')).toContain("dataset.offline = 'ready'")
    await archive.close()
  })

  it('records what the ZIP did not: the viewport, the pixel ratio, and that the whole page was not loaded', async () => {
    const zip = path.join(dir, 'unrecorded.zip')
    await writePageKeepZip(zip)
    const { report } = await convert(zip, 'unrecorded.wsnp')
    expect(report.manifest).toMatchObject({ viewport: { width: 1280, height: 800, device_pixel_ratio: 1 }, capture: { load_whole_page: false } })
  })

  it('removes event handlers and references that would load from the network, and says so; the result still passes', async () => {
    const zip = await zipOf('hostile.zip', '<!doctype html><html><head><meta charset="utf-8"><title>x</title><link rel="stylesheet" href="https://cdn.example/a.css"></head><body><img src="https://cdn.example/p.png" onerror="alert(1)"><a href="https://site.example/next" ping="https://spy.example/">next</a><script src="https://cdn.example/x.js"></script></body></html>')
    const { out, report } = await convert(zip, 'hostile.wsnp')
    expect(report.warnings.length).toBeGreaterThanOrEqual(3)
    const opened = await openWsnp(out)
    if (!opened.ok) throw new Error(JSON.stringify(opened.issues))
    const report2 = await verifyContents(opened.archive, opened.manifest)
    expect(report2.problems).toEqual([])
    const page = (await opened.archive.read('index.html')).toString()
    expect(page).not.toContain('onerror')
    expect(page).not.toContain('ping=')
    expect(page).not.toContain('cdn.example')
    expect(page).toContain('https://site.example/next')
    await opened.archive.close()
  })

  it('gives a name that clashes (ignoring case) or is not allowed a number, so nothing is lost', async () => {
    const zip = await zipOf('names.zip', '<img src="assets/Pic.png"><img src="assets/pic.png">', undefined, [
      { name: 'assets/Pic.png', data: 'one' },
      { name: 'assets/pic.png', data: 'two' },
    ])
    const { out } = await convert(zip, 'names.wsnp')
    const { archive, names } = await readAll(out)
    expect(names.filter((n) => n.startsWith('assets/')).map((n) => n.toLowerCase()).sort()).toEqual(['assets/images/pic-2.png', 'assets/images/pic.png'])
    await archive.close()
  })

  it('refuses a ZIP that is not a PageKeep ZIP, one without source_url, and one whose snapshot.json cannot be read, each for its own reason', async () => {
    const plain = path.join(dir, 'plain2.zip')
    await writeZip(plain, [{ name: 'a.txt', data: 'a' }])
    await expect(convertPageKeepZip(plain, path.join(dir, 'x.wsnp'), { generator: GENERATOR })).rejects.toMatchObject({ code: 'not-pagekeep' })
    await expect(convertPageKeepZip(await zipOf('nosource.zip', '<p>', { title: 'x' }), path.join(dir, 'y.wsnp'), { generator: GENERATOR })).rejects.toMatchObject({ code: 'no-source-url' })
    const broken = path.join(dir, 'broken.zip')
    await writeZip(broken, [{ name: 'index.html', data: '<p>' }, { name: 'snapshot.json', data: '{not json' }])
    await expect(convertPageKeepZip(broken, path.join(dir, 'z.wsnp'), { generator: GENERATOR })).rejects.toBeInstanceOf(ConvertError)
  })

  it('never changes the original ZIP', async () => {
    const zip = path.join(dir, 'untouched.zip')
    await writePageKeepZip(zip)
    const before = fs.readFileSync(zip)
    await convert(zip, 'untouched.wsnp')
    expect(fs.readFileSync(zip).equals(before)).toBe(true)
  })
})
