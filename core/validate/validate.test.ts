import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { manifestFor, networkProbeFiles, PNG_1X1, sampleFiles, sha256, writeSampleWsnp, writeWsnp, WSNP_TYPE, type FixtureFile } from '../../fixtures/build.ts'
import { writeZip } from '../archive/writer.ts'
import { WSNPX_TYPE } from '../manifest.ts'
import { openWsnp, verifyContents, type Issue, type IssueCode } from './index.ts'
import { scanCss, scanHtml } from './integrity.ts'
import { isSafePath } from './structure.ts'

let dir: string
beforeAll(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-validate-'))))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

let counter = 0
const file = () => path.join(dir, `f${counter++}.wsnp`)

/** Opens a file and returns the codes it was refused with (an empty list when it opened). */
async function codes(target: string): Promise<IssueCode[]> {
  const result = await openWsnp(target)
  if (result.ok) {
    await result.archive.close()
    return []
  }
  return result.issues.map((i) => i.code)
}

/** Writes a file whose manifest is the fixture's, changed by `edit`. */
async function withManifest(edit: (m: Record<string, unknown>) => void, files: FixtureFile[] = sampleFiles()): Promise<string> {
  const target = file()
  const manifest = manifestFor(files)
  edit(manifest)
  await writeZip(target, [
    { name: 'mimetype', data: WSNP_TYPE },
    { name: 'manifest.json', data: JSON.stringify(manifest), compress: true },
    ...files.map((f) => ({ name: f.path, data: f.data, compress: false })),
  ])
  return target
}

describe('openWsnp: a good file', () => {
  it('opens, and hands over the archive and the manifest', async () => {
    const target = file()
    await writeSampleWsnp(target)
    const result = await openWsnp(target)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.title).toBe('Harbor news')
    expect(result.manifest.pages[0].entry).toBe('index.html')
    expect(result.archive.get('index.html')).toBeTruthy()
    await result.archive.close()
  })

  it('ignores fields and entries it does not know (FORMAT.md sections 4 and 6)', async () => {
    const files = [...sampleFiles(), { path: 'extra/notes.txt', type: 'text/plain', data: 'hello' }]
    const target = await withManifest((m) => Object.assign(m, { something_new: { a: 1 }, format_version: '1.7' }), files)
    expect(await codes(target)).toEqual([])
  })
})

describe('openWsnp: what the file is', () => {
  it('says "not a ZIP" for a text file', async () => {
    const target = file()
    fs.writeFileSync(target, 'this is not a zip file at all, only text that is long enough to be scanned')
    expect(await codes(target)).toEqual(['not-zip'])
  })

  it('refuses ZIP64, ZIP-level encryption and other compression methods, each by name', async () => {
    const sample = file()
    await writeSampleWsnp(sample)
    const patch = (edit: (b: Buffer) => void) => {
      const bytes = fs.readFileSync(sample)
      edit(bytes)
      const out = file()
      fs.writeFileSync(out, bytes)
      return out
    }
    const central = (b: Buffer) => b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    expect(await codes(patch((b) => b.writeUInt16LE(0xffff, b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 10)))).toEqual(['zip64'])
    expect(await codes(patch((b) => b.writeUInt16LE(b.readUInt16LE(central(b) + 8) | 1, central(b) + 8)))).toEqual(['zip-encrypted'])
    expect(await codes(patch((b) => b.writeUInt16LE(12, central(b) + 10)))).toEqual(['zip-method'])
  })

  it('refuses when the first entry is not "mimetype", or is compressed', async () => {
    const wrongOrder = file()
    await writeZip(wrongOrder, [{ name: 'manifest.json', data: '{}' }, { name: 'mimetype', data: WSNP_TYPE }])
    expect(await codes(wrongOrder)).toEqual(['first-entry'])
    const compressed = file()
    await writeZip(compressed, [{ name: 'mimetype', data: WSNP_TYPE, compress: true }, { name: 'manifest.json', data: '{}' }])
    expect(await codes(compressed)).toEqual(['first-entry'])
  })

  it('refuses a "mimetype" with an extra field', async () => {
    const target = file()
    await writeSampleWsnp(target)
    const bytes = fs.readFileSync(target)
    // The local header says 0 bytes of extra field; claiming 4 without room for them is what a bad writer leaves.
    bytes.writeUInt16LE(4, 28)
    fs.writeFileSync(target, bytes)
    expect(await codes(target)).toEqual(['first-entry'])
  })

  it('says "not a WSNP file" for another media type', async () => {
    const target = file()
    await writeZip(target, [{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'manifest.json', data: '{}' }])
    expect(await codes(target)).toEqual(['not-wsnp'])
  })

  it('says a .wsnpx holds an application this viewer cannot run yet', async () => {
    const target = file()
    await writeZip(target, [{ name: 'mimetype', data: WSNPX_TYPE }, { name: 'manifest.json', data: '{}' }])
    expect(await codes(target)).toEqual(['application'])
  })

  it('says a protected file is password-protected, without reading further', async () => {
    const target = file()
    await writeZip(target, [
      { name: 'mimetype', data: WSNP_TYPE },
      { name: 'encryption.json', data: '{"encryption_version":"1.0"}' },
      { name: '_wsnp/encrypted', data: Buffer.alloc(64, 7) },
    ])
    expect(await codes(target)).toEqual(['protected'])
  })

  it('says a file made by a newer version is that', async () => {
    const target = await withManifest((m) => (m.format_version = '2.0'))
    expect(await codes(target)).toEqual(['newer-version'])
  })
})

describe('openWsnp: the manifest', () => {
  it('needs a manifest that is JSON and an object', async () => {
    const none = file()
    await writeZip(none, [{ name: 'mimetype', data: WSNP_TYPE }])
    expect(await codes(none)).toEqual(['no-manifest'])
    const broken = file()
    await writeZip(broken, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'manifest.json', data: '{not json' }])
    expect(await codes(broken)).toEqual(['manifest-json'])
    const list = file()
    await writeZip(list, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'manifest.json', data: '[]' }])
    expect(await codes(list)).toEqual(['manifest-json'])
  })

  it('needs format "wsnp" and a "major.minor" version of major 1', async () => {
    expect(await codes(await withManifest((m) => (m.format = 'other')))).toEqual(['format'])
    expect(await codes(await withManifest((m) => (m.format_version = 'one')))).toEqual(['bad-version'])
    expect(await codes(await withManifest((m) => (m.format_version = '0.9')))).toEqual(['bad-version'])
  })

  it('names each required field that is missing or of the wrong type', async () => {
    const target = await withManifest((m) => {
      delete m.title
      m.created = 'yesterday'
      m.files = 'no'
      delete m.viewport
      m.pages = []
    })
    const result = await openWsnp(target)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((i) => i.field).sort()).toEqual(['created', 'files', 'pages', 'title', 'viewport'])
    expect(result.issues.every((i) => i.code === 'field')).toBe(true)
  })

  it('needs source.url to be an address', async () => {
    expect(await codes(await withManifest((m) => (m.source = { url: 'not an address' })))).toEqual(['source-url'])
    expect(await codes(await withManifest((m) => (m.source = { url: 'javascript:alert(1)' })))).toEqual(['source-url'])
    expect(await codes(await withManifest((m) => delete m.source))).toEqual(['source-url'])
  })
})

describe('openWsnp: the entries', () => {
  it('lists every entry, and finds every listed file', async () => {
    const unlisted = await withManifest(() => {}, [...sampleFiles(), { path: 'assets/files/loose.pdf', type: 'application/pdf', data: 'x' }])
    // Remove the last file from the manifest by rewriting it.
    const manifest = manifestFor(sampleFiles())
    const target = file()
    await writeZip(target, [
      { name: 'mimetype', data: WSNP_TYPE },
      { name: 'manifest.json', data: JSON.stringify(manifest) },
      ...sampleFiles().map((f) => ({ name: f.path, data: f.data })),
      { name: 'assets/files/loose.pdf', data: 'x' },
    ])
    expect(await codes(unlisted)).toEqual([])
    const result = await openWsnp(target)
    expect(result.ok ? [] : result.issues).toEqual([{ code: 'entry-not-listed', path: 'assets/files/loose.pdf' }])

    const missing = await withManifest((m) => (m.files as Record<string, unknown>[]).push({ path: 'assets/images/gone.png', media_type: 'image/png', bytes: 1, sha256: sha256(Buffer.from('x')) }))
    const gone = await openWsnp(missing)
    expect(gone.ok ? [] : gone.issues).toEqual([{ code: 'file-missing', path: 'assets/images/gone.png' }])
  })

  it('compares the size in the manifest with the one in the ZIP directory', async () => {
    const target = await withManifest((m) => ((m.files as { bytes: number }[])[0].bytes += 1))
    const result = await openWsnp(target)
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual(['size-mismatch'])
  })

  it('needs every record of "files" to be well formed', async () => {
    for (const change of [(f: Record<string, unknown>) => delete f.media_type, (f: Record<string, unknown>) => (f.media_type = 'not a type'), (f: Record<string, unknown>) => (f.sha256 = 'ABC'), (f: Record<string, unknown>) => (f.bytes = -1)]) {
      const target = await withManifest((m) => change((m.files as Record<string, unknown>[])[1]))
      const result = await openWsnp(target)
      expect(result.ok ? [] : result.issues.map((i) => i.code)).toContain('file-record')
    }
  })

  it('refuses unsafe names and names that clash when case is ignored', async () => {
    const clash = file()
    const files: FixtureFile[] = [...sampleFiles(), { path: 'assets/images/Pic.png', type: 'image/png', data: PNG_1X1 }, { path: 'assets/images/pic.PNG', type: 'image/png', data: PNG_1X1 }]
    const manifest = manifestFor(files)
    await writeZip(clash, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'manifest.json', data: JSON.stringify(manifest) }, ...files.map((f) => ({ name: f.path, data: f.data }))])
    const clashed = await openWsnp(clash)
    expect(clashed.ok ? [] : clashed.issues.filter((i) => i.code === 'path-clash').length).toBe(1)

    const odd = await withManifest(() => {}, [...sampleFiles(), { path: 'assets/files/café menu.pdf', type: 'application/pdf', data: 'x' }])
    const oddResult = await openWsnp(odd)
    expect(oddResult.ok ? [] : oddResult.issues.map((i) => i.code)).toContain('unsafe-path')
  })

  it('needs the page and the preview when declared', async () => {
    const noPage = await withManifest((m) => (m.pages = [{ entry: 'home.html', title: 'x', description: '', source: m.source }]))
    expect((await openWsnp(noPage)).ok).toBe(false)
    expect(await codes(noPage)).toEqual(['page-missing'])
    expect(await codes(await withManifest((m) => (m.preview = '_wsnp/preview.jpg')))).toEqual(['preview-missing'])
  })

  it('keeps the list of issues short for a file with thousands of faults', async () => {
    const files: FixtureFile[] = Array.from({ length: 200 }, (_, i) => ({ path: `assets/files/f${i}.txt`, type: 'text/plain', data: 'x' }))
    const target = file()
    await writeZip(target, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'manifest.json', data: JSON.stringify(manifestFor([...sampleFiles()])) }, ...sampleFiles().map((f) => ({ name: f.path, data: f.data })), ...files.map((f) => ({ name: f.path, data: f.data }))])
    const result = await openWsnp(target)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toHaveLength(50)
    expect(result.omitted).toBe(150)
  })

  it('does not leave the file open after a refusal', async () => {
    const target = await withManifest((m) => delete m.title)
    for (let i = 0; i < 20; i++) await openWsnp(target)
    fs.rmSync(target) // would fail on Windows if a descriptor were still open
    expect(fs.existsSync(target)).toBe(false)
  })
})

describe('isSafePath', () => {
  it('follows FORMAT.md section 5', () => {
    for (const ok of ['index.html', 'assets/images/a-b_c.1.png', '_wsnp/offline.js']) expect(isSafePath(ok)).toBe(true)
    for (const bad of ['', '/abs', 'a//b', './a', 'a/../b', 'a/./b', 'a b', 'café', 'a\\b', 'a/', 'x'.repeat(256)]) expect(isSafePath(bad)).toBe(false)
  })
})

describe('verifyContents', () => {
  it('passes an intact file, and reports what it read', async () => {
    const target = file()
    await writeSampleWsnp(target)
    const opened = await openWsnp(target)
    if (!opened.ok) throw new Error('did not open')
    const progress: number[] = []
    const report = await verifyContents(opened.archive, opened.manifest, { onProgress: (done) => progress.push(done) })
    await opened.archive.close()
    expect(report.problems).toEqual([])
    expect(report.aborted).toBe(false)
    expect(report.checked).toBe(opened.manifest.files.length)
    expect(report.bytes).toBe(opened.manifest.files.reduce((s, f) => s + f.bytes, 0))
    expect(progress.at(-1)).toBe(report.bytes)
  })

  it('finds a file whose bytes changed, even when the size is the same', async () => {
    const target = file()
    const files = sampleFiles()
    const manifest = manifestFor(files)
    const tampered = files.map((f) => (f.path === 'assets/styles/site.css' ? { ...f, data: String(f.data).replace('rgb(0,128,128)', 'rgb(0,128,127)') } : f))
    await writeZip(target, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'manifest.json', data: JSON.stringify(manifest) }, ...tampered.map((f) => ({ name: f.path, data: f.data }))])
    const opened = await openWsnp(target)
    if (!opened.ok) throw new Error(JSON.stringify(opened.issues))
    const report = await verifyContents(opened.archive, opened.manifest)
    await opened.archive.close()
    expect(report.problems.map((p) => [p.code, p.path])).toEqual([['hash-mismatch', 'assets/styles/site.css']])
  })

  it('stops when asked', async () => {
    const target = file()
    await writeSampleWsnp(target)
    const opened = await openWsnp(target)
    if (!opened.ok) throw new Error('did not open')
    const controller = new AbortController()
    controller.abort()
    const report = await verifyContents(opened.archive, opened.manifest, { signal: controller.signal })
    await opened.archive.close()
    expect(report.aborted).toBe(true)
    expect(report.checked).toBe(0)
  })

  it('flags a page that would reach the network or run its own code', async () => {
    const target = file()
    await writeWsnp(target, networkProbeFiles('http://127.0.0.1:9'))
    const opened = await openWsnp(target)
    if (!opened.ok) throw new Error(JSON.stringify(opened.issues))
    const report = await verifyContents(opened.archive, opened.manifest)
    await opened.archive.close()
    const found = new Set(report.problems.map((p) => p.code))
    expect(found.has('network-reference')).toBe(true)
    expect(found.has('foreign-script')).toBe(true)
  })
})

describe('the content scans', () => {
  const codesOf = (issues: Issue[]) => issues.map((i) => i.code)

  it('accepts the format\'s own script and data scripts', () => {
    const ok = '<!doctype html><script src="_wsnp/offline.js"></script><script type="application/json">{"a":1}</script><script type="application/ld+json">{}</script><style>p{color:red}</style><p style="color:red">x</p><a href="https://example.com/">link</a><link rel="canonical" href="https://example.com/">'
    expect(scanHtml(ok, 'index.html')).toEqual([])
  })
  it('finds an inline script, a foreign script and inline handlers', () => {
    expect(codesOf(scanHtml('<script>alert(1)</script>', 'p'))).toEqual(['inline-script'])
    expect(codesOf(scanHtml('<script src="https://cdn.example/x.js"></script>', 'p'))).toEqual(['foreign-script', 'network-reference'])
    expect(codesOf(scanHtml('<script src="assets/files/x.js"></script>', 'p'))).toEqual(['foreign-script'])
    expect(codesOf(scanHtml('<button onclick="go()">x</button>', 'p'))).toEqual(['inline-handler'])
  })
  it('finds what would load from the network, in every attribute that loads', () => {
    for (const html of ['<img src="https://x.example/a.png">', '<img src="//x.example/a.png">', '<img srcset="a.png 1x, https://x.example/b.png 2x">', '<video poster="http://x.example/p.png"></video>', '<link rel="stylesheet" href="https://x.example/s.css">', '<iframe src="https://x.example/"></iframe>', '<form action="https://x.example/"></form>', '<a ping="https://x.example/p" href="#">x</a>']) {
      expect(codesOf(scanHtml(html, 'p')), html).toContain('network-reference')
    }
  })
  it('looks inside a frame saved inline (srcdoc)', () => {
    expect(codesOf(scanHtml('<iframe srcdoc="&lt;script&gt;x()&lt;/script&gt;"></iframe>', 'p'))).toEqual(['inline-script'])
  })
  it('finds a stylesheet that loads from the network', () => {
    expect(scanCss('a{background:url(https://x.example/a.png)}', 'a.css')).toHaveLength(1)
    expect(scanCss('@import "//x.example/a.css";', 'a.css')).toHaveLength(1)
    expect(scanCss('a{background:url(../images/a.png)} @font-face{src:url(data:font/woff2;base64,AAAA)}', 'a.css')).toEqual([])
  })
})
