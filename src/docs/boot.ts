import type { DocMessage, DocReport } from '@core/docs.ts'

/** Tells the interface that holds the frame how it went. */
export const tell = (report: DocReport): void => window.parent.postMessage({ fbDoc: true, ...report } satisfies DocMessage, '*')

/** The page is being drawn to be printed (a window of the main process, never shown), not to be looked at: it holds the whole document and no controls of its own. */
export const printing = (): boolean => new URLSearchParams(location.search).has('print')

/** What the main process reads of a page it loaded to print (nothing else looks at it). */
const setState = (state: 'ready' | 'error', message = ''): void => void Object.assign(window, { __fbDocState: state, __fbDocMessage: message })

/** The zoom a key means: Control (or Command) with `+`/`=`, `-` or `0`. */
export function zoomKey(event: KeyboardEvent): 'in' | 'out' | 'reset' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  return event.key === '=' || event.key === '+' ? 'in' : event.key === '-' ? 'out' : event.key === '0' ? 'reset' : null
}

export const docName = (): string => document.querySelector<HTMLMetaElement>('meta[name="doc-name"]')?.content ?? ''

/**
 * Runs a document's page: the file is fetched from the page's own address, `draw` puts it in the root, and the interface is told. A failure of any kind (a file that is not
 * what its name says, a library that gives up) is said in words, never left as a blank page.
 */
export function boot(draw: (bytes: ArrayBuffer, root: HTMLElement) => Promise<{ views?: number } | void>): void {
  const root = document.getElementById('root')!
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    setState('error', message)
    tell({ type: 'error', message })
  }
  // The wheel with Control held is a zoom, and the interface does it for the tab: this page only says that it turned. (A frame inside it, which draws a view of an OpenDocument file,
  // says so to this page, and this page says so on.)
  window.addEventListener(
    'wheel',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || !event.deltaY) return
      event.preventDefault()
      tell({ type: 'wheel', deltaY: event.deltaY })
    },
    { capture: true, passive: false },
  )
  // The same for the zoom keys (the main process reads them first when they come from the keyboard; this is for a frame that has the focus).
  window.addEventListener(
    'keydown',
    (event) => {
      const direction = zoomKey(event)
      if (!direction) return
      event.preventDefault()
      tell({ type: 'zoom', direction })
    },
    true,
  )
  window.addEventListener('message', (event) => {
    const data = event.data as { fbDoc?: unknown; type?: unknown; deltaY?: unknown; direction?: unknown } | null
    if (event.source === window || data?.fbDoc !== true) return
    if (data.type === 'wheel' && typeof data.deltaY === 'number') tell({ type: 'wheel', deltaY: data.deltaY })
    else if (data.type === 'zoom' && (data.direction === 'in' || data.direction === 'out' || data.direction === 'reset')) tell({ type: 'zoom', direction: data.direction })
  })
  window.addEventListener('error', (event) => fail(event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => fail(event.reason))
  void (async () => {
    const response = await fetch('/_file')
    if (!response.ok) throw new Error('The file could not be read.')
    const result = await draw(await response.arrayBuffer(), root)
    setState('ready')
    tell({ type: 'ready', views: result?.views ?? 1 })
  })().catch(fail)
}
