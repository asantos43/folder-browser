// @vitest-environment happy-dom
import { createHexDoc, overwriteByte } from '@core/hexEdit.ts'
import type { Draft, EditBytesOpen, FbApi } from '@core/api.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { hexBuffers } from '@/state/hexBuffers.ts'
import { HexEditView } from './HexEditView.tsx'

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  hexBuffers.clear()
})
afterEach(() => {
  cleanup()
  delete window.fb
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
})

const open = (...bytes: number[]): EditBytesOpen => ({ ok: true, bytes: Uint8Array.from(bytes), version: { mtimeMs: 1, size: bytes.length } })
function setup(answer: EditBytesOpen, draft: Draft | null = null) {
  const openBytes = vi.fn(async () => answer)
  const drafts = { get: vi.fn(async () => draft), delete: vi.fn(async () => {}) }
  window.fb = { edit: { openBytes }, drafts, copyText: vi.fn() } as unknown as FbApi
  const handlers = { onSave: vi.fn(), onSaveFile: vi.fn(), onSaveAs: vi.fn(), onChanged: vi.fn(), onRestored: vi.fn() }
  const element = (
    <I18nProvider language="en">
      <HexEditView tabKey="x:r1:a.bin" rootId="r1" path="a.bin" name="a.bin" fallback={() => <p>fallback</p>} {...handlers} />
    </I18nProvider>
  )
  return { openBytes, drafts, handlers, element, ...render(element) }
}
const grid = () => screen.getByRole('grid')

describe('HexEditView', () => {
  it('reads the bytes through the main process, with the version of the file, and the tab is not modified', async () => {
    const { openBytes, handlers } = setup(open(1, 2, 3))
    await waitFor(() => expect(screen.getByRole('grid', { name: 'Hexadecimal view of a.bin' })).toBeTruthy())
    expect(openBytes).toHaveBeenCalledWith('r1', 'a.bin')
    expect(hexBuffers.get('x:r1:a.bin')?.version).toEqual({ mtimeMs: 1, size: 3 })
    expect(handlers.onChanged).toHaveBeenLastCalledWith('x:r1:a.bin', false)
  })
  it('says the tab has changes after an edit, and keeps the bytes of a tab that is left and shown again', async () => {
    const { openBytes, handlers, unmount, element } = setup(open(0x11, 0x22))
    await waitFor(() => expect(grid()).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Edit the bytes/ }))
    fireEvent.mouseDown(screen.getAllByRole('gridcell')[0])
    fireEvent.keyDown(grid(), { key: '4' })
    fireEvent.keyDown(grid(), { key: '1' })
    expect(handlers.onChanged).toHaveBeenLastCalledWith('x:r1:a.bin', true)
    unmount()
    render(element)
    await waitFor(() => expect(screen.getByText('● Modified')).toBeTruthy())
    expect(openBytes).toHaveBeenCalledOnce()
    expect(screen.getAllByRole('gridcell')[0].textContent).toBe('41')
  })
  it('shows the changes of a draft kept by the last session, marked, with the version they began from', async () => {
    const draft: Draft = { version: 1, rootPath: '/r', path: 'a.bin', kind: 'bytes', bytes: Uint8Array.from([1, 9, 3]), base: { mtimeMs: 5, size: 3 }, at: '2026-10-06T12:00:00.000Z' }
    const { handlers } = setup(open(1, 2, 3), draft)
    await waitFor(() => expect(screen.getByText('● Modified')).toBeTruthy())
    expect(handlers.onRestored).toHaveBeenCalledWith('a.bin')
    const buffer = hexBuffers.get('x:r1:a.bin')!
    expect(buffer.version).toEqual({ mtimeMs: 5, size: 3 })
    expect([...buffer.doc.bytes]).toEqual([1, 9, 3])
    expect([...buffer.doc.changed]).toEqual([0, 1, 0])
  })
  it('lets a draft go that is what the file is now', async () => {
    const draft: Draft = { version: 1, rootPath: '/r', path: 'a.bin', kind: 'bytes', bytes: Uint8Array.from([1, 2]), base: { mtimeMs: 1, size: 2 }, at: '2026-10-06T12:00:00.000Z' }
    const { handlers, drafts } = setup(open(1, 2), draft)
    await waitFor(() => expect(grid()).toBeTruthy())
    expect(handlers.onRestored).not.toHaveBeenCalled()
    expect(drafts.delete).toHaveBeenCalledWith('r1', 'a.bin')
  })
  it('hands a file that cannot be read for editing to the fallback', async () => {
    setup({ ok: false, error: 'too-large' })
    await waitFor(() => expect(screen.getByText('fallback')).toBeTruthy())
  })
  it('keeps the bytes that came from a document made elsewhere (a buffer that was there already) without asking again', async () => {
    const doc = createHexDoc(Uint8Array.from([5, 6]))
    overwriteByte(doc, 0, 9)
    hexBuffers.set('x:r1:a.bin', { doc, version: { mtimeMs: 2, size: 2 } })
    const { openBytes } = setup(open(5, 6))
    await waitFor(() => expect(screen.getByText('● Modified')).toBeTruthy())
    expect(openBytes).not.toHaveBeenCalled()
  })
})
