// @vitest-environment happy-dom
import type { DirEntry, ListResult } from '@core/api.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { ExplorerTree } from './ExplorerTree.tsx'

afterEach(cleanup)

const entry = (name: string, kind: DirEntry['kind'], dir = '', extra: Partial<DirEntry> = {}): DirEntry => ({ name, path: dir ? `${dir}/${name}` : name, kind, size: kind === 'dir' ? 0 : 10, modified: '2026-01-01T00:00:00.000Z', hidden: name.startsWith('.'), ...extra })
const disk: Record<string, ListResult> = {
  '': { entries: [entry('.git', 'dir'), entry('docs', 'dir'), entry('.env', 'file'), entry('a.txt', 'file'), entry('pack.zip', 'zip'), entry('page.wsnp', 'wsnp')], truncated: false },
  docs: { entries: [entry('readme.md', 'file', 'docs')], truncated: false },
  '.git': { entries: [], truncated: false },
  'pack.zip': { entries: [entry('src', 'dir', 'pack.zip!', { path: 'pack.zip!/src' })], truncated: false },
  'pack.zip!/src': { entries: [entry('main.c', 'file', 'pack.zip!/src', { path: 'pack.zip!/src/main.c' })], truncated: false },
  locked: { error: 'denied' },
}

function show({ showHidden = false, activePath, refreshToken = 0, lists = disk, kind = 'folder', trash = false }: { showHidden?: boolean; activePath?: string; refreshToken?: number; lists?: Record<string, ListResult>; kind?: 'folder' | 'zip'; trash?: boolean } = {}) {
  const listDir = vi.fn(async (path: string) => lists[path] ?? ({ error: 'no-dir' } as ListResult))
  const actions = { listDir, open: vi.fn(), openSnapshot: vi.fn(), openDefault: vi.fn(), properties: vi.fn(), pin: vi.fn(), restore: vi.fn(), openWith: vi.fn(), save: vi.fn(), copy: vi.fn(), reveal: vi.fn() }
  const tree = (props: { showHidden: boolean; activePath?: string; refreshToken: number }) => (
    <I18nProvider language="en">
      <ExplorerTree rootId="r1" rootKind={kind} trash={trash} actions={actions} {...props} />
    </I18nProvider>
  )
  const view = render(tree({ showHidden, activePath, refreshToken }))
  return { ...actions, view, again: (props: { showHidden: boolean; activePath?: string; refreshToken: number }) => view.rerender(tree(props)) }
}
const names = () => screen.queryAllByRole('treeitem').map((r) => r.textContent)

describe('ExplorerTree', () => {
  it('reads the root alone, and lists folders first without the hidden ones', async () => {
    const { listDir } = show()
    await waitFor(() => expect(names()).toEqual(['docs', 'a.txt', 'pack.zip', 'page.wsnp']))
    expect(listDir).toHaveBeenCalledTimes(1)
    expect(listDir).toHaveBeenCalledWith('')
    expect(screen.getByRole('tree').getAttribute('aria-label')).toBe('Files and folders')
  })
  it('does not read anything again, nor take the rows away, when it is drawn again with new functions (as the side bar does at every change)', async () => {
    const { listDir, view } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    const row = screen.getByRole('treeitem', { name: 'a.txt' })
    const again = (listDir2: typeof listDir) =>
      view.rerender(
        <I18nProvider language="en">
          <ExplorerTree rootId="r1" rootKind="folder" trash={false} showHidden={false} refreshToken={0} actions={{ listDir: listDir2, open: vi.fn(), openSnapshot: vi.fn(), openWith: vi.fn(), openDefault: vi.fn(), properties: vi.fn(), save: vi.fn(), pin: vi.fn(), restore: vi.fn(), copy: vi.fn(), reveal: vi.fn() }} />
        </I18nProvider>,
      )
    const other = vi.fn(async () => ({ entries: [], truncated: false }) as ListResult)
    again(other as unknown as typeof listDir)
    again(other as unknown as typeof listDir)
    expect(names()).toHaveLength(4)
    // The very same row: a double click that straddles a redraw still lands on it.
    expect(screen.getByRole('treeitem', { name: 'a.txt' })).toBe(row)
    expect(listDir).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
  })
  it('shows the hidden ones, dimmed, when the switch is on, without asking the main process again', async () => {
    const { listDir, again } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    again({ showHidden: true, refreshToken: 0 })
    expect(names()).toEqual(['.git', 'docs', '.env', 'a.txt', 'pack.zip', 'page.wsnp'])
    expect(screen.getByRole('treeitem', { name: '.env' }).className).toContain('opacity-60')
    expect(listDir).toHaveBeenCalledTimes(1)
  })
  it('reads a folder when it is opened, and not before', async () => {
    const { listDir } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.click(screen.getByRole('treeitem', { name: 'docs' }))
    await waitFor(() => expect(names()).toEqual(['docs', 'readme.md', 'a.txt', 'pack.zip', 'page.wsnp']))
    expect(listDir).toHaveBeenCalledWith('docs')
    expect(screen.getByRole('treeitem', { name: 'docs' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('treeitem', { name: 'docs' }))
    expect(names()).toEqual(['docs', 'a.txt', 'pack.zip', 'page.wsnp'])
  })
  it('opens a ZIP like a folder, and the folders in it', async () => {
    show()
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.click(screen.getByRole('treeitem', { name: 'pack.zip' }))
    await waitFor(() => expect(names()).toContain('src'))
    fireEvent.click(screen.getByRole('treeitem', { name: 'src' }))
    await waitFor(() => expect(names()).toContain('main.c'))
  })
  it('opens a file in a preview tab with a click and keeps it with a double click, handing over its size', async () => {
    const { open } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.click(screen.getByRole('treeitem', { name: 'a.txt' }))
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'a.txt', size: 10 }), false)
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'a.txt' }))
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'a.txt' }), true)
  })
  it('opens the folders above the active file, and reads them', async () => {
    const { listDir } = show({ activePath: 'pack.zip!/src/main.c' })
    await waitFor(() => expect(names()).toContain('main.c'))
    expect(listDir).toHaveBeenCalledWith('pack.zip')
    expect(listDir).toHaveBeenCalledWith('pack.zip!/src')
    expect(screen.getByRole('treeitem', { name: 'main.c' }).getAttribute('aria-selected')).toBe('true')
  })
  it('says why a folder cannot be read, in the row below it, and says when a folder is empty or has only hidden files', async () => {
    show({ lists: { '': { entries: [entry('locked', 'dir'), entry('empty', 'dir'), entry('dots', 'dir')], truncated: false }, locked: { error: 'denied' }, empty: { entries: [], truncated: false }, dots: { entries: [entry('.x', 'file', 'dots')], truncated: false } } })
    await waitFor(() => expect(names()).toHaveLength(3))
    fireEvent.click(screen.getByRole('treeitem', { name: 'locked' }))
    await screen.findByText('This folder cannot be read: the permission is missing.')
    fireEvent.click(screen.getByRole('treeitem', { name: 'empty' }))
    await screen.findByText('This folder is empty.')
    fireEvent.click(screen.getByRole('treeitem', { name: 'dots' }))
    await screen.findByText('There are only hidden files here.')
  })
  it('says when a listing was cut', async () => {
    show({ lists: { '': { entries: [entry('a.txt', 'file')], truncated: true } } })
    await screen.findByText('Only the first 1 items are shown.')
  })
  it('reads everything open again when the token changes', async () => {
    const { listDir, again } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.click(screen.getByRole('treeitem', { name: 'docs' }))
    await waitFor(() => expect(names()).toContain('readme.md'))
    listDir.mockClear()
    again({ showHidden: false, refreshToken: 1 })
    await waitFor(() => expect(listDir).toHaveBeenCalledWith('docs'))
    expect(listDir).toHaveBeenCalledWith('')
  })
  it('moves with the arrows, opens with the right arrow and types to a name', async () => {
    show()
    await waitFor(() => expect(names()).toHaveLength(4))
    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    await waitFor(() => expect(names()).toContain('readme.md'))
    fireEvent.keyDown(tree, { key: 'p' })
    expect(document.activeElement?.getAttribute('data-path')).toBe('pack.zip')
  })
  it('lists the rows of the context menu by kind: a ZIP can be opened as a list', async () => {
    const { open } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'pack.zip' }))
    expect(screen.getByRole('menuitem', { name: 'Open as List' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open as List' }))
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: 'pack.zip', kind: 'zip' }), true)
  })
  it('opens a .wsnp as a snapshot with a click, a double click or Enter, as any other file is opened (not as a ZIP)', async () => {
    const { openSnapshot, open } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.click(screen.getByRole('treeitem', { name: 'page.wsnp' }))
    expect(openSnapshot).toHaveBeenCalledWith(expect.objectContaining({ path: 'page.wsnp', kind: 'wsnp' }))
    expect(open).not.toHaveBeenCalled()
    openSnapshot.mockClear()
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'page.wsnp' }))
    expect(openSnapshot).toHaveBeenCalledTimes(1)
    openSnapshot.mockClear()
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'End' })
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'Enter' })
    expect(openSnapshot).toHaveBeenCalledTimes(1)
  })
  it('shows a .wsnp as any file (no icon of its own), offers Open and Open as ZIP, and does not expand it', async () => {
    const { openSnapshot, open } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    expect(screen.getByRole('treeitem', { name: 'page.wsnp' }).getAttribute('aria-expanded')).toBeNull()
    expect(screen.getByRole('treeitem', { name: 'page.wsnp' }).querySelector('.codicon-browser')).toBeNull()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'page.wsnp' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open as ZIP' }))
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: 'page.wsnp' }), true)
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'page.wsnp' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }))
    expect(openSnapshot).toHaveBeenCalledTimes(1)
  })
  it('has, for every file, Open With…, the default application, Save As, Show in Folder, Copy Path, Copy Name and Properties, and hands each its path', async () => {
    const { openWith, openDefault, save, reveal, copy, properties } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    const choose = (name: string) => {
      fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.txt' }))
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }
    choose('Open With…')
    expect(openWith).toHaveBeenCalledWith('a.txt')
    choose('Open with Default Application')
    expect(openDefault).toHaveBeenCalledWith('a.txt')
    choose('Save As…')
    expect(save).toHaveBeenCalledWith('a.txt')
    choose('Reveal in File Manager')
    expect(reveal).toHaveBeenCalledWith('a.txt')
    choose('Copy Path')
    expect(copy).toHaveBeenLastCalledWith('a.txt')
    choose('Copy Name')
    expect(copy).toHaveBeenLastCalledWith('a.txt')
    choose('Properties')
    expect(properties).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.txt', size: 10 }))
  })
  it('has no Open With… on a folder, which expands, refreshes and has properties', async () => {
    show()
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'docs' }))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Expand', 'Refresh', 'Add to Favorites', 'Reveal in File Manager', 'Copy Path', 'Copy Name', 'Properties'])
  })
  it('pins a folder from its menu, and a folder of a ZIP, or of a ZIP root, cannot be pinned', async () => {
    const { pin } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'docs' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Favorites' }))
    expect(pin).toHaveBeenCalledWith('docs')
    fireEvent.click(screen.getByRole('treeitem', { name: 'pack.zip' }))
    await waitFor(() => expect(names()).toContain('src'))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'src' }))
    expect(screen.queryByRole('menuitem', { name: 'Add to Favorites' })).toBeNull()
    cleanup()
    show({ kind: 'zip', lists: { '': { entries: [entry('inner', 'dir')], truncated: false } } })
    await screen.findByRole('treeitem', { name: 'inner' })
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'inner' }))
    expect(screen.queryByRole('menuitem', { name: 'Add to Favorites' })).toBeNull()
  })
  it('makes only the folders of the disk draggable to the favourites, with the root and the path', async () => {
    show()
    await waitFor(() => expect(names()).toHaveLength(4))
    expect(screen.getByRole('treeitem', { name: 'docs' }).getAttribute('draggable')).toBe('true')
    expect(screen.getByRole('treeitem', { name: 'a.txt' }).getAttribute('draggable')).toBe('false')
    const set = vi.fn()
    fireEvent.dragStart(screen.getByRole('treeitem', { name: 'docs' }), { dataTransfer: { setData: set } })
    expect(set).toHaveBeenCalledWith('application/x-folder-browser-folder', JSON.stringify({ rootId: 'r1', path: 'docs' }))
  })
  it('offers Restore on the top-level rows of the trash and nowhere else', async () => {
    const { restore } = show({ trash: true, lists: { '': { entries: [entry('old.txt', 'file'), entry('folder', 'dir')], truncated: false }, folder: { entries: [entry('in.txt', 'file', 'folder')], truncated: false } } })
    await screen.findByRole('treeitem', { name: 'old.txt' })
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'old.txt' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }))
    expect(restore).toHaveBeenCalledWith('old.txt')
    fireEvent.click(screen.getByRole('treeitem', { name: 'folder' }))
    await screen.findByRole('treeitem', { name: 'in.txt' })
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'in.txt' }))
    expect(screen.queryByRole('menuitem', { name: 'Restore' })).toBeNull()
  })
})
