import fs from 'node:fs/promises'
import path from 'node:path'
import { DOC_ASSETS, DOC_CSP, docPage, type DocFiles } from '../core/docs.ts'

/**
 * Answers a request for the page of a document, out of what `fb-doc://<token>/` was given a token for: the page itself, the file (`/_file`) and the one script of its library
 * (`/_v/<flavour>.js`, from the folder `scripts` that the build made). Anything else is not there. The page carries the policy that cuts it off from everything (core/docs.ts).
 */
export async function serveDoc(docs: DocFiles, scripts: string, requestUrl: string): Promise<Response> {
  const url = new URL(requestUrl)
  const doc = docs.get(url.hostname)
  if (!doc) return new Response(null, { status: 404 })
  // The page is an opaque origin (it is sandboxed), so its own fetches are cross-origin ones: they are allowed to read what this answers.
  const base = { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  if (url.pathname === '/') return new Response(docPage(doc.flavour, doc.name), { headers: { ...base, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': DOC_CSP } })
  if (url.pathname === '/_file') return new Response(new Uint8Array(doc.bytes), { headers: { ...base, 'content-type': 'application/octet-stream' } })
  const script = /^\/_v\/([a-z]+\.js)$/.exec(url.pathname)?.[1]
  if (script && DOC_ASSETS[doc.flavour].includes(script)) {
    try {
      return new Response(new Uint8Array(await fs.readFile(path.join(scripts, script))), { headers: { ...base, 'content-type': 'text/javascript; charset=utf-8' } })
    } catch {
      return new Response(null, { status: 404 })
    }
  }
  return new Response(null, { status: 404 })
}
