import { indexesOf, NONE, wrap, type FindOptions, type FindState, type SyncFindTarget } from './types.ts'

const highlights = (): { set(name: string, h: unknown): void; delete(name: string): void } | undefined => (typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: { set(name: string, h: unknown): void; delete(name: string): void } }).highlights : undefined)
const makeHighlight = (ranges: Range[]): unknown => {
  const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  return Highlight ? new Highlight(...ranges) : undefined
}

const SKIP = 'script,style,noscript,[data-find-skip],[role="toolbar"],[hidden],[aria-hidden="true"]'

/** The text nodes under `root` that are shown, in order (blank ones only with `keepBlank`: the text of a PDF page has its spaces). */
export function textNodes(root: HTMLElement, keepBlank = false): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => ((node.parentElement?.closest(SKIP) ?? null) || (!keepBlank && !node.nodeValue?.trim()) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  return nodes
}

/** A Range over characters `from` to `to` of the text of `nodes`, taken one after the other. */
export function rangeOf(nodes: Text[], from: number, to: number): Range | null {
  const range = document.createRange()
  let offset = 0
  let started = false
  for (const node of nodes) {
    const length = node.nodeValue!.length
    if (!started && from < offset + length) {
      range.setStart(node, from - offset)
      started = true
    }
    if (started && to <= offset + length) {
      range.setEnd(node, to - offset)
      return range
    }
    offset += length
  }
  return null
}

/** Shows `ranges` as the matches, `current` among them as the one Find is on, scrolled into view. */
export function paint(ranges: Range[], current: Range | undefined): void {
  const all = highlights()
  if (!all) return
  const normal = makeHighlight(ranges)
  if (normal) all.set('wsnp-find', normal)
  const now = current ? makeHighlight([current]) : undefined
  if (now) all.set('wsnp-find-current', now)
  else all.delete('wsnp-find-current')
}

export function unpaint(): void {
  highlights()?.delete('wsnp-find')
  highlights()?.delete('wsnp-find-current')
}

export function reveal(range: Range): void {
  const el = range.startContainer.parentElement
  el?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
}

/**
 * Find in a view drawn as HTML (the metadata, a ZIP's list, Settings…): the text of what is shown under `root`, matches painted with
 * the CSS Custom Highlight API and the current one scrolled to. Text that is split between two elements is found as it reads.
 */
export function createDomFindTarget(root: () => HTMLElement | null): SyncFindTarget {
  let ranges: Range[] = []
  let at = 0
  const show = (): FindState => {
    if (!ranges.length) {
      unpaint()
      return NONE
    }
    paint(ranges, ranges[at])
    reveal(ranges[at])
    return { count: ranges.length, index: at + 1 }
  }
  return {
    search(query: string, options: FindOptions) {
      const el = root()
      ranges = []
      at = 0
      if (!el || !query) {
        unpaint()
        return NONE
      }
      const nodes = textNodes(el)
      const text = nodes.map((n) => n.nodeValue).join('')
      ranges = indexesOf(text, query, options.caseSensitive, 5000)
        .map((from) => rangeOf(nodes, from, from + query.length))
        .filter((r): r is Range => r !== null)
      return show()
    },
    step(direction) {
      if (!ranges.length) return NONE
      at = wrap(at + direction, ranges.length)
      return show()
    },
    clear() {
      ranges = []
      unpaint()
    },
  }
}
