import crypto from 'node:crypto'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import type { Archive } from '../archive/reader.ts'
import type { Manifest } from '../manifest.ts'
import type { Issue } from './issues.ts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

export interface VerifyOptions {
  signal?: AbortSignal
  /** Called after every file with the bytes read so far and the total to read. */
  onProgress?: (done: number, total: number) => void
}

export interface IntegrityReport {
  /** Files whose SHA-256 and size were checked. */
  checked: number
  bytes: number
  /** Everything found wrong, in the order of the manifest. Empty when the file is intact and clean. */
  problems: Issue[]
  /** True when `signal` stopped the pass before the end. */
  aborted: boolean
}

/** Pages and stylesheets bigger than this are hashed but not scanned. */
const SCAN_LIMIT = 64 * 2 ** 20
const NETWORK_ATTRS = new Set(['src', 'poster', 'data', 'srcset', 'ping', 'action', 'formaction'])
const remote = (value: string) => /(^|\s|,)(https?:)?\/\/[^\s,]/i.test(value.trim())

/** What an HTML page must not have (FORMAT.md section 7): inline script, a script that is not the format's own, event handlers, network references. */
export function scanHtml(html: string, path: string): Issue[] {
  const issues: Issue[] = []
  const walk = (node: Node): void => {
    if ('tagName' in node) {
      const el = node as Element
      const attr = (name: string) => el.attrs.find((a) => a.name === name)?.value
      if (el.tagName === 'script') {
        const type = (attr('type') ?? '').toLowerCase()
        const src = attr('src')
        if (src === undefined) {
          // Data for the offline scripts (application/json, application/ld+json) never runs.
          if (!/^application\/(?:[a-z.+-]*\+)?json$/.test(type)) issues.push({ code: 'inline-script', path })
        } else if (!/^_wsnp\//.test(src)) issues.push({ code: 'foreign-script', path, detail: src.slice(0, 80) })
      }
      for (const a of el.attrs) {
        if (/^on[a-z]+$/.test(a.name)) issues.push({ code: 'inline-handler', path, detail: a.name })
        else if (NETWORK_ATTRS.has(a.name) && remote(a.value)) issues.push({ code: 'network-reference', path, detail: `${el.tagName} ${a.name}` })
        else if (a.name === 'srcdoc') issues.push(...scanHtml(a.value, path))
      }
      if (el.tagName === 'link' && /stylesheet|preload|prefetch|icon/i.test(attr('rel') ?? '') && remote(attr('href') ?? '')) issues.push({ code: 'network-reference', path, detail: 'link href' })
    }
    const children = 'content' in node ? (node as unknown as { content: Node }).content : node
    for (const child of 'childNodes' in children ? children.childNodes : []) walk(child)
  }
  walk(parseFragment(html))
  return issues
}

const CSS_NETWORK = /url\(\s*["']?(?:https?:)?\/\/|@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i
export const scanCss = (css: string, path: string): Issue[] => (CSS_NETWORK.test(css) ? [{ code: 'network-reference', path }] : [])

/**
 * The part of the checklist that reads every file (FORMAT.md section 10, step 7, and the "should" after it): the size and
 * SHA-256 of each file against the manifest, and pages and stylesheets for what they must not hold. Files are read one at
 * a time, so memory stays low whatever the size; `signal` stops it and `onProgress` says how far it is.
 */
export async function verifyContents(archive: Archive, manifest: Manifest, options: VerifyOptions = {}): Promise<IntegrityReport> {
  const total = manifest.files.reduce((sum, f) => sum + f.bytes, 0)
  const report: IntegrityReport = { checked: 0, bytes: 0, problems: [], aborted: false }
  for (const file of manifest.files) {
    if (options.signal?.aborted) return { ...report, aborted: true }
    const scan = /^text\/(html|css)\b/.exec(file.media_type)?.[1]
    const keep: Buffer[] = []
    const hash = crypto.createHash('sha256')
    let size = 0
    try {
      for await (const chunk of await archive.stream(file.path)) {
        const bytes = chunk as Buffer
        hash.update(bytes)
        size += bytes.length
        if (scan && file.bytes <= SCAN_LIMIT) keep.push(bytes)
      }
    } catch (err) {
      report.problems.push({ code: 'read-error', path: file.path, detail: (err as Error).message })
      continue
    }
    report.checked++
    report.bytes += size
    options.onProgress?.(report.bytes, total)
    if (size !== file.bytes) report.problems.push({ code: 'size-mismatch', path: file.path, detail: `${size} read, ${file.bytes} in the manifest` })
    if (hash.digest('hex') !== file.sha256) report.problems.push({ code: 'hash-mismatch', path: file.path })
    if (keep.length) {
      const text = Buffer.concat(keep).toString('utf8')
      report.problems.push(...(scan === 'html' ? scanHtml(text, file.path) : scanCss(text, file.path)))
    }
  }
  return report
}
