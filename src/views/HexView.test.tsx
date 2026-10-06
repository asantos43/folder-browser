// @vitest-environment happy-dom
import type { FbApi } from '@core/api.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { HexView, RangeHexView, type HexSource } from './HexView.tsx'

beforeEach(() => {
  // happy-dom lays nothing out: the view has the room of 10 rows.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
})
afterEach(() => {
  cleanup()
  delete window.fb
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
})

const elf = () => {
  const bytes = new Uint8Array(70)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
  bytes[16] = 3
  bytes[18] = 62
  bytes.set(new TextEncoder().encode('Hello, hex!'), 32)
  return bytes
}
const show = (source: HexSource = { bytes: elf() }, onSave = vi.fn(), extra: { zoom?: number; findToken?: number; onOpenWith?: () => void } = {}) => {
  render(
    <I18nProvider language="en">
      <HexView name="libx.so" source={source} onSave={onSave} {...extra} />
    </I18nProvider>,
  )
  return onSave
}
const grid = () => screen.getByRole('grid')
const rows = () => screen.getAllByRole('row')

describe('HexView', () => {
  it('draws the offset, the bytes (eight and eight) and the text of each row, and says what the header says the file is', async () => {
    show()
    expect(rows()).toHaveLength(5)
    const first = rows()[0]
    expect(first.textContent).toContain('00000000')
    expect(first.textContent).toContain('7f454c46')
    expect(first.textContent).toContain('.ELF')
    expect(rows()[2].textContent).toContain('Hello, hex!')
    await waitFor(() => expect(screen.getByText('ELF 64-bit LSB shared object, x86-64')).toBeTruthy())
    expect(screen.getByText('70 B')).toBeTruthy()
  })
  it('says an empty file is empty', () => {
    show({ bytes: new Uint8Array(0) })
    expect(screen.getByText('The file is empty.')).toBeTruthy()
  })
  it('selects a byte on a click and a range with Shift, and says where and how many', () => {
    show()
    const cells = screen.getAllByRole('gridcell')
    fireEvent.mouseDown(cells[2])
    expect(screen.getByText('Offset 0x2 (2)')).toBeTruthy()
    expect(screen.getByText('1 byte selected')).toBeTruthy()
    fireEvent.mouseDown(cells[5], { shiftKey: true })
    expect(screen.getByText('4 bytes selected')).toBeTruthy()
    expect(cells.filter((c) => c.getAttribute('aria-selected') === 'true')).toHaveLength(4)
  })
  it('moves the selection with the arrows, and extends it with Shift', () => {
    show()
    fireEvent.mouseDown(screen.getAllByRole('gridcell')[0])
    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    expect(screen.getByText('Offset 0x1 (1)')).toBeTruthy()
    fireEvent.keyDown(grid(), { key: 'ArrowDown' })
    expect(screen.getByText('Offset 0x11 (17)')).toBeTruthy()
    fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByText('2 bytes selected')).toBeTruthy()
    fireEvent.keyDown(grid(), { key: 'End', ctrlKey: true })
    expect(screen.getByText('Offset 0x45 (69)')).toBeTruthy()
  })
  it('copies the selected bytes as hex with Ctrl+C, and as text from the toolbar', async () => {
    const copyText = vi.fn(async () => {})
    window.fb = { copyText } as unknown as FbApi
    show()
    fireEvent.mouseDown(screen.getAllByRole('gridcell')[1])
    fireEvent.mouseDown(screen.getAllByRole('gridcell')[3], { shiftKey: true })
    fireEvent.keyDown(grid(), { key: 'c', ctrlKey: true })
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('45 4c 46'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }))
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith('ELF'))
  })
  it('does not offer to copy with nothing selected', () => {
    show()
    expect((screen.getByRole('button', { name: 'Copy as hex' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('goes to an offset given in hex, and refuses one that is not there', () => {
    show()
    const box = screen.getByLabelText('Go to offset')
    fireEvent.change(box, { target: { value: '0x20' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByText('Offset 0x20 (32)')).toBeTruthy()
    fireEvent.change(box, { target: { value: 'ffff' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.getAttribute('aria-invalid')).toBe('true')
  })
  it('finds text and hex, one after the other, and says when there is none', async () => {
    show()
    const query = screen.getByPlaceholderText('Bytes, e.g. 4d 5a')
    fireEvent.change(query, { target: { value: '45 4c' } })
    fireEvent.keyDown(query, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('2 bytes selected')).toBeTruthy())
    expect(screen.getByText('Offset 0x2 (2)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search for bytes in hex or for text'), { target: { value: 'text' } })
    const text = screen.getByPlaceholderText('Text to find')
    fireEvent.change(text, { target: { value: 'hex!' } })
    fireEvent.keyDown(text, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Offset 0x2a (42)')).toBeTruthy())
    fireEvent.change(text, { target: { value: 'nothing here' } })
    fireEvent.keyDown(text, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Not found')).toBeTruthy())
  })
  it('says a hex search that is not whole bytes is not', async () => {
    show()
    const query = screen.getByPlaceholderText('Bytes, e.g. 4d 5a')
    fireEvent.change(query, { target: { value: '4d5' } })
    fireEvent.keyDown(query, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Not whole bytes in hex')).toBeTruthy())
  })
  it('has Save As', () => {
    const onSave = show()
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(onSave).toHaveBeenCalledOnce()
  })
})

describe('HexView: zoom, Find and Open With', () => {
  it('draws the rows and their text at the zoom of the tab', () => {
    show({ bytes: elf() }, vi.fn(), { zoom: 1.5 })
    expect((rows()[0] as HTMLElement).style.height).toBe('30px')
    expect(grid().style.fontSize).toBe('19.5px')
  })
  it('puts the focus in the box that looks for bytes or text at each Ctrl+F, and not before', () => {
    render(
      <I18nProvider language="en">
        <HexView name="libx.so" source={{ bytes: elf() }} onSave={() => {}} findToken={0} />
      </I18nProvider>,
    )
    expect(document.activeElement).not.toBe(screen.getByPlaceholderText('Bytes, e.g. 4d 5a'))
    cleanup()
    show({ bytes: elf() }, vi.fn(), { findToken: 1 })
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Bytes, e.g. 4d 5a'))
  })
  it('has Open With… when it is given what that does', () => {
    const onOpenWith = vi.fn()
    show({ bytes: elf() }, vi.fn(), { onOpenWith })
    fireEvent.click(screen.getByRole('button', { name: 'Open With…' }))
    expect(onOpenWith).toHaveBeenCalledOnce()
  })
})

describe('a file read a window at a time', () => {
  it('asks for the windows in view, and shows them when they come', async () => {
    const data = new Uint8Array(200_000).map((_, i) => i & 255)
    const readRange = vi.fn(async (_id: string, _path: string, offset: number, length: number) => ({ bytes: data.slice(offset, offset + length), size: data.length }))
    window.fb = { readRange } as unknown as FbApi
    render(
      <I18nProvider language="en">
        <RangeHexView snapshotId="r1" path="big.bin" name="big.bin" size={data.length} onSave={() => {}} fallback={() => <p>fallback</p>} />
      </I18nProvider>,
    )
    await waitFor(() => expect(rows()[0].textContent).toContain('000102030405'))
    expect(readRange).toHaveBeenCalledWith('r1', 'big.bin', 0, 65536)
    // Only the first chunk is asked for: the rest is not in view.
    expect(readRange.mock.calls.every(([, , offset]) => offset < 65536 * 2)).toBe(true)
  })
  it('falls back to the plain card for a file that cannot be read in windows', async () => {
    window.fb = { readRange: vi.fn(async () => ({ error: 'too-large' as const })) } as unknown as FbApi
    render(
      <I18nProvider language="en">
        <RangeHexView snapshotId="r1" path="a.zip!/x.bin" name="x.bin" size={99_999_999} onSave={() => {}} fallback={() => <p>fallback</p>} />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByText('fallback')).toBeTruthy())
  })
})
