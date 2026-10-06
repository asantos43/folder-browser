import fs from 'node:fs/promises'
import path from 'node:path'
import { UI_SCHEME } from './snapshot-view.ts'

/** The interface is one origin: nothing else is ever loaded into the window. */
export const UI_ORIGIN = `${UI_SCHEME}://host`

/**
 * The interface's own policy. Snapshots are embedded as frames, and a click on a web link inside one is a navigation of
 * that frame, so `frame-src` has to allow web addresses: if it did not, the frame would turn into an error page and
 * `will-frame-navigate` would never fire (docs/ARCHITECTURE.md, "Phase 1 spike results").
 */
export const UI_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src fb-media:; font-src 'self' blob: data:; connect-src 'self'; frame-src wsnp: fb-doc: https: http:"

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}

/** The file of the built interface that a request path names, or null when it would leave the folder. */
export function resolveUiFile(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const relative = decoded.replace(/^\/+/, '') || 'index.html'
  const file = path.resolve(root, relative)
  return file === root || file.startsWith(root + path.sep) ? file : null
}

/** Answers a request for the interface out of the folder `root` (the Vite build output). */
export async function serveUi(root: string, requestUrl: string): Promise<Response> {
  const url = new URL(requestUrl)
  const file = url.hostname === 'host' ? resolveUiFile(root, url.pathname) : null
  if (!file) return new Response(null, { status: 403 })
  try {
    const body = await fs.readFile(file)
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    return new Response(new Uint8Array(body), {
      headers: { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(type.startsWith('text/html') ? { 'content-security-policy': UI_CSP } : {}) },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
