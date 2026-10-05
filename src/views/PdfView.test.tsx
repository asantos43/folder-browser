// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'

// pdf.js is the library's business (the end-to-end tests draw a real PDF): here it is a stand-in, to test what the view does with it.
const pdfjs = vi.hoisted(() => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
  TextLayer: class {
    render = async () => {}
    cancel = () => {}
  },
}))
vi.mock('pdfjs-dist', () => pdfjs)
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.mjs' }))

import { PdfView } from './PdfView.tsx'

const fakePage = () => ({
  getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale, scale }),
  render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  streamTextContent: () => ({}),
})
const fakeDoc = (pages: number) => ({ numPages: pages, getPage: vi.fn(async () => fakePage()) })
const task = (promise: Promise<unknown>) => ({ promise, destroy: vi.fn(async () => {}) })

function show(onSave = vi.fn()) {
  render(
    <I18nProvider language="en">
      <PdfView id={`t:${Math.random()}`} bytes={new Uint8Array([1, 2, 3])} name="a.pdf" onSave={onSave} />
    </I18nProvider>,
  )
  return onSave
}

beforeEach(() => pdfjs.getDocument.mockReset())
afterEach(cleanup)

describe('PdfView', () => {
  it('loads the document without anything of the PDF running or being fetched, from the files of the build', async () => {
    pdfjs.getDocument.mockReturnValue(task(Promise.resolve(fakeDoc(3))))
    show()
    await screen.findByRole('img', { name: 'Page 1' })
    const options = pdfjs.getDocument.mock.calls[0][0]
    expect(options).toMatchObject({ enableXfa: false, useSystemFonts: false, disableAutoFetch: true, cMapPacked: true })
    expect(options.cMapUrl).toMatch(/\/pdfjs\/cmaps\/$/)
    expect(options.standardFontDataUrl).toMatch(/\/pdfjs\/standard_fonts\/$/)
    expect(options.wasmUrl).toMatch(/\/pdfjs\/wasm\/$/)
    expect(options).not.toHaveProperty('scripting')
    expect(options.data).toBeInstanceOf(Uint8Array)
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('worker.mjs')
  })
  it('shows a page for each page of the document, and their number', async () => {
    pdfjs.getDocument.mockReturnValue(task(Promise.resolve(fakeDoc(3))))
    show()
    await screen.findByRole('img', { name: 'Page 3' })
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.getByText('of 3')).toBeTruthy()
    expect((screen.getByLabelText('Page') as HTMLInputElement).value).toBe('1')
    expect((screen.getByRole('button', { name: 'Previous Page' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('says a password-protected PDF is that, and leaves Save As', async () => {
    pdfjs.getDocument.mockReturnValue(task(Promise.reject(Object.assign(new Error('no password'), { name: 'PasswordException' }))))
    const onSave = show()
    expect(await screen.findByText(/password-protected/)).toBeTruthy()
    expect((screen.getByLabelText('Page') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(onSave).toHaveBeenCalledOnce()
  })
  it('says a PDF that cannot be read is that, in plain words', async () => {
    pdfjs.getDocument.mockReturnValue(task(Promise.reject(new Error('Invalid PDF structure'))))
    show()
    expect(await screen.findByText('This PDF could not be read. It can still be saved.')).toBeTruthy()
    expect(screen.queryByText(/Invalid PDF/)).toBeNull()
  })
  it('zooms with the buttons, the box and the keyboard, inside the limits', async () => {
    pdfjs.getDocument.mockReturnValue(task(Promise.resolve(fakeDoc(2))))
    show()
    await screen.findByRole('img', { name: 'Page 1' })
    const readout = () => document.querySelector('[aria-live=polite]')?.textContent
    const box = screen.getByRole('combobox', { name: 'Zoom' })
    fireEvent.change(box, { target: { value: '1' } })
    expect(readout()).toBe('100%')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }))
    expect(readout()).toBe('110%')
    fireEvent.change(box, { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }))
    expect(readout()).toBe('400%')
    fireEvent.change(box, { target: { value: '0.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom Out' }))
    expect(readout()).toBe('25%')
    fireEvent.keyDown(screen.getByLabelText('a.pdf'), { key: '+' })
    expect(readout()).toBe('33%')
    fireEvent.keyDown(screen.getByLabelText('a.pdf'), { key: '0' })
    expect(readout()).toBe('100%')
  })
  it('makes the pages as big as the zoom says', async () => {
    pdfjs.getDocument.mockReturnValue(task(Promise.resolve(fakeDoc(2))))
    show()
    const page = await screen.findByRole('img', { name: 'Page 1' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Zoom' }), { target: { value: '2' } })
    await waitFor(() => expect(page.style.width).toBe('200px'))
    expect(page.style.height).toBe('400px')
  })
  it('lets go of the document when the view goes away', async () => {
    const loading = task(Promise.resolve(fakeDoc(1)))
    pdfjs.getDocument.mockReturnValue(loading)
    show()
    await screen.findByRole('img', { name: 'Page 1' })
    cleanup()
    expect(loading.destroy).toHaveBeenCalled()
  })
})
