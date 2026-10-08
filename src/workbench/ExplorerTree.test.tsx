// @vitest-environment happy-dom
import type { DirEntry, ListResult, OpResult } from '@core/api.ts'
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import type { SortKey } from '@core/fs/sort.ts'
import { fileClipboard } from './fileClipboard.ts'
import { ENTRY_DRAG, ExplorerTree, HOVER_OPEN_MS, type ExplorerActions } from './ExplorerTree.tsx'

afterEach(() => {
  cleanup()
  fileClipboard.set(null)
})

const entry = (name: string, kind: DirEntry['kind'], dir = '', extra: Partial<DirEntry> = {}): DirEntry => ({ name, path: dir ? `${dir}/${name}` : name, kind, size: kind === 'dir' ? 0 : 10, modified: '2026-01-01T00:00:00.000Z', hidden: name.startsWith('.'), ...extra })
const disk: Record<string, ListResult> = {
  '': { entries: [entry('.git', 'dir'), entry('docs', 'dir'), entry('.env', 'file'), entry('a.txt', 'file'), entry('pack.zip', 'zip'), entry('page.wsnp', 'wsnp')], truncated: false },
  docs: { entries: [entry('readme.md', 'file', 'docs')], truncated: false },
  '.git': { entries: [], truncated: false },
  'pack.zip': { entries: [entry('src', 'dir', 'pack.zip!', { path: 'pack.zip!/src' })], truncated: false },
  'pack.zip!/src': { entries: [entry('main.c', 'file', 'pack.zip!/src', { path: 'pack.zip!/src/main.c' })], truncated: false },
  locked: { error: 'denied' },
}

function show({ showHidden = false, activePath, refreshToken = 0, lists = disk, kind = 'folder', trash = false, writable = false, sortKey = 'name', sortDescending = false, createRequest, compare }: { compare?: ExplorerActions['compare']; writable?: boolean; createRequest?: { kind: 'file' | 'dir'; token: number }; showHidden?: boolean; activePath?: string; refreshToken?: number; lists?: Record<string, ListResult>; kind?: 'folder' | 'zip'; trash?: boolean; sortKey?: SortKey; sortDescending?: boolean } = {}) {
  const listDir = vi.fn(async (path: string) => lists[path] ?? ({ error: 'no-dir' } as ListResult))
  const actions = { listDir, open: vi.fn(), openSnapshot: vi.fn(), openDefault: vi.fn(), properties: vi.fn(), pin: vi.fn(), openAsRoot: vi.fn(), restore: vi.fn(), openWith: vi.fn(), save: vi.fn(), copy: vi.fn(), reveal: vi.fn(), create: vi.fn(async (): Promise<OpResult> => ({ ok: true, path: 'x' })), rename: vi.fn(async (): Promise<OpResult> => ({ ok: true, path: 'x' })), move: vi.fn(), copyTo: vi.fn(), moveTo: vi.fn(), paste: vi.fn(), remove: vi.fn(), ...(compare ? { compare } : {}) }
  type Props = { showHidden: boolean; activePath?: string; refreshToken: number; sortKey: SortKey; sortDescending: boolean }
  const tree = (props: Props) => (
    <I18nProvider language="en">
      <ExplorerTree rootId="r1" rootKind={kind} trash={trash} writable={writable} createRequest={createRequest} actions={actions} {...props} />
    </I18nProvider>
  )
  const view = render(tree({ showHidden, activePath, refreshToken, sortKey, sortDescending }))
  return { ...actions, view, again: (props: Partial<Props> & Pick<Props, 'showHidden' | 'refreshToken'>) => view.rerender(tree({ sortKey, sortDescending, ...props })) }
}
/** The names of the rows (each row also has its size and date). */
const names = () => screen.queryAllByRole('treeitem').map((r) => r.querySelector('span.truncate')?.textContent ?? r.textContent)

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
          <ExplorerTree rootId="r1" rootKind="folder" trash={false} writable={false} showHidden={false} sortKey="name" sortDescending={false} refreshToken={0} actions={{ listDir: listDir2, open: vi.fn(), openSnapshot: vi.fn(), openWith: vi.fn(), openDefault: vi.fn(), properties: vi.fn(), save: vi.fn(), pin: vi.fn(), openAsRoot: vi.fn(), restore: vi.fn(), copy: vi.fn(), reveal: vi.fn(), create: vi.fn(), rename: vi.fn(), move: vi.fn(), copyTo: vi.fn(), moveTo: vi.fn(), paste: vi.fn(), remove: vi.fn() }} />
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
  it('offers Select for Compare on a text file, and Compare with Selected on another once one is chosen (not on the chosen one, a folder, a ZIP or a picture)', async () => {
    const lists: Record<string, ListResult> = { '': { entries: [entry('docs', 'dir'), entry('a.txt', 'file'), entry('b.txt', 'file'), entry('pic.png', 'file'), entry('pack.zip', 'zip')], truncated: false } }
    const select = vi.fn()
    const compareWith = vi.fn()
    show({ lists, compare: { selected: null, select, with: compareWith, pair: vi.fn(), drop: vi.fn() } })
    await waitFor(() => expect(names()).toHaveLength(5))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.txt' }))
    expect(screen.queryByRole('menuitem', { name: 'Compare with Selected' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select for Compare' }))
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ path: 'a.txt' }))
    for (const name of ['docs', 'pack.zip', 'pic.png']) {
      fireEvent.contextMenu(screen.getByRole('treeitem', { name }))
      expect(screen.queryByRole('menuitem', { name: 'Select for Compare' }), name).toBeNull()
      fireEvent.keyDown(document.body, { key: 'Escape' })
    }
    cleanup()
    show({ lists, compare: { selected: { rootId: 'r1', path: 'a.txt' }, select, with: compareWith, pair: vi.fn(), drop: vi.fn() } })
    await waitFor(() => expect(names()).toHaveLength(5))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.txt' }))
    expect(screen.queryByRole('menuitem', { name: 'Compare with Selected' })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'b.txt' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Compare with Selected' }))
    expect(compareWith).toHaveBeenCalledWith(expect.objectContaining({ path: 'b.txt' }))
  })
  it('can compare a file of the same path in another root with the one chosen, and has no compare items when the tree is given none', async () => {
    const lists: Record<string, ListResult> = { '': { entries: [entry('a.txt', 'file')], truncated: false } }
    show({ lists })
    await waitFor(() => expect(names()).toHaveLength(1))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.txt' }))
    expect(screen.queryByRole('menuitem', { name: 'Select for Compare' })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    cleanup()
    show({ lists, compare: { selected: { rootId: 'r2', path: 'a.txt' }, select: vi.fn(), with: vi.fn(), pair: vi.fn(), drop: vi.fn() } })
    await waitFor(() => expect(names()).toHaveLength(1))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'a.txt' }))
    expect(screen.getByRole('menuitem', { name: 'Compare with Selected' })).toBeTruthy()
  })
  it('previews a .wsnp with a click, as a picture would be (not opened as a snapshot), and opens it for good with a double click or Enter', async () => {
    const { openSnapshot, open } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.click(screen.getByRole('treeitem', { name: 'page.wsnp' }))
    expect(openSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'page.wsnp', kind: 'wsnp' }), false)
    expect(open).not.toHaveBeenCalled()
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'page.wsnp' }))
    expect(openSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'page.wsnp' }), true)
    openSnapshot.mockClear()
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'End' })
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'Enter' })
    expect(openSnapshot).toHaveBeenCalledTimes(1)
  })
  it('shows a .wsnp as any file (no icon of its own), offers Open and Show Contents, and does not expand it', async () => {
    const { openSnapshot, open } = show()
    await waitFor(() => expect(names()).toHaveLength(4))
    expect(screen.getByRole('treeitem', { name: 'page.wsnp' }).getAttribute('aria-expanded')).toBeNull()
    expect(screen.getByRole('treeitem', { name: 'page.wsnp' }).querySelector('.codicon-browser')).toBeNull()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'page.wsnp' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show Contents' }))
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
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Expand', 'Refresh', 'Open as Explorer Root', 'Add to Favorites', 'Reveal in File Manager', 'Copy Path', 'Copy Name', 'Properties'])
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
  it('makes the folders of the disk draggable to the favourites, with the root and the path, and every file draggable to the editor (never as something to move, when nothing can be changed)', async () => {
    show()
    await waitFor(() => expect(names()).toHaveLength(4))
    expect(screen.getByRole('treeitem', { name: 'docs' }).getAttribute('draggable')).toBe('true')
    expect(screen.getByRole('treeitem', { name: 'a.txt' }).getAttribute('draggable')).toBe('true')
    expect(screen.getByRole('treeitem', { name: 'pack.zip' }).getAttribute('draggable')).toBe('false')
    const set = vi.fn()
    fireEvent.dragStart(screen.getByRole('treeitem', { name: 'docs' }), { dataTransfer: { setData: set } })
    expect(set).toHaveBeenCalledWith('application/x-folder-browser-folder', JSON.stringify({ rootId: 'r1', path: 'docs' }))
    const file = vi.fn()
    fireEvent.dragStart(screen.getByRole('treeitem', { name: 'a.txt' }), { dataTransfer: { setData: file } })
    expect(file).toHaveBeenCalledTimes(1)
    expect(file).toHaveBeenCalledWith('application/x-folder-browser-file', JSON.stringify({ rootId: 'r1', path: 'a.txt', name: 'a.txt', size: 10 }))
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
  describe('the order and the details of the rows', () => {
    const sized = (name: string, size: number, modified: string, kind: DirEntry['kind'] = 'file'): DirEntry => ({ name, path: name, kind, size, modified, hidden: false })
    const lists = (): Record<string, ListResult> => ({
      '': { entries: [sized('big.bin', 5_000_000, '2026-01-10T10:00:00.000Z'), sized('small.txt', 12, '2026-06-01T10:00:00.000Z'), sized('mid.md', 2048, '2025-03-05T10:00:00.000Z'), sized('zdir', 0, '2026-02-01T10:00:00.000Z', 'dir'), sized('adir', 0, '2026-09-01T10:00:00.000Z', 'dir')], truncated: false },
    })

    it('orders by name, folders first, by default', async () => {
      show({ lists: lists() })
      await waitFor(() => expect(names()).toEqual(['adir', 'zdir', 'big.bin', 'mid.md', 'small.txt']))
    })
    it('orders by size, smallest first, and largest first when descending; folders stay first and by name', async () => {
      const { again } = show({ lists: lists(), sortKey: 'size' })
      await waitFor(() => expect(names()).toEqual(['adir', 'zdir', 'small.txt', 'mid.md', 'big.bin']))
      again({ showHidden: false, refreshToken: 0, sortKey: 'size', sortDescending: true })
      expect(names()).toEqual(['adir', 'zdir', 'big.bin', 'mid.md', 'small.txt'])
    })
    it('orders by date, the oldest first, and the newest first when descending', async () => {
      const { again } = show({ lists: lists(), sortKey: 'modified' })
      await waitFor(() => expect(names()).toEqual(['zdir', 'adir', 'mid.md', 'big.bin', 'small.txt']))
      again({ showHidden: false, refreshToken: 0, sortKey: 'modified', sortDescending: true })
      expect(names()).toEqual(['adir', 'zdir', 'small.txt', 'big.bin', 'mid.md'])
    })
    it('changes the order at once, with no new reading of the folder', async () => {
      const { listDir, again } = show({ lists: lists() })
      await waitFor(() => expect(names()).toHaveLength(5))
      again({ showHidden: false, refreshToken: 0, sortKey: 'size', sortDescending: false })
      expect(names()[2]).toBe('small.txt')
      expect(listDir).toHaveBeenCalledTimes(1)
    })
    it('writes the size of a file small and to the right, and no size for a folder; the date too', async () => {
      show({ lists: lists() })
      await waitFor(() => expect(names()).toHaveLength(5))
      const row = (name: string) => screen.getByRole('treeitem', { name })
      expect(row('big.bin').textContent).toContain('4.8 MB')
      expect(row('small.txt').textContent).toContain('12 B')
      expect(row('mid.md').textContent).toContain('2.0 KB')
      // A folder has a date and no size.
      expect([...row('adir').querySelectorAll('span.tabular-nums')].map((e) => e.textContent)).toEqual([expect.stringMatching(/Sep/)])
      expect(row('adir').textContent).not.toMatch(/\d (B|KB|MB)/)
      expect(row('mid.md').textContent).toMatch(/2025/)
    })
    it('shows, when there is little room, the size when the order is by name or size, and the date when it is by date', async () => {
      const { again } = show({ lists: lists() })
      await waitFor(() => expect(names()).toHaveLength(5))
      const spans = (name: string) => [...screen.getByRole('treeitem', { name }).querySelectorAll('span.tabular-nums')].map((s) => [s.textContent, s.className.includes('hidden')])
      expect(spans('small.txt').map(([, hidden]) => hidden)).toEqual([false, true])
      again({ showHidden: false, refreshToken: 0, sortKey: 'modified', sortDescending: false })
      expect(spans('small.txt').map(([, hidden]) => hidden)).toEqual([true, false])
    })
    it('has the whole of it in the tooltip: the path, the size and the date', async () => {
      show({ lists: lists() })
      await waitFor(() => expect(names()).toHaveLength(5))
      const title = screen.getByRole('treeitem', { name: 'mid.md' }).getAttribute('title')!
      expect(title.split('\n')).toEqual(['mid.md', '2.0 KB', expect.stringContaining('2025')])
      expect(screen.getByRole('treeitem', { name: 'adir' }).getAttribute('title')!.split('\n')).toHaveLength(2)
    })
  })
})

describe('ExplorerTree: changing the disk', () => {
  const row = (name: string) => screen.getByRole('treeitem', { name })
  const nameField = () => screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
  const rightClick = (name: string) => fireEvent.contextMenu(row(name))
  const menuItem = (name: string) => screen.getByRole('menuitem', { name })

  it('renames in the row: F2 puts a field there with the name (without its extension) selected, Enter says it', async () => {
    const { rename } = show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.focus(row('a.txt'))
    fireEvent.keyDown(row('a.txt'), { key: 'F2' })
    expect(nameField().value).toBe('a.txt')
    expect([nameField().selectionStart, nameField().selectionEnd]).toEqual([0, 1])
    fireEvent.change(nameField(), { target: { value: 'b.txt' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    await waitFor(() => expect(rename).toHaveBeenCalledWith('a.txt', 'b.txt'))
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  })
  it('does nothing when the name did not change, and gives the field up on Escape or when the focus leaves', async () => {
    const { rename } = show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.keyDown(row('a.txt'), { key: 'F2' })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    expect(rename).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.keyDown(row('a.txt'), { key: 'F2' })
    fireEvent.keyDown(nameField(), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.keyDown(row('a.txt'), { key: 'F2' })
    fireEvent.blur(nameField())
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(rename).not.toHaveBeenCalled()
  })
  it('refuses a bad name in words, before asking, and keeps the field; a taken name is said too', async () => {
    const { rename } = show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.focus(row('a.txt'))
    fireEvent.keyDown(row('a.txt'), { key: 'F2' })
    fireEvent.change(nameField(), { target: { value: 'a/b' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe('A name cannot contain / or \\.')
    expect(rename).not.toHaveBeenCalled()
    rename.mockResolvedValueOnce({ ok: false, error: 'exists' })
    fireEvent.change(nameField(), { target: { value: 'docs' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A file or folder with this name already exists here.'))
    expect(nameField()).toBeTruthy()
  })
  it('makes a new file or folder in a field at the top of the folder that has the focus (it opens), and in the root when none has', async () => {
    const { create, view } = show({ writable: true, createRequest: { kind: 'file', token: 1 } })
    await waitFor(() => expect(nameField().value).toBe(''))
    fireEvent.change(nameField(), { target: { value: 'new.txt' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    await waitFor(() => expect(create).toHaveBeenCalledWith('', 'new.txt', 'file'))
    view.unmount()
    cleanup()
    const second = show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.focus(row('docs'))
    rightClick('docs')
    fireEvent.click(menuItem('New Folder…'))
    await waitFor(() => expect(nameField()).toBeTruthy())
    expect(second.listDir).toHaveBeenCalledWith('docs')
    fireEvent.change(nameField(), { target: { value: 'sub' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    await waitFor(() => expect(second.create).toHaveBeenCalledWith('docs', 'sub', 'dir'))
  })
  it('asks to delete with Delete and from the menu, and to move from the menu', async () => {
    const { remove, moveTo } = show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.focus(row('a.txt'))
    fireEvent.keyDown(row('a.txt'), { key: 'Delete' })
    expect(remove).toHaveBeenCalledWith([expect.objectContaining({ path: 'a.txt' })], false)
    rightClick('a.txt')
    fireEvent.click(menuItem('Move to…'))
    expect(moveTo).toHaveBeenCalledWith([expect.objectContaining({ path: 'a.txt' })])
    rightClick('docs')
    fireEvent.click(screen.getByRole('menuitem', { name: /^Delete/ }))
    expect(remove).toHaveBeenCalledWith([expect.objectContaining({ path: 'docs' })])
    // Shift+Delete asks for the permanent delete.
    fireEvent.focus(row('a.txt'))
    fireEvent.keyDown(row('a.txt'), { key: 'Delete', shiftKey: true })
    expect(remove).toHaveBeenLastCalledWith([expect.objectContaining({ path: 'a.txt' })], true)
  })
  it('offers none of it where nothing can be changed: the trash, a root that is not writable', async () => {
    const { remove, rename } = show({ writable: false })
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.focus(row('a.txt'))
    fireEvent.keyDown(row('a.txt'), { key: 'F2' })
    fireEvent.keyDown(row('a.txt'), { key: 'Delete' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(rename).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    rightClick('a.txt')
    expect(screen.queryByRole('menuitem', { name: /^Rename/ })).toBeNull()
    const dragged = vi.fn()
    fireEvent.dragStart(row('a.txt'), { dataTransfer: { setData: dragged } })
    expect(dragged).not.toHaveBeenCalledWith('application/x-folder-browser-entry', expect.anything())
  })
  it('changes the entries of a ZIP like the files of a folder: rename, delete, move, new file in a folder of it and in its top', async () => {
    const { rename, remove, move, create, copyTo } = show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.click(row('pack.zip'))
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'src' })).toBeTruthy())
    fireEvent.click(screen.getByRole('treeitem', { name: 'src' }))
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'main.c' })).toBeTruthy())
    // Rename (F2) and Delete work on an entry of a ZIP.
    fireEvent.focus(row('main.c'))
    fireEvent.keyDown(row('main.c'), { key: 'F2' })
    fireEvent.change(nameField(), { target: { value: 'app.c' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    await waitFor(() => expect(rename).toHaveBeenCalledWith('pack.zip!/src/main.c', 'app.c'))
    fireEvent.focus(row('main.c'))
    fireEvent.keyDown(row('main.c'), { key: 'Delete' })
    expect(remove).toHaveBeenCalledWith([expect.objectContaining({ path: 'pack.zip!/src/main.c' })], false)
    // A new file: in a folder of the ZIP, and in the top of the ZIP (its row is a place to put things in).
    rightClick('src')
    fireEvent.click(menuItem('New File…'))
    fireEvent.change(nameField(), { target: { value: 'n.txt' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    await waitFor(() => expect(create).toHaveBeenCalledWith('pack.zip!/src', 'n.txt', 'file'))
    rightClick('pack.zip')
    fireEvent.click(menuItem('New Folder…'))
    fireEvent.change(nameField(), { target: { value: 'sub' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    await waitFor(() => expect(create).toHaveBeenCalledWith('pack.zip', 'sub', 'dir'))
    // Dropped on a folder of the ZIP it goes there; dropped on the folder it is already in, nothing is asked; Shift copies.
    const data = (payload: unknown) => ({ dataTransfer: { types: [ENTRY_DRAG], getData: (type: string) => (type === ENTRY_DRAG ? JSON.stringify(payload) : ''), dropEffect: '' } })
    fireEvent.drop(row('src'), data({ rootId: 'r1', path: 'pack.zip!/top.txt' }))
    expect(move).toHaveBeenCalledWith(['pack.zip!/top.txt'], 'pack.zip!/src')
    move.mockClear()
    fireEvent.drop(row('src'), data({ rootId: 'r1', path: 'pack.zip!/src/main.c' }))
    expect(move).not.toHaveBeenCalled()
    const shifted = createEvent.drop(row('src'), data({ rootId: 'r1', path: 'pack.zip!/top.txt' }))
    Object.defineProperty(shifted, 'shiftKey', { value: true })
    fireEvent(row('src'), shifted)
    expect(copyTo).toHaveBeenCalledWith(['pack.zip!/top.txt'], 'pack.zip!/src')
  })
  it('moves what is dropped on a folder into it, and what is dropped on the empty part into the root; never from another root', async () => {
    const { move } = show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    const data = (payload: unknown) => ({ dataTransfer: { types: [ENTRY_DRAG], getData: (type: string) => (type === ENTRY_DRAG ? JSON.stringify(payload) : ''), dropEffect: '' } })
    fireEvent.dragOver(row('docs'), data({ rootId: 'r1', path: 'a.txt' }))
    fireEvent.drop(row('docs'), data({ rootId: 'r1', path: 'a.txt' }))
    expect(move).toHaveBeenCalledWith(['a.txt'], 'docs')
    fireEvent.drop(screen.getByRole('tree'), data({ rootId: 'r1', path: 'docs/readme.md' }))
    expect(move).toHaveBeenCalledWith(['docs/readme.md'], '')
    fireEvent.drop(row('docs'), data({ rootId: 'other', path: 'a.txt' }))
    fireEvent.drop(row('docs'), data({ rootId: 'r1', path: 'docs' }))
    expect(move).toHaveBeenCalledTimes(2)
    // A file is not a folder: what is dropped on it goes to the folder it is in (here the root); and what is in that folder already stays.
    fireEvent.drop(row('a.txt'), data({ rootId: 'r1', path: 'docs/readme.md' }))
    expect(move).toHaveBeenCalledTimes(3)
    expect(move).toHaveBeenLastCalledWith(['docs/readme.md'], '')
    fireEvent.drop(row('a.txt'), data({ rootId: 'r1', path: 'b.txt' }))
    expect(move).toHaveBeenCalledTimes(3)
  })
  it('asks what to do when a text file is dropped on another one, instead of moving it; a copy (Shift), a folder and a file that is not a text are as before', async () => {
    const lists: Record<string, ListResult> = { '': { entries: [entry('docs', 'dir'), entry('a.txt', 'file'), entry('b.txt', 'file'), entry('pic.png', 'file')], truncated: false }, docs: { entries: [], truncated: false } }
    const drop = vi.fn()
    const { move, copyTo } = show({ writable: true, lists, compare: { selected: null, select: vi.fn(), with: vi.fn(), pair: vi.fn(), drop } })
    await waitFor(() => expect(names()).toHaveLength(4))
    const payload = { rootId: 'r1', path: 'a.txt', name: 'a.txt', size: 10 }
    const data = { dataTransfer: { types: [ENTRY_DRAG, 'application/x-folder-browser-file'], getData: (type: string) => (type === ENTRY_DRAG || type === 'application/x-folder-browser-file' ? JSON.stringify(payload) : ''), setData: vi.fn(), dropEffect: '', effectAllowed: '' } }
    fireEvent.dragStart(row('a.txt'), data)
    const over = createEvent.dragOver(row('b.txt'), data)
    fireEvent(row('b.txt'), over)
    expect(over.defaultPrevented).toBe(true)
    expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy')
    fireEvent.drop(row('b.txt'), data)
    expect(drop).toHaveBeenCalledWith({ path: 'a.txt', size: 10 }, expect.objectContaining({ path: 'b.txt' }))
    expect(move).not.toHaveBeenCalled()
    // On itself: nothing to compare. On a picture: not a text, so it goes where a drop on a file always went. On a folder: moved into it.
    fireEvent.drop(row('a.txt'), data)
    expect(drop).toHaveBeenCalledTimes(1)
    fireEvent.drop(row('pic.png'), data)
    expect(drop).toHaveBeenCalledTimes(1)
    fireEvent.drop(row('docs'), data)
    expect(move).toHaveBeenCalledWith(['a.txt'], 'docs')
    // With Shift held it is a copy, as it was.
    const shifted = createEvent.drop(row('b.txt'), data)
    Object.defineProperty(shifted, 'shiftKey', { value: true })
    fireEvent(row('b.txt'), shifted)
    expect(copyTo).toHaveBeenCalledWith(['a.txt'], '')
    expect(drop).toHaveBeenCalledTimes(1)
  })
  it('has New File and New Folder in the menu of the empty part of the tree, and Refresh', async () => {
    show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    fireEvent.contextMenu(screen.getByRole('tree'))
    expect(menuItem('New File…')).toBeTruthy()
    expect(menuItem('New Folder…')).toBeTruthy()
    expect(menuItem('Refresh')).toBeTruthy()
  })
})

describe('ExplorerTree: dragging with Shift and over closed folders', () => {
  const row = (name: string) => screen.getByRole('treeitem', { name })
  const data = (payload: unknown) => ({ dataTransfer: { types: [ENTRY_DRAG], getData: (type: string) => (type === ENTRY_DRAG ? JSON.stringify(payload) : ''), setData: vi.fn(), dropEffect: '', effectAllowed: '' } })
  /** A drag event with Shift held (the DOM the tests run in does not take the modifier keys of a drag event as an option). */
  const withShift = (type: 'drop' | 'dragOver', target: Element, init: ReturnType<typeof data>, shiftKey: boolean) => {
    const event = createEvent[type](target, init)
    Object.defineProperty(event, 'shiftKey', { value: shiftKey })
    fireEvent(target, event)
    return (event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect
  }

  it('copies what is dropped with Shift held, also into the folder it is in (a duplicate), and moves it without', async () => {
    const { move, copyTo } = show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    withShift('drop', row('docs'), data({ rootId: 'r1', path: 'a.txt' }), true)
    expect(copyTo).toHaveBeenCalledWith(['a.txt'], 'docs')
    expect(move).not.toHaveBeenCalled()
    // Onto a file of the same folder, with Shift: a duplicate in that folder.
    withShift('drop', row('a.txt'), data({ rootId: 'r1', path: 'a.txt' }), true)
    expect(copyTo).toHaveBeenLastCalledWith(['a.txt'], '')
    // The same without Shift is nothing.
    fireEvent.drop(row('a.txt'), data({ rootId: 'r1', path: 'a.txt' }))
    expect(move).not.toHaveBeenCalled()
    expect(copyTo).toHaveBeenCalledTimes(2)
    // Onto the empty part, with Shift.
    withShift('drop', screen.getByRole('tree'), data({ rootId: 'r1', path: 'docs/readme.md' }), true)
    expect(copyTo).toHaveBeenLastCalledWith(['docs/readme.md'], '')
  })
  it('shows the pointer of a copy while Shift is held, and of a move without it', async () => {
    show({ writable: true })
    await waitFor(() => expect(names()).toHaveLength(4))
    const over = (shiftKey: boolean) => withShift('dragOver', row('docs'), data({ rootId: 'r1', path: 'a.txt' }), shiftKey)
    expect(over(true)).toBe('copy')
    expect(over(false)).toBe('move')
  })
  it('opens a closed folder after the pointer rests on it while dragging, one after another down to the folder wanted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const nested: Record<string, ListResult> = { ...disk, docs: { entries: [entry('deep', 'dir', 'docs'), entry('readme.md', 'file', 'docs')], truncated: false }, 'docs/deep': { entries: [entry('n.txt', 'file', 'docs/deep')], truncated: false } }
      const { listDir } = show({ writable: true, lists: nested })
      await vi.waitFor(() => expect(names()).toHaveLength(4))
      fireEvent.dragStart(row('a.txt'), data({ rootId: 'r1', path: 'a.txt' }))
      fireEvent.dragOver(row('docs'), data({ rootId: 'r1', path: 'a.txt' }))
      expect(listDir).not.toHaveBeenCalledWith('docs')
      await act(async () => void vi.advanceTimersByTime(HOVER_OPEN_MS + 50))
      await vi.waitFor(() => expect(names()).toContain('deep'))
      expect(listDir).toHaveBeenCalledWith('docs')
      fireEvent.dragOver(row('deep'), data({ rootId: 'r1', path: 'a.txt' }))
      await act(async () => void vi.advanceTimersByTime(HOVER_OPEN_MS + 50))
      await vi.waitFor(() => expect(names()).toContain('n.txt'))
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not open a folder that the pointer only passed over, nor the folder that is being dragged, nor one it left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { listDir } = show({ writable: true })
      await vi.waitFor(() => expect(names()).toHaveLength(4))
      // Passed over: the pointer goes to another row before the moment is up.
      fireEvent.dragStart(row('a.txt'), data({ rootId: 'r1', path: 'a.txt' }))
      fireEvent.dragOver(row('docs'), data({ rootId: 'r1', path: 'a.txt' }))
      await act(async () => void vi.advanceTimersByTime(300))
      fireEvent.dragOver(row('a.txt'), data({ rootId: 'r1', path: 'a.txt' }))
      await act(async () => void vi.advanceTimersByTime(HOVER_OPEN_MS * 2))
      expect(listDir).not.toHaveBeenCalledWith('docs')
      // Left the row.
      fireEvent.dragOver(row('docs'), data({ rootId: 'r1', path: 'a.txt' }))
      fireEvent.dragLeave(row('docs'), { relatedTarget: document.body })
      await act(async () => void vi.advanceTimersByTime(HOVER_OPEN_MS * 2))
      expect(listDir).not.toHaveBeenCalledWith('docs')
      // The folder that is itself being dragged.
      fireEvent.dragStart(row('docs'), data({ rootId: 'r1', path: 'docs' }))
      fireEvent.dragOver(row('docs'), data({ rootId: 'r1', path: 'docs' }))
      await act(async () => void vi.advanceTimersByTime(HOVER_OPEN_MS * 2))
      expect(listDir).not.toHaveBeenCalledWith('docs')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ExplorerTree: several rows', () => {
  const many: Record<string, ListResult> = {
    '': { entries: [entry('docs', 'dir'), entry('a.txt', 'file'), entry('b.txt', 'file'), entry('c.md', 'file'), entry('pic.png', 'file')], truncated: false },
    docs: { entries: [entry('readme.md', 'file', 'docs'), entry('z.txt', 'file', 'docs')], truncated: false },
  }
  const row = (name: string) => screen.getByRole('treeitem', { name })
  const marked = () => screen.queryAllByRole('treeitem').filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => r.getAttribute('aria-label'))
  const click = (name: string, init: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}) => fireEvent.click(row(name), init)
  const rightClick = (name: string) => fireEvent.contextMenu(row(name))
  const menuItem = (name: string | RegExp) => screen.getByRole('menuitem', { name })
  const ready = async (options: Parameters<typeof show>[0] = {}) => {
    const shown = show({ lists: many, writable: true, ...options })
    await waitFor(() => expect(names()).toHaveLength(5))
    return shown
  }
  const compare = () => ({ selected: null, select: vi.fn(), with: vi.fn(), pair: vi.fn(), drop: vi.fn() })

  it('marks rows with Ctrl+click and Shift+click without opening anything, and a plain click opens and clears the marks', async () => {
    const { open } = await ready()
    click('a.txt')
    expect(open).toHaveBeenCalledTimes(1)
    click('c.md', { ctrlKey: true })
    expect(marked()).toEqual(['a.txt', 'c.md'])
    click('pic.png', { metaKey: true })
    expect(marked()).toEqual(['a.txt', 'c.md', 'pic.png'])
    click('c.md', { ctrlKey: true })
    expect(marked()).toEqual(['a.txt', 'pic.png'])
    expect(open).toHaveBeenCalledTimes(1)
    click('b.txt')
    expect(open).toHaveBeenCalledTimes(2)
    expect(marked()).toEqual([])
  })

  it('marks from the row clicked before to the one clicked with Shift, either way, in the order on screen', async () => {
    await ready()
    click('a.txt')
    click('c.md', { shiftKey: true })
    expect(marked()).toEqual(['a.txt', 'b.txt', 'c.md'])
    click('docs', { shiftKey: true })
    expect(marked()).toEqual(['docs', 'a.txt'])
    expect(screen.getByRole('tree').getAttribute('aria-multiselectable')).toBe('true')
  })

  it('a Ctrl+click or Shift+click on a folder only marks it (it does not open or close)', async () => {
    const { listDir } = await ready()
    click('docs', { ctrlKey: true })
    expect(row('docs').getAttribute('aria-expanded')).toBe('false')
    expect(listDir).toHaveBeenCalledTimes(1)
    expect(marked()).toEqual(['docs'])
  })

  it('Shift+arrows mark from where the range began, a plain arrow clears, Ctrl+A marks every row on screen and Esc clears', async () => {
    await ready()
    fireEvent.focus(row('a.txt'))
    fireEvent.keyDown(row('a.txt'), { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(row('b.txt'), { key: 'ArrowDown', shiftKey: true })
    expect(marked()).toEqual(['a.txt', 'b.txt', 'c.md'])
    fireEvent.keyDown(row('c.md'), { key: 'ArrowUp', shiftKey: true })
    expect(marked()).toEqual(['a.txt', 'b.txt'])
    fireEvent.keyDown(row('b.txt'), { key: 'ArrowDown' })
    expect(marked()).toEqual([])
    fireEvent.keyDown(row('c.md'), { key: 'a', ctrlKey: true })
    expect(marked()).toEqual(['docs', 'a.txt', 'b.txt', 'c.md', 'pic.png'])
    fireEvent.keyDown(row('c.md'), { key: 'Escape' })
    expect(marked()).toEqual([])
  })

  it('Delete on marked rows asks for all of them, and Shift+Delete for the permanent delete; what is in a marked folder is left out', async () => {
    const { remove } = await ready()
    click('docs')
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'readme.md' })).toBeTruthy())
    click('a.txt')
    click('b.txt', { ctrlKey: true })
    click('readme.md', { ctrlKey: true })
    fireEvent.keyDown(row('b.txt'), { key: 'Delete' })
    expect(remove).toHaveBeenCalledWith([expect.objectContaining({ path: 'docs/readme.md' }), expect.objectContaining({ path: 'a.txt' }), expect.objectContaining({ path: 'b.txt' })], false)
    click('docs', { ctrlKey: true })
    fireEvent.keyDown(row('docs'), { key: 'Delete', shiftKey: true })
    expect(remove).toHaveBeenLastCalledWith([expect.objectContaining({ path: 'docs' }), expect.objectContaining({ path: 'a.txt' }), expect.objectContaining({ path: 'b.txt' })], true)
  })

  it('F2 renames one row, not several', async () => {
    await ready()
    click('a.txt')
    click('b.txt', { ctrlKey: true })
    fireEvent.keyDown(row('b.txt'), { key: 'F2' })
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('the menu of a marked row is for all the marked rows: Move to… and Delete with the count, and Compare Selected for two text files', async () => {
    const { moveTo, remove, compare: cmp } = await ready({ compare: compare() })
    click('a.txt')
    click('b.txt', { ctrlKey: true })
    rightClick('b.txt')
    expect(screen.queryByRole('menuitem', { name: /^Rename/ })).toBeNull()
    fireEvent.click(menuItem('Move 2 Items to…'))
    expect(moveTo).toHaveBeenCalledWith([expect.objectContaining({ path: 'a.txt' }), expect.objectContaining({ path: 'b.txt' })])
    rightClick('a.txt')
    fireEvent.click(menuItem(/^Delete 2 Items/))
    expect(remove).toHaveBeenCalledWith([expect.objectContaining({ path: 'a.txt' }), expect.objectContaining({ path: 'b.txt' })])
    rightClick('a.txt')
    fireEvent.click(menuItem('Compare Selected'))
    expect(cmp!.pair).toHaveBeenCalledWith(expect.objectContaining({ path: 'a.txt' }), expect.objectContaining({ path: 'b.txt' }))
  })

  it('offers no Compare Selected for three rows, or when one is not a text, and no change in a tree that cannot be changed', async () => {
    await ready({ compare: compare() })
    click('a.txt')
    click('b.txt', { ctrlKey: true })
    click('c.md', { ctrlKey: true })
    rightClick('a.txt')
    expect(screen.queryByRole('menuitem', { name: 'Compare Selected' })).toBeNull()
    expect(menuItem(/^Delete 3 Items/)).toBeTruthy()
    cleanup()
    await ready({ compare: compare() })
    click('a.txt')
    click('pic.png', { ctrlKey: true })
    rightClick('a.txt')
    expect(screen.queryByRole('menuitem', { name: 'Compare Selected' })).toBeNull()
    cleanup()
    await ready({ compare: compare(), writable: false })
    click('a.txt')
    click('b.txt', { ctrlKey: true })
    rightClick('a.txt')
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
    expect(menuItem('Compare Selected')).toBeTruthy()
  })

  it('a right click on a row that is not marked clears the marks and shows the menu of that row alone', async () => {
    await ready()
    click('a.txt')
    click('b.txt', { ctrlKey: true })
    rightClick('c.md')
    expect(marked()).toEqual([])
    expect(menuItem(/^Rename/)).toBeTruthy()
  })

  it('dragging a marked row takes all the marked rows: dropped on a folder they are moved (those already in it stay), with Shift copied', async () => {
    const { move, copyTo } = await ready()
    fireEvent.click(row('docs'))
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'readme.md' })).toBeTruthy())
    click('a.txt')
    click('b.txt', { ctrlKey: true })
    click('z.txt', { ctrlKey: true })
    const store = new Map<string, string>()
    fireEvent.dragStart(row('b.txt'), { dataTransfer: { setData: (type: string, value: string) => store.set(type, value), effectAllowed: '' } })
    const payload = JSON.parse(store.get(ENTRY_DRAG)!)
    expect(payload).toEqual({ rootId: 'r1', path: 'b.txt', paths: ['docs/z.txt', 'a.txt', 'b.txt'] })
    // (A file dragged with others is not a file to drop on the editor.)
    expect(store.has('application/x-folder-browser-file')).toBe(false)
    const data = { dataTransfer: { types: [ENTRY_DRAG], getData: (type: string) => (type === ENTRY_DRAG ? store.get(ENTRY_DRAG)! : ''), dropEffect: '' } }
    fireEvent.drop(row('docs'), data)
    expect(move).toHaveBeenCalledWith(['a.txt', 'b.txt'], 'docs')
    const shifted = createEvent.drop(row('docs'), data)
    Object.defineProperty(shifted, 'shiftKey', { value: true })
    fireEvent(row('docs'), shifted)
    expect(copyTo).toHaveBeenCalledWith(['docs/z.txt', 'a.txt', 'b.txt'], 'docs')
    // Dropped on the empty part (the root), only what is not in the root is moved.
    move.mockClear()
    fireEvent.drop(screen.getByRole('tree'), data)
    expect(move).toHaveBeenCalledWith(['docs/z.txt'], '')
  })

  it('dragging a row that is not marked drags only that row and clears the marks', async () => {
    await ready()
    click('a.txt')
    click('b.txt', { ctrlKey: true })
    const store = new Map<string, string>()
    fireEvent.dragStart(row('c.md'), { dataTransfer: { setData: (type: string, value: string) => store.set(type, value), effectAllowed: '' } })
    expect(JSON.parse(store.get(ENTRY_DRAG)!).paths).toEqual(['c.md'])
    expect(marked()).toEqual([])
  })

  it('a mark goes with its row: when its folder is closed, or the row is not listed any more', async () => {
    await ready()
    fireEvent.click(row('docs'))
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'z.txt' })).toBeTruthy())
    click('a.txt')
    click('z.txt', { ctrlKey: true })
    expect(marked()).toEqual(['z.txt', 'a.txt'])
    fireEvent.focus(row('docs'))
    fireEvent.keyDown(row('docs'), { key: 'ArrowLeft' })
    await waitFor(() => expect(marked()).toEqual(['a.txt']))
  })
})

describe('ExplorerTree: cut, copy and paste', () => {
  const lists: Record<string, ListResult> = {
    '': { entries: [entry('docs', 'dir'), entry('a.txt', 'file'), entry('b.txt', 'file'), entry('p.zip', 'zip')], truncated: false },
    docs: { entries: [entry('readme.md', 'file', 'docs')], truncated: false },
  }
  const row = (name: string) => screen.getByRole('treeitem', { name })
  const menuItem = (name: string | RegExp) => screen.getByRole('menuitem', { name })
  const ready = async (options: Parameters<typeof show>[0] = {}) => {
    const shown = show({ lists, writable: true, ...options })
    await waitFor(() => expect(names()).toHaveLength(4))
    return shown
  }
  const key = (name: string, k: string, init: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = { ctrlKey: true }) => {
    const event = createEvent.keyDown(row(name), { key: k, ...init })
    fireEvent(row(name), event)
    return event.defaultPrevented
  }

  it('Ctrl+C and Ctrl+X take the row that has the focus (⌘ on a Mac), and Ctrl+V pastes into the folder that has it, or next to the file', async () => {
    const { paste } = await ready()
    fireEvent.focus(row('a.txt'))
    expect(key('a.txt', 'c')).toBe(true)
    expect(fileClipboard.get()).toEqual({ rootId: 'r1', paths: ['a.txt'], mode: 'copy' })
    fireEvent.focus(row('docs'))
    expect(key('docs', 'v')).toBe(true)
    expect(paste).toHaveBeenLastCalledWith('docs')
    fireEvent.focus(row('b.txt'))
    expect(key('b.txt', 'x', { metaKey: true })).toBe(true)
    expect(fileClipboard.get()).toEqual({ rootId: 'r1', paths: ['b.txt'], mode: 'cut' })
    expect(key('b.txt', 'v', { metaKey: true })).toBe(true)
    expect(paste).toHaveBeenLastCalledWith('')
    // A ZIP file is a place to paste into.
    fireEvent.focus(row('p.zip'))
    key('p.zip', 'v')
    expect(paste).toHaveBeenLastCalledWith('p.zip')
  })

  it('takes all the marked rows, the ones in a marked folder left out, and dims the rows that were cut', async () => {
    await ready()
    fireEvent.click(row('docs'))
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'readme.md' })).toBeTruthy())
    fireEvent.click(row('a.txt'))
    fireEvent.click(row('docs'), { ctrlKey: true })
    fireEvent.click(row('readme.md'), { ctrlKey: true })
    fireEvent.click(row('b.txt'), { ctrlKey: true })
    key('b.txt', 'x')
    expect(fileClipboard.get()).toEqual({ rootId: 'r1', paths: ['docs', 'a.txt', 'b.txt'], mode: 'cut' })
    await waitFor(() => expect(row('b.txt').className).toContain('opacity-60'))
    expect(row('readme.md').className).toContain('opacity-60')
    expect(row('p.zip').className).not.toContain('opacity-60')
  })

  it('does nothing, and leaves the key to the browser, where nothing can be changed, where nothing is to be pasted, and in the name field', async () => {
    await ready({ writable: false })
    fireEvent.focus(row('a.txt'))
    expect(key('a.txt', 'c')).toBe(false)
    expect(key('a.txt', 'v')).toBe(false)
    expect(fileClipboard.get()).toBeNull()
    cleanup()
    const { paste } = await ready()
    fireEvent.focus(row('a.txt'))
    expect(key('a.txt', 'v')).toBe(false)
    expect(paste).not.toHaveBeenCalled()
    // F2 puts a field in the row: Ctrl+C there is the field's own.
    fireEvent.keyDown(row('a.txt'), { key: 'F2' })
    const field = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.keyDown(field, { key: 'c', ctrlKey: true })
    expect(fileClipboard.get()).toBeNull()
  })

  it('the menu of a file or folder has Cut, Copy and, once something is taken, Paste; a menu on marked rows too', async () => {
    const { paste } = await ready()
    fireEvent.contextMenu(row('a.txt'))
    expect(screen.queryByRole('menuitem', { name: /^Paste/ })).toBeNull()
    fireEvent.click(menuItem(/^Copy(?! Path| Name)/))
    expect(fileClipboard.get()).toEqual({ rootId: 'r1', paths: ['a.txt'], mode: 'copy' })
    fireEvent.contextMenu(row('docs'))
    fireEvent.click(menuItem(/^Paste/))
    expect(paste).toHaveBeenLastCalledWith('docs')
    fireEvent.contextMenu(row('b.txt'))
    fireEvent.click(menuItem(/^Paste/))
    expect(paste).toHaveBeenLastCalledWith('')
    fireEvent.contextMenu(row('b.txt'))
    fireEvent.click(menuItem(/^Cut/))
    expect(fileClipboard.get()).toEqual({ rootId: 'r1', paths: ['b.txt'], mode: 'cut' })
    // Marked rows.
    fireEvent.click(row('a.txt'))
    fireEvent.click(row('b.txt'), { ctrlKey: true })
    fireEvent.contextMenu(row('b.txt'))
    fireEvent.click(menuItem(/^Copy(?! Path| Name)/))
    expect(fileClipboard.get()).toEqual({ rootId: 'r1', paths: ['a.txt', 'b.txt'], mode: 'copy' })
  })

  it('the empty part of the tree pastes into the root, and has no Paste while nothing is taken', async () => {
    const { paste } = await ready()
    fireEvent.contextMenu(screen.getByRole('tree'))
    expect(screen.queryByRole('menuitem', { name: /^Paste/ })).toBeNull()
    cleanup()
    fileClipboard.set({ rootId: 'r1', paths: ['a.txt'], mode: 'copy' })
    const second = await ready()
    fireEvent.contextMenu(screen.getByRole('tree'))
    fireEvent.click(menuItem(/^Paste/))
    expect(second.paste).toHaveBeenCalledWith('')
    expect(paste).not.toHaveBeenCalled()
  })

  it('has no Cut, Copy or Paste in a tree that cannot be changed', async () => {
    fileClipboard.set({ rootId: 'r1', paths: ['a.txt'], mode: 'copy' })
    await ready({ writable: false })
    fireEvent.contextMenu(row('a.txt'))
    expect(screen.queryByRole('menuitem', { name: /^Cut/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Paste/ })).toBeNull()
  })
})

describe('ExplorerTree: open as the root of the Files', () => {
  const lists: Record<string, ListResult> = {
    '': { entries: [entry('docs', 'dir'), entry('a.txt', 'file'), entry('pack.zip', 'zip')], truncated: false },
    docs: { entries: [entry('readme.md', 'file', 'docs')], truncated: false },
    'pack.zip': { entries: [entry('inner', 'dir', 'pack.zip!', { path: 'pack.zip!/inner' })], truncated: false },
  }
  const row = (name: string) => screen.getByRole('treeitem', { name })
  const rightClick = (name: string) => fireEvent.contextMenu(row(name))
  const menuItem = (name: string | RegExp) => screen.getByRole('menuitem', { name })
  const ready = async (options: Parameters<typeof show>[0] = {}) => {
    const shown = show({ lists, ...options })
    await waitFor(() => expect(names()).toHaveLength(3))
    return shown
  }

  it('is in the menu of a folder and of a ZIP file of the disk, and makes it the root of the Files', async () => {
    const { openAsRoot } = await ready()
    rightClick('docs')
    fireEvent.click(menuItem('Open as Explorer Root'))
    expect(openAsRoot).toHaveBeenLastCalledWith('docs')
    rightClick('pack.zip')
    fireEvent.click(menuItem('Open as Explorer Root'))
    expect(openAsRoot).toHaveBeenLastCalledWith('pack.zip')
  })

  it('is not in the menu of a file, of a folder inside a ZIP, of a tree that is a ZIP, or of the trash', async () => {
    await ready()
    rightClick('a.txt')
    expect(screen.queryByRole('menuitem', { name: 'Open as Explorer Root' })).toBeNull()
    cleanup()
    await ready()
    fireEvent.click(row('pack.zip'))
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'inner' })).toBeTruthy())
    rightClick('inner')
    expect(screen.queryByRole('menuitem', { name: 'Open as Explorer Root' })).toBeNull()
    cleanup()
    await ready({ kind: 'zip' })
    rightClick('docs')
    expect(screen.queryByRole('menuitem', { name: 'Open as Explorer Root' })).toBeNull()
    cleanup()
    await ready({ trash: true })
    rightClick('docs')
    expect(screen.queryByRole('menuitem', { name: 'Open as Explorer Root' })).toBeNull()
  })
})
