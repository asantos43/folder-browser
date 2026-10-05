import type { Readable } from 'node:stream'
import type { Archive } from './archive/reader.ts'

/** The Content Security Policy of FORMAT.md section 10: nothing but the snapshot itself. */
export const SNAPSHOT_CSP = "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline' data:"

const EXTENSION_TYPES: Record<string, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  pdf: 'application/pdf',
}

export interface ServeOptions {
  /** `media_type` of each file, from the manifest (path → type). */
  types?: ReadonlyMap<string, string>
  /** The page served for `/` (default `index.html`). */
  entry?: string
  /** The policy to send; an empty string sends none (only to test the layers below the policy). */
  csp?: string
  /**
   * Adds the `sandbox allow-scripts` CSP directive, which gives the document an opaque origin
   * (the same as an iframe without `allow-same-origin`).
   */
  sandbox?: boolean
}

export interface ServeResult {
  status: number
  headers: Record<string, string>
  body: Readable | Buffer | null
}

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` for a file of `size` bytes: [start, end) or null when unsatisfiable. */
export function parseRange(header: string, size: number): { start: number; end: number } | null | 'ignore' {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return 'ignore' // not a single byte range: answer with the whole file
  const [, first, last] = match
  if (first === '' && last === '') return 'ignore'
  let start: number
  let end: number
  if (first === '') {
    const suffix = Number(last)
    if (suffix === 0) return null
    start = Math.max(0, size - suffix)
    end = size
  } else {
    start = Number(first)
    end = last === '' ? size : Math.min(size, Number(last) + 1)
  }
  return start >= size || start >= end ? null : { start, end }
}

function typeOf(name: string, options: ServeOptions): string {
  const declared = options.types?.get(name)
  if (declared) return declared
  return EXTENSION_TYPES[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

/**
 * Answers a request for a file of the snapshot, whatever the shell that asks (Electron's
 * protocol handler, a test). `urlPath` is the path of the request URL.
 */
export async function serveEntry(
  archive: Archive,
  urlPath: string,
  requestHeaders: { range?: string | null } = {},
  options: ServeOptions = {},
): Promise<ServeResult> {
  let name: string
  try {
    name = decodeURIComponent(urlPath).replace(/^\/+/, '') || options.entry || 'index.html'
  } catch {
    return { status: 400, headers: {}, body: null }
  }
  // `mimetype` only identifies the file; the page has no business reading it.
  if (name === 'mimetype' || !archive.get(name)) return { status: 404, headers: { 'cache-control': 'no-store' }, body: null }
  const entry = archive.get(name)!

  const csp = options.csp === '' ? '' : `${options.sandbox ? 'sandbox allow-scripts; ' : ''}${options.csp ?? SNAPSHOT_CSP}`
  const headers: Record<string, string> = {
    'content-type': typeOf(name, options),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    ...(csp ? { 'content-security-policy': csp } : {}),
    // A sandboxed document has an opaque origin, so its fonts and modules are cross-origin requests.
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }

  const wanted = requestHeaders.range ? parseRange(requestHeaders.range, entry.size) : 'ignore'
  if (wanted === null) {
    return { status: 416, headers: { ...headers, 'content-range': `bytes */${entry.size}` }, body: null }
  }
  if (wanted === 'ignore') {
    return { status: 200, headers: { ...headers, 'content-length': String(entry.size) }, body: await archive.stream(name) }
  }
  return {
    status: 206,
    headers: {
      ...headers,
      'content-range': `bytes ${wanted.start}-${wanted.end - 1}/${entry.size}`,
      'content-length': String(wanted.end - wanted.start),
    },
    body: await archive.stream(name, wanted),
  }
}
