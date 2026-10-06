// @vitest-environment happy-dom
import type { DirEntry, ListResult } from '@core/api.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { ExplorerTree } from './ExplorerTree.tsx'

afterEach(cleanup)

const entry = (name: string, kind: DirEntry['kind'], dir = '', extra: Partial<DirEntry> = {}): DirEntry => ({ name, path: dir ? `${dir}/${name}` : name, kind, size: kind === 'dir' ? 0 : 10, modified: '2026-01-01T00:00:00.000Z', hidden: name.startsWith('.'), ...extra })
const disk: Record<string, ListResult> = {
  '': { entries: [entry('.git', 'dir'), entry('docs', 'dir'), entry('.env', 'file'), entry('a.txt', 'file'), entry('pack.zip', 'zip')], truncated: false },
  docs: { entries: [entry('readme.md', 'file', 'docs')], truncated: false },
  '.git': { entries: [], truncated: false },
  'pack.zip': { entries: [entry('src', 'dir', 'pack.zip!', { path: 'pack.zip!/src' })], truncated: false },
  'pack.zip!/src': { entries: [entry('main.c', 'file', 'pack.zip!/src', { path: 'pack.zip!/src/main.c' })], truncated: false },
  locked: { error: 'denied' },
}

function show({ showHidden = false, activePath, refreshToken = 0, lists = disk }: { showHidden?: boolean; activePath?: string; refreshToken?: number; lists?: Record<string, ListResult> } = {}) {
  const listDir = vi.fn(async (path: string) => lists[path] ?? ({ error: 'no-dir' } as ListResult))
  const actions = { listDir, open: vi.fn(), openWith: vi.fn(), save: vi.fn(), copy: vi.fn(), reveal: vi.fn() }
  const tree = (props: { showHidden: boolean; activePath?: string; refreshToken: number }) => (
    <I18nProvider language="en">
      <ExplorerTree actions={actions} {...props} />
    </I18nProvider>
  )
  const view = render(tree({ showHidden, activePath, refreshToken }))
  return { ...actions, view, again: (props: { showHidden: boolean; activePath?: string; refreshToken: number }) => view.rerender(tree(props)) }
}
const names = () => screen.queryAllByRole('treeitem').map((r) => r.textContent)

describe('ExplorerTree', () => {
  it('reads the root alone, and lists folders first without the hidden ones', async () => {
    const { listDir } = show()
    await waitFor(() => expect(names()).toEqual(['docs', 'a.txt', 'pack.zip']))
    expect(listDir).toHaveBeenCalledTimes(1)
    expect(listDir).toHaveBeenCalledWith('')
    expect(screen.getByRole('tree').getAttribute('aria-label')).toBe('Files and folders')
  })
  it('shows the hidden ones, dimmed, when the switch is on, without asking the main process again', async () => {
    const { listDir, again } = show()
    await waitFor(() => expect(names()).toHaveLength(3))
    again({ showHidden: true, refreshToken: 0 })
    expect(names()).toEqual(['.git', 'docs', '.env', 'a.txt', 'pack.zip'])
    expect(screen.getByRole('treeitem', { name: '.env' }).className).toContain('opacity-60')
    expect(listDir).toHaveBeenCalledTimes(1)
  })
  it('reads a folder when it is opened, and not before', async () => {
    const { listDir } = show()
    await waitFor(() => expect(names()).toHaveLength(3))
    fireEvent.click(screen.getByRole('treeitem', { name: 'docs' }))
    await waitFor(() => expect(names()).toEqual(['docs', 'readme.md', 'a.txt', 'pack.zip']))
    expect(listDir).toHaveBeenCalledWith('docs')
    expect(screen.getByRole('treeitem', { name: 'docs' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('treeitem', { name: 'docs' }))
    expect(names()).toEqual(['docs', 'a.txt', 'pack.zip'])
  })
  it('opens a ZIP like a folder, and the folders in it', async () => {
    show()
    await waitFor(() => expect(names()).toHaveLength(3))
    fireEvent.click(screen.getByRole('treeitem', { name: 'pack.zip' }))
    await waitFor(() => expect(names()).toContain('src'))
    fireEvent.click(screen.getByRole('treeitem', { name: 'src' }))
    await waitFor(() => expect(names()).toContain('main.c'))
  })
  it('opens a file in a preview tab with a click and keeps it with a double click, handing over its size', async () => {
    const { open } = show()
    await waitFor(() => expect(names()).toHaveLength(3))
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
    await waitFor(() => expect(names()).toHaveLength(3))
    fireEvent.click(screen.getByRole('treeitem', { name: 'docs' }))
    await waitFor(() => expect(names()).toContain('readme.md'))
    listDir.mockClear()
    again({ showHidden: false, refreshToken: 1 })
    await waitFor(() => expect(listDir).toHaveBeenCalledWith('docs'))
    expect(listDir).toHaveBeenCalledWith('')
  })
  it('moves with the arrows, opens with the right arrow and types to a name', async () => {
    show()
    await waitFor(() => expect(names()).toHaveLength(3))
    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    await waitFor(() => expect(names()).toContain('readme.md'))
    fireEvent.keyDown(tree, { key: 'p' })
    expect(document.activeElement?.getAttribute('data-path')).toBe('pack.zip')
  })
  it('lists the rows of the context menu by kind: a ZIP can be opened as a list', async () => {
    const { open } = show()
    await waitFor(() => expect(names()).toHaveLength(3))
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'pack.zip' }))
    expect(screen.getByRole('menuitem', { name: 'Open as List' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open as List' }))
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: 'pack.zip', kind: 'zip' }), true)
  })
})
