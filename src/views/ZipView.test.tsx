// @vitest-environment happy-dom
import type { FbApi, ZipEntryInfo } from '@core/api.ts'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { ZipView } from './ZipView.tsx'

const entry = (name: string, size = 10, extra: Partial<ZipEntryInfo> = {}): ZipEntryInfo => ({ name, size, compressedSize: size - 2, directory: name.endsWith('/'), modified: '2026-09-29T12:00:00.000Z', ...extra })
const ENTRIES = [entry('docs/', 0), entry('docs/readme.txt', 40), entry('docs/data.json', 23), entry('img/dot.png', 70), entry('secret.txt', 5, { unreadable: 'encrypted' }), entry('nested.zip', 300)]

let api: { zipList: ReturnType<typeof vi.fn>; zipExtract: ReturnType<typeof vi.fn> }
beforeEach(() => {
  api = {
    zipList: vi.fn(async () => ({ entries: ENTRIES, truncated: false })),
    zipExtract: vi.fn(async () => ({ extracted: 2, folder: '/home/me/out', skipped: 0 })),
  }
  window.fb = api as unknown as FbApi
})
afterEach(cleanup)

function show(props: Partial<Parameters<typeof ZipView>[0]> = {}) {
  const onSave = vi.fn()
  const onView = vi.fn()
  const onNotify = vi.fn()
  render(
    <I18nProvider language="en">
      <ZipView snapshotId="a" path="assets/files/bundle.zip" name="bundle.zip" size={4096} onSave={onSave} onView={onView} onNotify={onNotify} {...props} />
    </I18nProvider>,
  )
  return { onSave, onView, onNotify }
}
const row = (name: string) => screen.getByRole('row', { name: new RegExp(`^.*${name.replace(/[./]/g, '\\$&')}`) })
const rows = () => screen.getAllByRole('row').slice(1)

describe('ZipView', () => {
  it('lists the ZIP: every entry in its order, with size, packed size and date, and a summary', async () => {
    show()
    await screen.findByRole('table', { name: /bundle.zip/ })
    expect(api.zipList).toHaveBeenCalledWith('a', 'assets/files/bundle.zip')
    expect(rows().map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(ENTRIES.map((e) => e.name))
    expect(within(rows()[1]).getAllByRole('cell')[2].textContent).toBe('40 B')
    expect(screen.getByText(/6 items, 438 B · 4\.0 KB/)).toBeTruthy()
  })

  it('says the ZIP is empty, and why it could not be read', async () => {
    api.zipList.mockResolvedValueOnce({ entries: [], truncated: false })
    show()
    expect(await screen.findByText('This ZIP file is empty.')).toBeTruthy()
    cleanup()
    api.zipList.mockResolvedValueOnce({ error: 'not-zip' })
    show()
    expect((await screen.findByRole('alert')).textContent).toBe('This file is not a valid ZIP file.')
    expect(screen.getByRole('button', { name: 'Save As…' })).toBeTruthy()
  })

  it('selects like a file manager: a click, Ctrl, Shift, the boxes, and all', async () => {
    show()
    await screen.findByRole('table')
    const selected = () => rows().filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => within(r).getAllByRole('cell')[1].textContent)
    fireEvent.click(row('readme.txt'))
    expect(selected()).toEqual(['docs/readme.txt'])
    fireEvent.click(row('dot.png'), { ctrlKey: true })
    expect(selected()).toEqual(['docs/readme.txt', 'img/dot.png'])
    // Shift extends from the row last clicked (here dot.png), as a file manager does.
    fireEvent.click(row('docs/data.json'), { shiftKey: true })
    expect(selected()).toEqual(['docs/data.json', 'img/dot.png'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select docs/' }))
    expect(selected()).toEqual(['docs/', 'docs/data.json', 'img/dot.png'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(selected()).toHaveLength(ENTRIES.length)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(selected()).toEqual([])
  })

  it('moves and selects with the keyboard: arrows, Space, Ctrl+A, Enter to view', async () => {
    const { onView } = show()
    const list = (await screen.findByRole('table')).querySelector<HTMLElement>('[aria-multiselectable]')!
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(row('readme.txt').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ name: 'docs/readme.txt' }))
    fireEvent.keyDown(list, { key: 'a', ctrlKey: true })
    expect(rows().every((r) => r.getAttribute('aria-selected') === 'true')).toBe(true)
  })

  it('views an entry by a double click, but not a folder or an unreadable one', async () => {
    const { onView } = show()
    await screen.findByRole('table')
    fireEvent.doubleClick(row('docs/data.json'))
    expect(onView).toHaveBeenCalledTimes(1)
    fireEvent.doubleClick(row('docs/readme.txt'))
    fireEvent.doubleClick(screen.getAllByRole('row').find((r) => r.textContent?.includes('secret.txt'))!)
    fireEvent.doubleClick(screen.getAllByRole('row').find((r) => r.textContent === '' || within(r).queryByText('docs/'))!)
    expect(onView).toHaveBeenCalledTimes(2)
  })

  it('extracts the selection, names the folder it went to, and extracts all into a folder', async () => {
    const { onNotify } = show()
    await screen.findByRole('table')
    expect((screen.getByRole('button', { name: 'Extract Selected…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(row('readme.txt'))
    fireEvent.click(row('dot.png'), { ctrlKey: true })
    const button = screen.getByRole('button', { name: 'Extract Selected…' })
    expect(button.textContent).toContain('Extract 2 Selected…')
    fireEvent.click(button)
    await waitFor(() => expect(api.zipExtract).toHaveBeenCalledWith('a', 'assets/files/bundle.zip', ['docs/readme.txt', 'img/dot.png'], undefined))
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith({ level: 'info', text: 'Extracted 2 files to /home/me/out.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Extract All…' }))
    await waitFor(() => expect(api.zipExtract).toHaveBeenLastCalledWith('a', 'assets/files/bundle.zip', ['docs/readme.txt', 'docs/data.json', 'img/dot.png', 'secret.txt', 'nested.zip'], { folder: true }))
  })

  it('says what could not be extracted, what went wrong, and says nothing when the dialog is cancelled', async () => {
    const { onNotify } = show()
    await screen.findByRole('table')
    fireEvent.click(row('readme.txt'))
    api.zipExtract.mockResolvedValueOnce({ extracted: 1, folder: '/o', skipped: 2, firstSkipped: { name: 'secret.txt', reason: 'encrypted' } })
    fireEvent.click(screen.getByRole('button', { name: 'Extract Selected…' }))
    await waitFor(() => expect(onNotify).toHaveBeenLastCalledWith({ level: 'info', text: 'Extracted 1 files to /o; 2 could not be extracted (for example secret.txt).' }))
    api.zipExtract.mockResolvedValueOnce({ cancelled: true })
    fireEvent.click(screen.getByRole('button', { name: 'Extract Selected…' }))
    await waitFor(() => expect(api.zipExtract).toHaveBeenCalledTimes(2))
    expect(onNotify).toHaveBeenCalledTimes(1)
    api.zipExtract.mockResolvedValueOnce({ error: 'too-large' })
    fireEvent.click(screen.getByRole('button', { name: 'Extract Selected…' }))
    await waitFor(() => expect(onNotify).toHaveBeenLastCalledWith({ level: 'error', text: 'Could not extract: This ZIP file is too large to open here.' }))
  })

  it('a single file is reported as saved, by the name it was given', async () => {
    const { onNotify } = show()
    await screen.findByRole('table')
    fireEvent.click(row('readme.txt'))
    api.zipExtract.mockResolvedValueOnce({ extracted: 1, path: '/home/me/copy.txt', skipped: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Extract Selected…' }))
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith({ level: 'info', text: 'Saved copy.txt.' }))
  })

  it('offers View and Extract in a context menu on one file, only Extract on a folder or several, and selects the row it was opened on', async () => {
    const { onView } = show()
    await screen.findByRole('table')
    fireEvent.contextMenu(row('docs/data.json'))
    expect(row('docs/data.json').getAttribute('aria-selected')).toBe('true')
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['View', 'Extract…'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'View' }))
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ name: 'docs/data.json' }))

    fireEvent.contextMenu(screen.getAllByRole('row').find((r) => within(r).queryByText('docs/'))!)
    const folderMenu = await screen.findByRole('menu')
    expect((within(folderMenu).getByRole('menuitem', { name: 'View' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(folderMenu).getByRole('menuitem', { name: 'Extract…' }))
    await waitFor(() => expect(api.zipExtract).toHaveBeenLastCalledWith('a', 'assets/files/bundle.zip', ['docs/'], undefined))

    fireEvent.click(row('readme.txt'))
    fireEvent.click(row('dot.png'), { ctrlKey: true })
    fireEvent.contextMenu(row('dot.png'))
    const many = await screen.findByRole('menu')
    expect(within(many).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Extract 2 Selected…'])
  })

  it('marks an entry it cannot read, with the reason', async () => {
    show()
    await screen.findByRole('table')
    const locked = screen.getAllByRole('row').find((r) => r.textContent?.includes('secret.txt'))!
    expect(locked.getAttribute('title')).toBe('Protected with a password: this viewer cannot open it.')
  })

  it('draws only the rows near the window when the ZIP is long, and says the list was cut', async () => {
    api.zipList.mockResolvedValueOnce({ entries: Array.from({ length: 5000 }, (_, i) => entry(`f/${i}.txt`)), truncated: true })
    show()
    await screen.findByRole('table')
    expect(rows().length).toBeLessThan(100)
    expect(screen.getByText(/The first 5000 items/)).toBeTruthy()
    act(() => undefined)
  })
})
