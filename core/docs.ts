import crypto from 'node:crypto'
import { effectiveType, isDocumentType } from './filekind.ts'

/**
 * Which library draws a document: `docx` (docx-preview), `pptx` (pptx-renderer), or `odf` (odr-core: the OpenDocument family, and the older Word, Excel and PowerPoint files, and
 * the spreadsheets of every kind).
 */
export type DocFlavour = 'docx' | 'pptx' | 'odf'

/** The library that draws a document, or null for a file that is not one. */
export function documentFlavour(mediaType: string | undefined, name: string): DocFlavour | null {
  const type = effectiveType(mediaType, name)
  if (!isDocumentType(type)) return null
  // `.doc` and `.ppt` (the older binary formats) and every spreadsheet go to the library that reads them all.
  if (/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.|^application\/vnd\.ms-word\.[a-z0-9.]*macroenabled/.test(type)) return 'docx'
  if (/^application\/vnd\.openxmlformats-officedocument\.presentationml\.|^application\/vnd\.ms-powerpoint\.[a-z0-9.]*macroenabled/.test(type)) return 'pptx'
  return 'odf'
}

/** The files a document's page may load from its own address: its script (the OpenDocument one has its WebAssembly inside). */
export const DOC_ASSETS: Record<DocFlavour, string[]> = { docx: ['docx.js'], pptx: ['pptx.js'], odf: ['odf.js'] }

/**
 * The policy of a document's page (`data:` for the WebAssembly the OpenDocument library carries inside its script: it cannot reach anywhere): its own scripts (and the inline ones of what the OpenDocument library renders), images and fonts that are in the file, and nothing
 * from the network. `sandbox` makes it an opaque origin even when the page is opened on its own.
 */
export const DOC_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'self' data:; frame-src about: data: blob:"

/** The page that draws a document: it fetches the file from its own address (`/_file`) and tells the interface how it went (`postMessage`). */
export function docPage(flavour: DocFlavour, name: string): string {
  const escaped = name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="doc-name" content="${escaped}"><title>Document</title>
<style>html,body{margin:0;height:100%}body{background:#525659;font-family:system-ui,sans-serif}#root{min-height:100%}</style></head>
<body><div id="root"></div><script src="/_v/${flavour}.js"></script></body></html>
`
}

/** What the page of a document tells the interface that holds it (`postMessage`): it drew the document (with how many views it has: sheets, slides), or could not. */
export type DocReport = { type: 'ready'; views: number } | { type: 'error'; message: string }
export type DocMessage = DocReport & { fbDoc: true }

export interface DocFile {
  bytes: Uint8Array
  name: string
  flavour: DocFlavour
}

/** The documents being drawn, by an unguessable token: `fb-doc://<token>/` is the address of one's page, and nothing else is served. Like the media's, a token lives as long as its tab. */
export class DocFiles {
  private readonly open = new Map<string, DocFile>()

  add(file: DocFile): string {
    const token = `d${crypto.randomBytes(12).toString('hex')}`
    this.open.set(token, file)
    return token
  }
  get(token: string): DocFile | undefined {
    return this.open.get(token)
  }
  has(token: string): boolean {
    return this.open.has(token)
  }
  release(token: string): void {
    this.open.delete(token)
  }
  releaseAll(): void {
    this.open.clear()
  }
}
