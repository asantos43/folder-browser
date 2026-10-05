// The PageKeep ZIP → .wsnp conversion (docs/PAGEKEEP-ZIP.md), written from what the phase 0 prototype taught.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5'
import { ArchiveError, openArchive } from '../archive/reader.ts'
import { writeZip, type WriteEntry } from '../archive/writer.ts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

export const WSNP_TYPE = 'application/vnd.wsnp+zip'

/** Why a ZIP could not be converted, as a stable code; the words are the interface's. */
export class ConvertError extends Error {
  readonly code: 'not-pagekeep' | 'no-source-url' | 'unreadable' | 'too-large'
  constructor(code: ConvertError['code'], message: string) {
    super(message)
    this.name = 'ConvertError'
    this.code = code
  }
}

/** Bigger than this, a page or a stylesheet is not converted in memory. */
const TEXT_LIMIT = 64 * 2 ** 20

/**
 * Whether a file is a ZIP saved by PageKeep (docs/PAGEKEEP-ZIP.md section 2): `index.html` and `snapshot.json`, and no `mimetype`.
 * False for anything else, a damaged or ZIP64 file included: those go through the ordinary `.wsnp` checks, which say why.
 */
export async function isPageKeepZip(zipPath: string): Promise<boolean> {
  try {
    // A .wsnp starts with its stored `mimetype` entry: no need to read the directory of a large one to know it is not a PageKeep ZIP.
    const head = Buffer.alloc(38)
    const handle = await fs.open(zipPath, 'r')
    try {
      await handle.read(head, 0, 38, 0)
    } finally {
      await handle.close()
    }
    if (head.subarray(30).toString() === 'mimetype') return false
    const zip = await openArchive(zipPath)
    try {
      return !zip.get('mimetype') && Boolean(zip.get('index.html')) && Boolean(zip.get('snapshot.json'))
    } finally {
      await zip.close()
    }
  } catch (err) {
    if (err instanceof ArchiveError) return false
    throw err
  }
}

const TYPES: Record<string, string> = {
  css: 'text/css', js: 'text/javascript', html: 'text/html', json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', vtt: 'text/vtt', pdf: 'application/pdf', txt: 'text/plain',
}
const typeByName = (name: string) => TYPES[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''] ?? 'application/octet-stream'

function folderFor(type: string, forcedFile: boolean): string {
  if (forcedFile) return 'files'
  if (type === 'text/css') return 'styles'
  if (type.startsWith('image/')) return 'images'
  if (type.startsWith('font/') || type === 'application/vnd.ms-fontobject') return 'fonts'
  if (type.startsWith('audio/') || type.startsWith('video/') || type === 'text/vtt') return 'media'
  return 'files'
}

const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex')

interface Resource {
  url?: string
  file?: string
  source?: string
  type?: string
}

export interface ConvertOptions {
  generator: { name: string; version: string }
  /** A JPEG for `_wsnp/preview.jpg`. */
  preview?: Buffer
}

export interface ConvertReport {
  manifest: Record<string, unknown>
  warnings: string[]
  stats: Record<string, number>
}

const elementsOf = (node: Node | ReturnType<typeof parse>): Element[] => {
  const found: Element[] = []
  const visit = (n: Node) => {
    if ('tagName' in n) found.push(n)
    const kids: Node[] = 'content' in n ? [...n.childNodes, ...n.content.childNodes] : 'childNodes' in n ? n.childNodes : []
    for (const kid of kids) visit(kid)
  }
  visit(node as Node)
  return found
}
const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name)?.value
const setAttr = (el: Element, name: string, value: string) => {
  const existing = el.attrs.find((a) => a.name === name)
  if (existing) existing.value = value
  else el.attrs.push({ name, value })
}
const dropAttr = (el: Element, name: string) => {
  el.attrs = el.attrs.filter((a) => a.name !== name)
}
const textOf = (el: Element) => el.childNodes.map((c) => ('value' in c ? c.value : '')).join('')
const remote = /^\s*(https?:)?\/\//i

/** Converts a ZIP saved by PageKeep into a .wsnp file at `outPath`. */
export async function convertPageKeepZip(zipPath: string, outPath: string, options: ConvertOptions): Promise<ConvertReport> {
  const warnings: string[] = []
  const stats: Record<string, number> = { assets: 0, inlineScriptsMoved: 0, handlersRemoved: 0, networkRefsRemoved: 0, cssNetworkRefs: 0, missingRefs: 0 }
  const zip = await openArchive(zipPath)
  try {
    if (zip.get('mimetype') || !zip.get('index.html') || !zip.get('snapshot.json')) throw new ConvertError('not-pagekeep', 'This is not a PageKeep ZIP: it needs index.html and snapshot.json, and no mimetype.')
    if (zip.get('snapshot.json')!.size > TEXT_LIMIT || zip.get('index.html')!.size > TEXT_LIMIT) throw new ConvertError('too-large', 'The page of this ZIP is too large to convert.')
    let snapshot: Record<string, unknown> & { resources?: Resource[]; failed?: { url: string; reason: string }[] }
    try {
      snapshot = JSON.parse((await zip.read('snapshot.json')).toString('utf8'))
    } catch {
      throw new ConvertError('unreadable', 'snapshot.json cannot be read.')
    }
    if (!snapshot || typeof snapshot.source_url !== 'string') throw new ConvertError('no-source-url', 'snapshot.json has no source_url.')
    const resources = new Map((snapshot.resources ?? []).map((r) => [r.file ?? '', r]))

    // ---- the page: find what it links to for download, and read it
    const html = (await zip.read('index.html')).toString('utf8')
    const document = parse(html)
    const downloads = new Set<string>()
    for (const el of elementsOf(document)) {
      if (el.tagName === 'a') {
        const href = attr(el, 'href')
        if (href?.startsWith('assets/')) downloads.add(href.split(/[?#]/)[0])
      }
    }

    // ---- assets: a new place for each, and the map old path → new path
    const used = new Set<string>()
    const moved = new Map<string, string>()
    for (const entry of zip.entries.filter((e) => e.name.startsWith('assets/'))) {
      const resource = resources.get(entry.name)
      const base = entry.name.slice('assets/'.length).replace(/\//g, '_').replace(/[^A-Za-z0-9._-]/g, '_')
      const type = resource?.type || typeByName(base)
      const folder = folderFor(type, downloads.has(entry.name))
      let name = base
      for (let n = 2; used.has(`${folder}/${name}`.toLowerCase()); n++) name = base.replace(/(\.[^./]*)?$/, (ext) => `-${n}${ext}`)
      used.add(`${folder}/${name}`.toLowerCase())
      moved.set(entry.name, `assets/${folder}/${name}`)
      stats.assets++
    }
    const rewrite = (text: string): string =>
      text.replace(/assets\/[^\s"'()<>,;]+/g, (found) => {
        const [file, suffix = ''] = found.split(/([?#].*)$/)
        const target = moved.get(decodeURI(file))
        if (!target) {
          stats.missingRefs++
          return found
        }
        return target + suffix
      })

    // ---- the HTML: references, scripts, handlers, network
    const scripts = new Map<string, string>() // script text → path in the archive
    const processDocument = (doc: ReturnType<typeof parse>): void => {
      for (const el of elementsOf(doc)) {
        const tag = el.tagName
        if (tag === 'script') {
          const type = (attr(el, 'type') ?? '').toLowerCase()
          if (/json/.test(type)) continue
          const src = attr(el, 'src')
          if (src !== undefined) {
            stats.networkRefsRemoved++
            warnings.push(`script with src "${src.slice(0, 60)}" removed`)
            el.childNodes = []
            dropAttr(el, 'src')
            setAttr(el, 'type', 'application/json')
            continue
          }
          const code = textOf(el)
          if (!scripts.has(code)) scripts.set(code, `_wsnp/offline${scripts.size ? `-${scripts.size + 1}` : ''}.js`)
          el.childNodes = []
          setAttr(el, 'src', scripts.get(code) as string)
          stats.inlineScriptsMoved++
          continue
        }
        if (tag === 'style') {
          for (const child of el.childNodes) if ('value' in child) child.value = rewrite(child.value)
        }
        for (const a of [...el.attrs]) {
          if (/^on/i.test(a.name)) {
            dropAttr(el, a.name)
            stats.handlersRemoved++
          } else if (a.name === 'ping') {
            dropAttr(el, a.name)
          } else if (a.name === 'srcdoc') {
            const inner = parse(a.value)
            processDocument(inner)
            a.value = serialize(inner)
          } else if (a.value.includes('assets/')) {
            a.value = rewrite(a.value)
          }
        }
        // A reference that would load from the network is removed (links keep their address).
        const loads = ['img', 'source', 'video', 'audio', 'track', 'embed', 'iframe', 'input'].includes(tag)
        const rel = (attr(el, 'rel') ?? '').toLowerCase()
        const linkLoads = tag === 'link' && /stylesheet|icon|preload|prefetch|modulepreload|manifest/.test(rel)
        for (const name of loads ? ['src', 'poster', 'data'] : linkLoads ? ['href'] : tag === 'video' ? ['poster'] : []) {
          const value = attr(el, name)
          if (value && remote.test(value)) {
            dropAttr(el, name)
            stats.networkRefsRemoved++
            warnings.push(`<${tag} ${name}> to the network removed`)
          }
        }
        const srcset = attr(el, 'srcset')
        if (srcset && /(^|\s|,)(https?:)?\/\//i.test(srcset)) {
          dropAttr(el, 'srcset')
          stats.networkRefsRemoved++
          warnings.push(`<${tag} srcset> to the network removed`)
        }
      }
    }
    processDocument(document)
    const outHtml = serialize(document)

    // ---- what the page says about itself
    const head = elementsOf(document)
    const meta = (key: string, value: string) => head.find((e) => e.tagName === 'meta' && attr(e, key) === value)
    const pageTitle = textOf(head.find((e) => e.tagName === 'title') ?? ({ childNodes: [] } as unknown as Element)).trim()
    const description = attr(meta('name', 'description') ?? ({ attrs: [] } as unknown as Element), 'content') ?? attr(meta('property', 'og:description') ?? ({ attrs: [] } as unknown as Element), 'content') ?? ''
    const canonical = attr(head.find((e) => e.tagName === 'link' && attr(e, 'rel') === 'canonical') ?? ({ attrs: [] } as unknown as Element), 'href') ?? ''
    const language = attr(head.find((e) => e.tagName === 'html') ?? ({ attrs: [] } as unknown as Element), 'lang') ?? ''
    const title = (typeof snapshot.title === 'string' && snapshot.title) || pageTitle || snapshot.source_url

    // ---- the files
    const files: { path: string; data: Buffer; type: string; source: string; url?: string; compress: boolean }[] = [
      { path: 'index.html', data: Buffer.from(outHtml), type: 'text/html', source: 'generated', compress: true },
    ]
    for (const entry of zip.entries.filter((e) => e.name.startsWith('assets/'))) {
      const target = moved.get(entry.name) as string
      const resource = resources.get(entry.name)
      const type = resource?.type || typeByName(target)
      if (type === 'text/css' && entry.size > TEXT_LIMIT) throw new ConvertError('too-large', `${entry.name} is too large to convert.`)
      let data = await zip.read(entry.name)
      if (type === 'text/css') {
        const dir = path.posix.dirname(target)
        const relink = (ref: string): string | null => {
          if (/^(data:|#)/i.test(ref)) return ref
          if (remote.test(ref)) return null
          const [file, suffix = ''] = ref.split(/([?#].*)$/)
          const key = `assets/${decodeURI(file).replace(/^\.\//, '').replace(/^assets\//, '')}`
          const to = moved.get(key)
          if (!to) {
            stats.missingRefs++
            return ref
          }
          return path.posix.relative(dir, to) + suffix
        }
        const css = data
          .toString('utf8')
          .replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (_whole, q: string, ref: string) => {
            const to = relink(ref)
            if (to === null) {
              stats.cssNetworkRefs++
              return 'url(data:,)'
            }
            return `url(${q}${to}${q})`
          })
          .replace(/@import\s+(['"])([^'"]+)\1/g, (_whole, q: string, ref: string) => {
            const to = relink(ref)
            if (to === null) {
              stats.cssNetworkRefs++
              return '@import "data:text/css,"'
            }
            return `@import ${q}${to}${q}`
          })
        data = Buffer.from(css)
      }
      const source = resource?.source ?? 'page'
      files.push({ path: target, data, type, source, ...(source === 'picture' || !resource?.url ? {} : { url: resource.url }), compress: /^(text\/|image\/svg|application\/json)/.test(type) })
    }
    for (const [code, name] of scripts) files.push({ path: name, data: Buffer.from(code), type: 'text/javascript', source: 'generated', compress: true })
    if (options.preview) files.push({ path: '_wsnp/preview.jpg', data: options.preview, type: 'image/jpeg', source: 'generated', compress: false })

    const source = { url: snapshot.source_url, canonical, language }
    const manifest = {
      format: 'wsnp',
      format_version: '1.0',
      generator: options.generator,
      created: typeof snapshot.captured_at === 'string' ? snapshot.captured_at : new Date().toISOString(),
      title,
      description,
      source,
      pages: [{ entry: 'index.html', title, description, source }],
      ...(options.preview ? { preview: '_wsnp/preview.jpg' } : {}),
      viewport: { width: 1280, height: 800, device_pixel_ratio: 1 }, // not recorded by the ZIP
      capture: { load_whole_page: false }, // not recorded by the ZIP
      converted_from: { format: 'zip', tool: typeof snapshot.tool === 'string' ? snapshot.tool : 'unknown' },
      files: files.map((f) => ({ path: f.path, ...(f.url ? { original_url: f.url } : {}), media_type: f.type, bytes: f.data.length, sha256: sha256(f.data), source: f.source })),
      failed: (snapshot.failed ?? []).map(({ url, reason }) => ({ url, reason })),
    }
    const entries: WriteEntry[] = [
      { name: 'mimetype', data: WSNP_TYPE },
      { name: 'manifest.json', data: JSON.stringify(manifest, null, 2), compress: true },
      ...files.map((f) => ({ name: f.path, data: f.data, compress: f.compress })),
    ]
    await writeZip(outPath, entries)
    stats.htmlBytesIn = html.length
    stats.htmlBytesOut = outHtml.length
    stats.offlineScripts = scripts.size
    return { manifest, warnings, stats }
  } finally {
    await zip.close()
  }
}
