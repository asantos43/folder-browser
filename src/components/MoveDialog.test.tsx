// @vitest-environment happy-dom
import type { DirEntry, ListResult } from '@core/api.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { MoveDialog } from './MoveDialog.tsx'

afterEach(cleanup)

const entry = (name: string, kind: DirEntry['kind'], path = name): DirEntry => ({ name, path, kind, size: kind === 'dir' ? 0 : 10, modified: '2026-01-01T00:00:00.000Z', hidden: false })
const lists: Record<string, ListResult> = {
  '': { entries: [entry('docs', 'dir'), entry('pack.zip', 'zip'), entry('a.txt', 'file')], truncated: false },
  'pack.zip': { entries: [entry('src', 'dir', 'pack.zip!/src'), entry('inner.zip', 'zip', 'pack.zip!/inner.zip'), entry('top.txt', 'file', 'pack.zip!/top.txt')], truncated: false },
}

function show(item: DirEntry) {
  const onMove = vi.fn()
  const listDir = vi.fn(async (path: string) => lists[path] ?? ({ entries: [], truncated: false } as ListResult))
  render(
    <I18nProvider language="en">
      <MoveDialog rootName="work" entry={item} listDir={listDir} onMove={onMove} onCancel={vi.fn()} />
    </I18nProvider>,
  )
  return { onMove }
}
const rows = () => screen.queryAllByRole('treeitem').map((r) => r.textContent)

describe('MoveDialog', () => {
  it('offers the folders of the disk for an item of the disk, and not the ZIP files', async () => {
    show(entry('a.txt', 'file'))
    await waitFor(() => expect(rows()).toEqual(['work', 'docs']))
  })

  it('offers the ZIP files and their folders for an entry of a ZIP, and the folder it is in is not a place to move it to', async () => {
    const { onMove } = show(entry('top.txt', 'file', 'pack.zip!/top.txt'))
    await waitFor(() => expect(rows()).toEqual(['work', 'docs', 'pack.zip']))
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: /pack\.zip/ }))
    await waitFor(() => expect(rows()).toEqual(['work', 'docs', 'pack.zip', 'src', 'inner.zip']))
    // The ZIP it is in (its top) is where it is already.
    expect(screen.getByRole('treeitem', { name: /pack\.zip/ }).getAttribute('aria-disabled')).toBe('true')
    expect((screen.getByRole('button', { name: 'Move Here' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('treeitem', { name: /src/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Here' }))
    expect(onMove).toHaveBeenCalledWith('pack.zip!/src')
  })

  it('does not offer a folder of a ZIP, or what is in it, to be moved into itself', async () => {
    show(entry('src', 'dir', 'pack.zip!/src'))
    await waitFor(() => expect(rows()).toEqual(['work', 'docs', 'pack.zip']))
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: /pack\.zip/ }))
    await waitFor(() => expect(rows()).toEqual(['work', 'docs', 'pack.zip', 'inner.zip']))
  })
})
