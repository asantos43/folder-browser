// Synthetic files for the tests and the phase 0 prototype. Real captures are private and never used here.
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { writeZip, type WriteEntry } from '../core/archive/writer.ts'
import { makePdf } from './pdf.ts'
import { zipSync } from './zip.ts'

export const WSNP_TYPE = 'application/vnd.wsnp+zip'
export const sha256 = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex')

/** A valid 1×1 PNG. */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

export interface FixtureFile {
  path: string
  type: string
  data: Buffer | string
  /** `original_url` in the manifest, for files that came from the web. */
  url?: string
  /** `source` in the manifest (default `page`; `generated` for index.html and _wsnp/*). */
  source?: string
  compress?: boolean
}

export interface WsnpOptions {
  title?: string
  url?: string
  viewport?: { width: number; height: number; device_pixel_ratio: number }
  /** Extra manifest fields, or overrides. */
  manifest?: Record<string, unknown>
  /** Entries listed in the manifest with these values instead of the real ones (for corrupt files). */
  listing?: (files: Record<string, unknown>[]) => void
}

const bytesOf = (data: Buffer | string): Buffer => (typeof data === 'string' ? Buffer.from(data) : data)

export function manifestFor(files: FixtureFile[], options: WsnpOptions = {}): Record<string, unknown> {
  const url = options.url ?? 'https://harbortimes.example/'
  const title = options.title ?? 'Harbor news'
  const source = { url, canonical: '', language: 'en' }
  const listed = files.map((f) => {
    const bytes = bytesOf(f.data)
    return {
      path: f.path,
      ...(f.url ? { original_url: f.url } : {}),
      media_type: f.type,
      bytes: bytes.length,
      sha256: sha256(bytes),
      source: f.source ?? 'page',
    }
  })
  options.listing?.(listed)
  return {
    format: 'wsnp',
    format_version: '1.0',
    generator: { name: 'folder-browser fixtures', version: '0.0.0' },
    created: '2026-09-29T12:00:00.000Z',
    title,
    description: 'A synthetic page.',
    source,
    pages: [{ entry: 'index.html', title, description: 'A synthetic page.', source }],
    viewport: options.viewport ?? { width: 1280, height: 800, device_pixel_ratio: 1 },
    capture: { load_whole_page: true },
    files: listed,
    failed: [],
    ...options.manifest,
  }
}

/** Writes a .wsnp: `mimetype` first and stored, then the manifest, then the files in the order given. */
export async function writeWsnp(path: string, files: FixtureFile[], options: WsnpOptions = {}): Promise<Record<string, unknown>> {
  const manifest = manifestFor(files, options)
  await writeZip(path, [
    { name: 'mimetype', data: WSNP_TYPE },
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2), compress: true },
    ...files.map((f) => ({ name: f.path, data: bytesOf(f.data), compress: f.compress ?? /^(text\/|application\/json|image\/svg)/.test(f.type) })),
  ])
  return manifest
}

const generated = (path: string, type: string, data: Buffer | string): FixtureFile => ({ path, type, data, source: 'generated' })

// ---------------------------------------------------------------- a small page that works

const SAMPLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Harbor news</title>
<link rel="stylesheet" href="assets/styles/site.css"></head><body>
<h2 id="item">Item 1</h2><button id="next" type="button">Next</button>
<img id="logo" src="assets/images/logo.png" alt="">
<a id="ext" href="https://example.com/more">more</a>
<script src="_wsnp/offline.js"></script></body></html>`

const SAMPLE_JS = `document.documentElement.dataset.offline = 'ready';
let i = 1;
document.getElementById('next').onclick = () => { i++; document.getElementById('item').textContent = 'Item ' + i; };`

const SAMPLE_CSS = `h2{color:rgb(0,128,128)}@font-face{font-family:F;src:url(../fonts/f.woff2)}body{font-family:F,sans-serif}`

export function sampleFiles(): FixtureFile[] {
  return [
    generated('index.html', 'text/html', SAMPLE_HTML),
    { path: 'assets/styles/site.css', type: 'text/css', data: SAMPLE_CSS, url: 'https://harbortimes.example/site.css' },
    { path: 'assets/fonts/f.woff2', type: 'font/woff2', data: Buffer.from('wOF2-not-a-real-font'), url: 'https://harbortimes.example/f.woff2' },
    { path: 'assets/images/logo.png', type: 'image/png', data: PNG_1X1, url: 'https://harbortimes.example/logo.png' },
    generated('_wsnp/offline.js', 'text/javascript', SAMPLE_JS),
  ]
}

/** A richer snapshot for the interface tests: source, pictures, a font, and files that cannot be shown (PDF, ZIP, video) with links to them. */
export const RICH_PDF = makePdf([{ lines: ['Harbor report', 'Page one of two'] }, { lines: ['Harbor report', 'Page two of two'] }])
/** A ZIP inside the snapshot: folders, text, JSON, a picture, and a ZIP inside it. */
export const INNER_ZIP = zipSync([{ name: 'deep.txt', data: 'a file in a ZIP in a ZIP' }])
export const RICH_ZIP = zipSync([
  { name: 'docs/' },
  { name: 'docs/readme.txt', data: 'Harbor notes: the ferry leaves at noon.\n' },
  { name: 'docs/data.json', data: '{"boats":3,"open":true}' },
  { name: 'img/' },
  { name: 'img/dot.png', data: PNG_1X1 },
  { name: 'top.txt', data: 'top level file\n' },
  { name: 'nested.zip', data: INNER_ZIP },
])
export function richFiles(): FixtureFile[] {
  const files = sampleFiles()
  const page = files.find((f) => f.path === 'index.html')!
  page.data = String(page.data).replace('</body>', '<p><a id="pdf" href="assets/files/report.pdf">The report (PDF)</a> <a id="zip" href="assets/files/bundle.zip">All files (ZIP)</a> <a id="pic" href="assets/images/mark.svg">The mark</a> <a id="hash" href="#end">Go to the end</a> <a id="zipblank" href="assets/files/bundle.zip" target="_blank" rel="noopener">ZIP in a new window</a> <a id="zipdl" href="assets/files/bundle.zip" download>ZIP to download</a></p><p id="end">The end of the page.</p></body>')
  return [
    ...files,
    { path: 'assets/files/report.pdf', type: 'application/pdf', data: RICH_PDF, url: 'https://harbortimes.example/report.pdf' },
    { path: 'assets/files/bundle.zip', type: 'application/zip', data: RICH_ZIP, url: 'https://harbortimes.example/bundle.zip' },
    { path: 'assets/files/data.json', type: 'application/json', data: '{"items":[1,2,3],"ok":true,"name":"harbor"}', url: 'https://harbortimes.example/data.json' },
    { path: 'assets/images/mark.svg', type: 'image/svg+xml', data: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="teal"/></svg>', url: 'https://harbortimes.example/mark.svg' },
    { path: 'assets/files/setup.exe', type: 'application/octet-stream', data: Buffer.from('MZ not a program'), url: 'https://harbortimes.example/setup.exe' },
    { path: 'assets/media/clip.mp4', type: 'video/mp4', data: Buffer.alloc(2048, 1), url: 'https://harbortimes.example/clip.mp4' },
  ]
}
export const writeRichWsnp = (path: string, options: WsnpOptions = {}) => writeWsnp(path, richFiles(), options)

export const writeSampleWsnp = (path: string, options: WsnpOptions = {}) => writeWsnp(path, sampleFiles(), options)

// ---------------------------------------------------------------- a page that tries to reach the network

/**
 * A page whose script tries every way it knows to contact `origin` (a server the test counts hits
 * on). A viewer that keeps the snapshot closed sees no hit at all.
 */
export function networkProbeFiles(origin: string): FixtureFile[] {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Probe</title>
<link rel="stylesheet" href="${origin}/static.css">
<style>@import url(${origin}/import.css);body{background:url(${origin}/bg.png)}</style></head><body>
<img src="${origin}/static.png"><img srcset="${origin}/set.png 1x">
<iframe src="${origin}/frame.html"></iframe>
<video poster="${origin}/poster.png"></video>
<a id="ext" href="https://example.com/clicked">external</a>
<script src="${origin}/static.js"></script>
<script src="_wsnp/offline.js"></script></body></html>`
  const js = `document.documentElement.dataset.probe = 'ran';
const o = ${JSON.stringify(origin)};
const attempts = [];
const attempt = (name, fn) => { try { const r = fn(); if (r && r.catch) r.catch(() => {}); } catch (e) { attempts.push(name + ': ' + e.name); } };
attempt('fetch', () => fetch(o + '/fetch'));
attempt('xhr', () => { const x = new XMLHttpRequest(); x.open('GET', o + '/xhr'); x.send(); });
attempt('image', () => { new Image().src = o + '/image.png'; });
attempt('beacon', () => navigator.sendBeacon(o + '/beacon', 'x'));
attempt('websocket', () => new WebSocket(o.replace('http', 'ws') + '/ws'));
attempt('script', () => { const s = document.createElement('script'); s.src = o + '/dynamic.js'; document.head.append(s); });
attempt('link', () => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = o + '/dynamic.css'; document.head.append(l); });
attempt('form', () => { const f = document.createElement('form'); f.action = o + '/form'; f.method = 'post'; document.body.append(f); f.submit(); });
attempt('open', () => window.open(o + '/open'));
document.documentElement.dataset.attempts = JSON.stringify(attempts);`
  return [generated('index.html', 'text/html', html), generated('_wsnp/offline.js', 'text/javascript', js)]
}

// ---------------------------------------------------------------- a tall page

/** A page of `blocks` blocks 500 px high, each its own colour, with a fixed header on top. */
export const BLOCK_HEIGHT = 500
export const blockColor = (i: number): string => `hsl(${(i * 47) % 360}, 70%, 45%)`

export function tallPageFiles(blocks: number): FixtureFile[] {
  const rows = Array.from({ length: blocks }, (_, i) => `<div class="b" style="background:${blockColor(i)}">Block ${i + 1}</div>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tall page</title><style>
body{margin:0}.b{height:${BLOCK_HEIGHT}px;color:#fff;font:32px sans-serif;box-sizing:border-box;padding:16px}
#bar{position:fixed;top:0;left:0;right:0;height:40px;background:#000;color:#fff;font:16px sans-serif}
</style></head><body><div id="bar">fixed header</div>${rows}</body></html>`
  return [generated('index.html', 'text/html', html)]
}

// ---------------------------------------------------------------- a page for printing

export function printPageFiles(paragraphs: number): FixtureFile[] {
  const text = Array.from({ length: paragraphs }, (_, i) => `<p>Paragraph ${i + 1}. ${'Lorem ipsum dolor sit amet. '.repeat(18)}</p>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Print page</title><style>
.print-hidden{display:block}@media print{.print-hidden{display:none}}
.screen-hidden{display:none}@media print{.screen-hidden{display:block}}
</style></head><body><h1>Print test</h1>
<p class="print-hidden">visible on screen only</p><p class="screen-hidden">visible in print only</p>${text}</body></html>`
  return [generated('index.html', 'text/html', html)]
}

// ---------------------------------------------------------------- a big file

const BIG_CHUNK = 1 << 20
const bigBase = crypto.createHash('sha256').update('wsnp-big').digest()

/** The 1 MiB chunk number `i` of the big file: cheap to make, different for every `i`. */
export function bigChunk(i: number): Buffer {
  const chunk = Buffer.alloc(BIG_CHUNK)
  for (let at = 0; at < BIG_CHUNK; at += bigBase.length) bigBase.copy(chunk, at)
  chunk.writeUInt32LE(i, 0)
  return chunk
}

/** A .wsnp with a stored `assets/media/big.bin` of `megabytes` MiB (and a DEFLATE text file), streamed to disk. */
export async function writeBigWsnp(path: string, megabytes: number): Promise<{ bigBytes: number; bigSha256: string }> {
  const hash = crypto.createHash('sha256')
  for (let i = 0; i < megabytes; i++) hash.update(bigChunk(i))
  const bigSha256 = hash.digest('hex')
  const bigBytes = megabytes * BIG_CHUNK
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Big</title></head><body><p id="p">A page next to a very big file.</p></body></html>'
  const text = Buffer.from('all work and no play makes jack a dull boy\n'.repeat(400_000)) // ~17 MB, compresses well
  const small: FixtureFile[] = [generated('index.html', 'text/html', html), { path: 'assets/files/log.txt', type: 'text/plain', data: text, compress: true }]
  const manifest = manifestFor(small, { title: 'Big' }) as { files: Record<string, unknown>[] }
  manifest.files.push({ path: 'assets/media/big.bin', media_type: 'application/octet-stream', bytes: bigBytes, sha256: bigSha256, source: 'page' })
  const entries: WriteEntry[] = [
    { name: 'mimetype', data: WSNP_TYPE },
    { name: 'manifest.json', data: JSON.stringify(manifest), compress: true },
    ...small.map((f) => ({ name: f.path, data: bytesOf(f.data), compress: f.compress ?? true })),
    {
      name: 'assets/media/big.bin',
      size: bigBytes,
      data: Readable.from((function* () {
        for (let i = 0; i < megabytes; i++) yield bigChunk(i)
      })()),
    },
  ]
  await writeZip(path, entries)
  return { bigBytes, bigSha256 }
}

// ---------------------------------------------------------------- a PageKeep ZIP

export interface PageKeepZipOptions {
  /** Early files ("Page Snapshot 1.0.0") have no `type` in `resources`. */
  old?: boolean
}

/** A plain ZIP as PageKeep writes it: flat `assets/`, one inline script, `snapshot.json`. */
export async function writePageKeepZip(path: string, options: PageKeepZipOptions = {}): Promise<void> {
  const html = `<!DOCTYPE html>
<!-- Saved by PageKeep from https://harbortimes.example/news on 2026-09-25T17:42:40.614Z -->
<html lang="en"><head><meta charset="utf-8"><title>Harbor news</title>
<meta name="description" content="News from the harbor.">
<link rel="canonical" href="https://harbortimes.example/news">
<link rel="stylesheet" href="assets/site-1x05wni.css">
<style>.hero{background:url(assets/logo-1qg48nw.png)}</style></head><body>
<h2 id="item">Item 1</h2><button id="next" type="button">Next</button>
<img id="logo" src="assets/logo-1qg48nw.png" srcset="assets/logo-1qg48nw.png 1x, assets/logo-1qg48nw.png 2x" alt="">
<a id="dl" href="assets/notes-9zz9zz.pdf" download>notes</a>
<a id="ext" href="https://example.com/more">more</a>
<script type="application/json" id="snap-pagers">{}</script>
<script>document.documentElement.dataset.offline = 'ready';
let i = 1; document.getElementById('next').onclick = () => { i++; document.getElementById('item').textContent = 'Item ' + i; };</script>
</body></html>`
  const css = `@import url(base-2b7c.css);h2{color:rgb(0,128,128)}@font-face{font-family:F;src:url("font-2ab.woff2") format("woff2")}body{font-family:F,sans-serif}`
  const resource = (url: string, file: string, bytes: number, source: string, type: string) => ({ url, file: `assets/${file}`, bytes, source, ...(options.old ? {} : { type }) })
  const files: [string, Buffer, string, string, string][] = [
    ['site-1x05wni.css', Buffer.from(css), 'https://harbortimes.example/site.css', 'network', 'text/css'],
    ['base-2b7c.css', Buffer.from('p{margin:0}'), 'https://harbortimes.example/base.css', 'page', 'text/css'],
    ['font-2ab.woff2', Buffer.from('wOF2-not-a-real-font'), 'https://harbortimes.example/font.woff2', 'page', 'font/woff2'],
    ['logo-1qg48nw.png', PNG_1X1, 'https://harbortimes.example/logo.png', 'page', 'image/png'],
    ['notes-9zz9zz.pdf', Buffer.from('%PDF-1.4 not a real pdf'), 'https://harbortimes.example/notes.pdf', 'network', 'application/pdf'],
  ]
  const snapshot = {
    source_url: 'https://harbortimes.example/news',
    title: 'Harbor news',
    captured_at: '2026-09-25T17:42:40.614Z',
    tool: options.old ? 'Page Snapshot 1.0.0' : 'PageKeep 1.5.0',
    debugger: 'used',
    editors: {},
    carousels: {},
    resources: files.map(([file, data, url, source, type]) => resource(url, file, data.length, source, type)),
    failed: [{ url: 'https://harbortimes.example/gone.png', reason: 'HTTP 404' }],
  }
  await writeZip(path, [
    { name: 'index.html', data: html, compress: true },
    ...files.map(([file, data]) => ({ name: `assets/${file}`, data, compress: /\.css$/.test(file) })),
    { name: 'snapshot.json', data: JSON.stringify(snapshot, null, 2), compress: true },
  ])
}

// ---------------------------------------------------------------- files for the viewers (pictures and PDFs)

/** A solid-colour PNG of the given size (real decoders open it), for tests that measure a picture. */
export function makePng(width: number, height: number, rgb: [number, number, number] = [0, 128, 128]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(zlib.crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8 bits, RGB, no interlace
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export const LONG_PDF = makePdf(Array.from({ length: 12 }, (_, i) => ({ lines: ['Harbor handbook', `Chapter ${i + 1}`] })))
export const BROKEN_PDF = Buffer.from('%PDF-1.4\nthis is not a PDF at all, only the start of one\n')

export function viewerFiles(): FixtureFile[] {
  return [
    ...richFiles(),
    { path: 'assets/images/photo.png', type: 'image/png', data: makePng(320, 160), url: 'https://harbortimes.example/photo.png' },
    { path: 'assets/images/tiny.png', type: 'image/png', data: makePng(8, 4, [200, 0, 0]), url: 'https://harbortimes.example/tiny.png' },
    { path: 'assets/files/handbook.pdf', type: 'application/pdf', data: LONG_PDF, url: 'https://harbortimes.example/handbook.pdf' },
    // Source for the text viewer: minified as a saved page has it, one very long line, Markdown and YAML served as plain text.
    { path: 'assets/styles/min.css', type: 'text/css', data: 'body{margin:0;font:14px/1.4 sans-serif}.card{display:flex;gap:8px}.card>h2{color:#0a7}@media (min-width:600px){.card{gap:16px}}' },
    { path: 'assets/files/min.js', type: 'text/javascript', data: 'function add(a,b){return a+b}const items=[1,2,3].map(function(x){return add(x,1)});if(items.length>2){console.log("ok")}' },
    { path: 'assets/files/min.json', type: 'application/json', data: '{"name":"harbor","big":12345678901234567890,"items":[{"id":1,"tags":["a","b"]},{"id":2,"tags":[]}],"nested":{"deep":{"ok":true}}}' },
    { path: 'assets/files/page.html', type: 'text/html', data: '<!doctype html><html><head><title>t</title><style>p{color:red}</style></head><body><div><p>one</p><p>two <b>bold</b></p><ul><li>a</li><li>b</li></ul></div><script>var x=1;function f(){return x}</script></body></html>' },
    { path: 'assets/files/long.txt', type: 'text/plain', data: `${'all work and no play makes jack a dull boy '.repeat(60)}THE END\nsecond line\n` },
    { path: 'assets/files/notes.md', type: 'text/plain', data: '# Notes\n\n* one\n* two\n\n```js\nconst a = 1\n```\n' },
    { path: 'assets/files/config.yml', type: 'application/octet-stream', data: 'name: harbor\nitems:\n  - id: 1\n  - id: 2\n' },
    { path: 'assets/files/broken.pdf', type: 'application/pdf', data: BROKEN_PDF, url: 'https://harbortimes.example/broken.pdf' },
  ]
}
export const writeViewerWsnp = (path: string, options: WsnpOptions = {}) => writeWsnp(path, viewerFiles(), options)
