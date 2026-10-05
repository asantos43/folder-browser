/** The pages the viewer prints for a file that is not a web page: a text, or a picture. Static HTML under a policy that allows nothing else. */
export const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`
const HEAD = (title: string) => `<!doctype html><html><head><meta charset="utf-8">${POLICY}<title>${escapeHtml(title)}</title>`

/** A text as it is shown on screen (laid out or as saved): monospace, long lines wrapped, the file's name on top. */
export function textDocument(title: string, text: string): string {
  return `${HEAD(title)}<style>@page{margin:15mm}body{margin:0;color:#000;background:#fff}h1{font:600 10pt sans-serif;margin:0 0 6pt;padding-bottom:4pt;border-bottom:1px solid #999}pre{margin:0;font:9pt/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4}</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(text)}</pre></body></html>`
}

/** A picture at the width of the page, never larger than its own size scaled up. */
export function imageDocument(title: string, mediaType: string, bytes: Uint8Array): string {
  const src = `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`
  return `${HEAD(title)}<style>@page{margin:15mm}body{margin:0}h1{font:600 10pt sans-serif;margin:0 0 6pt}img{display:block;max-width:100%;max-height:250mm;margin:0 auto}</style></head><body><h1>${escapeHtml(title)}</h1><img alt="" src="${src}"></body></html>`
}
