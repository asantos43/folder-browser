import type { DocMessage, DocReport } from '@core/docs.ts'

/** Tells the interface that holds the frame how it went. */
export const tell = (report: DocReport): void => window.parent.postMessage({ fbDoc: true, ...report } satisfies DocMessage, '*')

export const docName = (): string => document.querySelector<HTMLMetaElement>('meta[name="doc-name"]')?.content ?? ''

/**
 * Runs a document's page: the file is fetched from the page's own address, `draw` puts it in the root, and the interface is told. A failure of any kind (a file that is not
 * what its name says, a library that gives up) is said in words, never left as a blank page.
 */
export function boot(draw: (bytes: ArrayBuffer, root: HTMLElement) => Promise<{ views?: number } | void>): void {
  const root = document.getElementById('root')!
  const fail = (error: unknown) => tell({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  window.addEventListener('error', (event) => fail(event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => fail(event.reason))
  void (async () => {
    const response = await fetch('/_file')
    if (!response.ok) throw new Error('The file could not be read.')
    const result = await draw(await response.arrayBuffer(), root)
    tell({ type: 'ready', views: result?.views ?? 1 })
  })().catch(fail)
}
