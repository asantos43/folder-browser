import type { PDFDocumentProxy } from 'pdfjs-dist'
import { paint, rangeOf, reveal, textNodes, unpaint } from './dom.ts'
import { indexesOf, NONE, wrap, type FindOptions, type FindState, type FindTarget } from './types.ts'

interface Hit {
  page: number
  /** Which match of the page this is (0 for the first). */
  nth: number
}

const MAX_HITS = 5000

/** Waits (a few frames, at most about two seconds) until a page has drawn its text layer. */
const textLayerOf = async (scroller: HTMLElement, page: number): Promise<HTMLElement | null> => {
  for (let i = 0; i < 120; i++) {
    const layer = scroller.querySelector<HTMLElement>(`[data-page="${page}"] .textLayer`)
    if (layer && layer.textContent) return layer
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  }
  return null
}

/**
 * Find in a PDF: the text of every page is read once (pdf.js, nothing of the PDF runs), so the matches are counted over the whole
 * document, even in pages that are not drawn. A step goes to the page of the match, and once the page has drawn its text layer
 * its matches are painted and the current one is scrolled to.
 */
export function createPdfFindTarget(doc: PDFDocumentProxy, scroller: () => HTMLElement | null, goTo: (page: number) => void, currentPage: () => number): FindTarget {
  let texts: Promise<string[]> | undefined
  let hits: Hit[] = []
  let at = 0
  let query = ''
  let options: FindOptions = { caseSensitive: false }
  let token = 0

  const pageTexts = (): Promise<string[]> =>
    (texts ??= (async () => {
      const all: string[] = []
      for (let n = 1; n <= doc.numPages; n++) {
        const content = await (await doc.getPage(n)).getTextContent()
        all.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''))
      }
      return all
    })())

  const show = async (): Promise<FindState> => {
    if (!hits.length) {
      unpaint()
      return NONE
    }
    const mine = ++token
    const hit = hits[at]
    goTo(hit.page)
    const el = scroller()
    const layer = el ? await textLayerOf(el, hit.page) : null
    if (mine === token && layer) {
      const nodes = textNodes(layer, true)
      const text = nodes.map((n) => n.nodeValue).join('')
      const ranges = indexesOf(text, query, options.caseSensitive)
        .map((from) => rangeOf(nodes, from, from + query.length))
        .filter((r): r is Range => r !== null)
      const now = ranges[Math.min(hit.nth, ranges.length - 1)]
      paint(ranges, now)
      if (now) reveal(now)
    }
    return { count: hits.length, index: at + 1 }
  }

  return {
    async search(text: string, next: FindOptions) {
      query = text
      options = next
      hits = []
      at = 0
      token++
      if (!text) {
        unpaint()
        return NONE
      }
      const all = await pageTexts()
      all.forEach((page, i) => {
        for (const [nth] of indexesOf(page, text, next.caseSensitive).entries()) if (hits.length < MAX_HITS) hits.push({ page: i + 1, nth })
      })
      const from = currentPage()
      at = Math.max(0, hits.findIndex((h) => h.page >= from))
      return show()
    },
    step(direction) {
      if (!hits.length) return NONE
      at = wrap(at + direction, hits.length)
      return show()
    },
    clear() {
      token++
      hits = []
      unpaint()
    },
  }
}
