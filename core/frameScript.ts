/**
 * What a snapshot's page cannot tell the interface by itself, being another process: the zoom keys and the wheel with Control held (which Chromium would
 * otherwise zoom the whole window by, or ignore), and the link the pointer is over (for the tooltip with its address). Run in each frame of a snapshot by
 * the main process after it loads, it posts messages to the interface (`parent`), which zooms the tab and shows the tooltip. A page could post the same
 * messages: all that comes of it is its own tab zooming, or a tooltip with its own words near the pointer.
 */
export const ZOOM_MESSAGE = 'wsnp-zoom'
export const LINK_MESSAGE = 'wsnp-link'
/** The longest address the interface shows (the rest of a very long one is cut off). */
export const LINK_LIMIT = 2000

export const FRAME_SCRIPT = `(() => {
  if (window.__wsnpZoom) return
  window.__wsnpZoom = true
  const send = (message) => { try { parent.postMessage(message, '*') } catch (e) {} }
  addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.deltaY) return
    e.preventDefault()
    send({ wsnp: '${ZOOM_MESSAGE}', wheel: e.deltaY })
  }, { capture: true, passive: false })
  // The address of the link under the pointer: a web address as it is, a file of the snapshot by its path, a link inside the page by its #fragment.
  const describe = (a) => {
    const href = a.href
    if (typeof href !== 'string' || !href || /^javascript:/i.test(href)) return null
    const here = location.href.split('#')[0]
    if (href.startsWith(here + '#')) return href.slice(here.length)
    const base = location.protocol + '//' + location.host + '/'
    if (href.startsWith(base)) {
      try { return decodeURIComponent(href.slice(base.length)) } catch (e) { return href.slice(base.length) }
    }
    return href
  }
  let over = null
  const leave = () => {
    if (over === null) return
    over = null
    send({ wsnp: '${LINK_MESSAGE}', link: null })
  }
  addEventListener('mouseover', (e) => {
    const link = e.target instanceof Element ? e.target.closest('a[href], area[href]') : null
    if (link === over) return
    if (!link) return leave()
    const text = describe(link)
    if (text === null) return leave()
    over = link
    send({ wsnp: '${LINK_MESSAGE}', link: text.slice(0, ${LINK_LIMIT}), x: e.clientX, y: e.clientY })
  }, true)
  document.addEventListener('mouseleave', leave)
  addEventListener('mousedown', leave, true)
  addEventListener('wheel', leave, { capture: true, passive: true })
  addEventListener('scroll', leave, true)
  addEventListener('blur', leave)
  // A link that opens elsewhere (target=_blank, or the download attribute): the sandbox allows neither popups nor downloads, so a click on it would do nothing.
  // It is followed in the frame as a plain link instead, and the main process decides what to do with where it leads (a tab for a file of the snapshot, the
  // browser for a web address). Nothing is opened for a script's own window.open.
  addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || !(e.target instanceof Element)) return
    const link = e.target.closest('a[href], area[href]')
    if (!link || !/^(wsnp|https?):/i.test(link.href)) return
    const target = (link.getAttribute('target') || '').toLowerCase()
    if (!link.hasAttribute('download') && (!target || target === '_self' || target === '_parent' || target === '_top')) return
    e.preventDefault()
    location.assign(link.href)
  })
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const key = e.key
    const direction = key === '=' || key === '+' ? 'in' : key === '-' ? 'out' : key === '0' ? 'reset' : null
    if (!direction) return
    e.preventDefault()
    send({ wsnp: '${ZOOM_MESSAGE}', direction })
  }, true)
})()`

/** What the interface takes from a message of a page: a direction of the zoom, a turn of the wheel, or the link the pointer is over (null: none now). Nothing else. */
export type ZoomMessage = { direction: 'in' | 'out' | 'reset' } | { wheel: number }
export type LinkMessage = { link: string; x: number; y: number } | { link: null }
export type FrameMessage = ZoomMessage | LinkMessage

export function readFrameMessage(data: unknown): FrameMessage | null {
  const m = data as { wsnp?: unknown; direction?: unknown; wheel?: unknown; link?: unknown; x?: unknown; y?: unknown } | null
  if (!m) return null
  if (m.wsnp === ZOOM_MESSAGE) {
    if (m.direction === 'in' || m.direction === 'out' || m.direction === 'reset') return { direction: m.direction }
    if (typeof m.wheel === 'number' && Number.isFinite(m.wheel) && m.wheel !== 0) return { wheel: m.wheel }
    return null
  }
  if (m.wsnp === LINK_MESSAGE) {
    if (m.link === null) return { link: null }
    if (typeof m.link === 'string' && m.link && typeof m.x === 'number' && typeof m.y === 'number' && Number.isFinite(m.x) && Number.isFinite(m.y)) return { link: m.link.slice(0, LINK_LIMIT), x: m.x, y: m.y }
  }
  return null
}

/**
 * Turns of the wheel into steps of the zoom (up zooms in): a notch of a mouse (100 or so) is one step, and the small turns a trackpad sends are added up
 * until they make one. Returns the steps (1, -1 or 0) and what is carried to the next turn.
 */
export const WHEEL_STEP = 50
export function wheelSteps(carried: number, deltaY: number): { steps: number; rest: number } {
  if (Math.abs(deltaY) >= WHEEL_STEP) return { steps: deltaY < 0 ? 1 : -1, rest: 0 }
  const total = carried - deltaY
  return Math.abs(total) >= WHEEL_STEP ? { steps: total > 0 ? 1 : -1, rest: 0 } : { steps: 0, rest: total }
}
