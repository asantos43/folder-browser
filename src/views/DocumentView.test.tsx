// @vitest-environment happy-dom
import type { DocOpen, FbApi } from '@core/api.ts'
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { fileTarget } from '@/find/types.ts'
import { DocumentView } from './DocumentView.tsx'

// (The frame and the page's messages take a moment when the machine is busy with the other test files.)
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  delete window.fb
  vi.useRealTimers()
})

const OK: DocOpen = { token: 'dabc', url: 'fb-doc://dabc/', flavour: 'docx' }
function setup(open: () => Promise<DocOpen> = async () => OK, props: { active?: boolean; zoom?: number } = {}) {
  const release = vi.fn(async () => {})
  const findInPage = vi.fn(async () => ({ found: true, count: 2 }))
  window.fb = { docs: { open: vi.fn(open), release }, findInPage, clearFindInPage: vi.fn(async () => {}) } as unknown as FbApi
  const handlers = { onSave: vi.fn(), onHex: vi.fn(), onOpenWith: vi.fn(), onZoom: vi.fn() }
  const view = render(
    <I18nProvider language="en">
      <DocumentView snapshotId="r1" path="docs/report.docx" name="report.docx" mediaType={undefined} size={1234} {...props} {...handlers} />
    </I18nProvider>,
  )
  return { release, findInPage, handlers, ...view }
}
const frame = () => screen.getByTitle('Document: report.docx') as HTMLIFrameElement
/** A message the page of the document posts to the interface: it comes from the frame's own window. */
const say = (data: unknown, source: unknown = frame().contentWindow) => act(() => void window.dispatchEvent(new MessageEvent('message', { data, source: source as Window })))

describe('DocumentView', () => {
  it('puts the document in a frame that is sandboxed (scripts only), at the address the main process gave', async () => {
    const { release } = setup()
    await waitFor(() => expect(frame().getAttribute('src')).toBe('fb-doc://dabc/'))
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts')
    expect(screen.getByText('Drawing the document…')).toBeTruthy()
    expect(release).not.toHaveBeenCalled()
  })
  it('stops saying it is drawing when the page says it has drawn', async () => {
    setup()
    await waitFor(() => frame())
    say({ fbDoc: true, type: 'ready', views: 1 })
    await waitFor(() => expect(screen.queryByText('Drawing the document…')).toBeNull())
  })
  it('says in words that a document could not be drawn, with the way out (Save As, View as hex)', async () => {
    const { handlers } = setup()
    await waitFor(() => frame())
    say({ fbDoc: true, type: 'error', message: 'End of data reached' })
    await waitFor(() => expect(screen.getByText('This document could not be drawn: End of data reached')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'View as hex' }))
    expect(handlers.onHex).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(handlers.onSave).toHaveBeenCalledOnce()
  })
  it('listens to the page of its own frame only', async () => {
    setup()
    await waitFor(() => frame())
    say({ fbDoc: true, type: 'error', message: 'forged' }, window)
    say({ type: 'error', message: 'not ours' })
    expect(screen.queryByText(/could not be drawn/)).toBeNull()
  })
  it('says why a file was not opened (too large) and lets go of nothing it never got', async () => {
    const { release } = setup(async () => ({ error: 'too-large' }))
    await waitFor(() => expect(screen.getByText('This file is too large to show here.')).toBeTruthy())
    expect(release).not.toHaveBeenCalled()
  })
  it('lets the document go when the tab closes', async () => {
    const { release, unmount } = setup()
    await waitFor(() => frame())
    unmount()
    expect(release).toHaveBeenCalledWith('dabc')
  })
  it('lets it go at once if the tab closed while the main process was still reading the file', async () => {
    let finish: (open: DocOpen) => void = () => {}
    const { release, unmount } = setup(() => new Promise<DocOpen>((resolve) => (finish = resolve)))
    unmount()
    await act(async () => finish(OK))
    expect(release).toHaveBeenCalledWith('dabc')
  })
  it('gives up on a document that takes too long', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    await vi.waitFor(() => frame())
    await act(async () => void vi.advanceTimersByTime(46_000))
    expect(screen.getByText(/This document could not be drawn: The document took too long/)).toBeTruthy()
  })

  it('has Open With… and View as hex in its toolbar, beside Save As', async () => {
    const { handlers } = setup()
    await waitFor(() => frame())
    fireEvent.click(screen.getByRole('button', { name: 'Open With…' }))
    fireEvent.click(screen.getByRole('button', { name: 'View as hex' }))
    expect(handlers.onOpenWith).toHaveBeenCalledOnce()
    expect(handlers.onHex).toHaveBeenCalledOnce()
  })
  it('lays the frame out at 1/zoom of the room and scales it up, as a browser’s zoom does', async () => {
    setup(undefined, { zoom: 1.25 })
    await waitFor(() => frame())
    expect(frame().style.width).toBe('80%')
    expect(frame().style.transform).toBe('scale(1.25)')
  })
  it('hands the wheel and the zoom keys of the page to the zoom of the tab, only while the tab is in front', async () => {
    const { handlers, rerender } = setup()
    await waitFor(() => frame())
    say({ fbDoc: true, type: 'wheel', deltaY: -120 })
    say({ fbDoc: true, type: 'zoom', direction: 'in' })
    expect(handlers.onZoom).toHaveBeenNthCalledWith(1, { wheel: -120 })
    expect(handlers.onZoom).toHaveBeenNthCalledWith(2, { direction: 'in' })
    rerender(
      <I18nProvider language="en">
        <DocumentView snapshotId="r1" path="docs/report.docx" name="report.docx" mediaType={undefined} size={1234} active={false} {...handlers} />
      </I18nProvider>,
    )
    say({ fbDoc: true, type: 'wheel', deltaY: 120 })
    expect(handlers.onZoom).toHaveBeenCalledTimes(2)
  })
  it('is what Find searches while it is drawn and its tab is in front, and no longer when it is not', async () => {
    const { findInPage, unmount } = setup()
    await waitFor(() => frame())
    expect(fileTarget.get()).toBeNull()
    say({ fbDoc: true, type: 'ready', views: 1 })
    await waitFor(() => expect(fileTarget.get()).not.toBeNull())
    expect(await fileTarget.get()!.search('ferry', { caseSensitive: false })).toEqual({ count: 2, index: 1 })
    expect(findInPage).toHaveBeenCalledWith('dabc', 'ferry', expect.objectContaining({ reset: true }))
    unmount()
    expect(fileTarget.get()).toBeNull()
  })
  it('is not what Find searches while its tab is behind another', async () => {
    setup(undefined, { active: false })
    await waitFor(() => frame())
    say({ fbDoc: true, type: 'ready', views: 1 })
    await waitFor(() => expect(screen.queryByText('Drawing the document…')).toBeNull())
    expect(fileTarget.get()).toBeNull()
  })
})
