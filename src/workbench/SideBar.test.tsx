// @vitest-environment happy-dom
import type { DirEntry, ListResult, OpResult, Place, PlacesData } from '@core/api.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RootInfo } from '@core/roots.ts'
import type { SnapshotInfo } from '@core/snapshots.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@/state/workspace.ts'
import { empty } from '@/state/workspace.ts'
import { I18nProvider } from '@/i18n/context.tsx'
import { SideBar, type SideBarActions } from './SideBar.tsx'

afterEach(cleanup)

const root: RootInfo = { id: 'r1', kind: 'folder', path: '/tmp/example', name: 'example' }
const ws: Workspace = { ...empty, selected: 'r1', roots: { r1: root } }
const places: PlacesData = {
  places: [p('home', '/home/me')] as Place[],
  volumes: [],
  recent: [],
  favorites: [],
}
function p(kind: Place['kind'], path: string, name = path.split('/').at(-1) || path): Place {
  return { id: `${kind}:${path}`, kind, name, path }
}

const actions = (): SideBarActions => ({
  openFolder: vi.fn(),
  openZip: vi.fn(),
  openAsRoot: vi.fn(),
  listDir: vi.fn(async () => ({ entries: [], truncated: false }) as ListResult),
  openRootFile: vi.fn(),
  reveal: vi.fn(),
  closeRoot: vi.fn(),
  openPlace: vi.fn(),
  removeFavorite: vi.fn(),
  moveFavorite: vi.fn(),
  clearRecentFolders: vi.fn(),
  pinFolder: vi.fn(),
  restoreTrash: vi.fn(),
  emptyTrash: vi.fn(),
  openDefault: vi.fn(),
  properties: (_r, _e: DirEntry) => vi.fn(),
  openSnapshot: vi.fn(),
  saveFile: vi.fn(),
  openWith: vi.fn(),
  copy: vi.fn(),
  createEntry: vi.fn(async () => ({ ok: true, path: 'x' }) as OpResult),
  renameEntry: vi.fn(async () => ({ ok: true, path: 'x' }) as OpResult),
  moveEntry: vi.fn(),
  copyEntry: vi.fn(),
  moveEntryTo: vi.fn(),
  pasteEntries: vi.fn(),
  removeEntry: vi.fn(),
  compare: { selected: null, select: vi.fn(), with: vi.fn(), pair: vi.fn(), drop: vi.fn() },
})

describe('SideBar', () => {
  it('Open Folders header button is distinct from the Files header New Folder button (different labels and icons)', () => {
    render(
      <I18nProvider language="en">
        <SideBar ws={ws} dispatch={vi.fn()} actions={actions()} places={places} treeVersion={0} />
      </I18nProvider>,
    )
    const openFolder = screen.getByRole('button', { name: 'Open Folder…' })
    const newFolder = screen.getByRole('button', { name: 'New Folder…' })
    expect(openFolder).not.toBe(newFolder)
    // The icons are different codicons — the Open Folder header and the Files header New Folder button must not share one.
    const openIcon = openFolder.querySelector('.codicon')?.className.match(/codicon-[\w-]+/)?.[0]
    const newIcon = newFolder.querySelector('.codicon')?.className.match(/codicon-[\w-]+/)?.[0]
    expect(openIcon).toBeTruthy()
    expect(newIcon).toBeTruthy()
    expect(openIcon).not.toBe(newIcon)
  })
  it('New Folder works again after the first request was handled (the token is counted by the side bar, not by the cleared request)', async () => {
    render(
      <I18nProvider language="en">
        <SideBar ws={ws} dispatch={vi.fn()} actions={actions()} places={places} treeVersion={0} />
      </I18nProvider>,
    )
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'New Folder…' }))
      const field = await waitFor(() => screen.getByRole('textbox', { name: 'Name' }))
      fireEvent.keyDown(field, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull())
    }
  })
})

describe('SideBar follows a snapshot tab to the .wsnp in the root that contains it', () => {
  const root: RootInfo = { id: 'r1', kind: 'folder', path: '/tmp/example', name: 'example' }
  const other: RootInfo = { id: 'r2', kind: 'folder', path: '/tmp/other', name: 'other' }
  const places: PlacesData = { places: [], volumes: [], recent: [], favorites: [] }
  const entry = (name: string, kind: DirEntry['kind'], dir = ''): DirEntry => ({ name, path: dir ? `${dir}/${name}` : name, kind, size: kind === 'dir' ? 0 : 10, modified: '2026-01-01T00:00:00.000Z', hidden: false })
  const lists: Record<string, ListResult> = {
    '': { entries: [entry('a.txt', 'file'), entry('sub', 'dir'), entry('page.wsnp', 'wsnp')], truncated: false },
    sub: { entries: [entry('page.wsnp', 'wsnp', 'sub')], truncated: false },
  }
  const snap = (id: string, path: string): SnapshotInfo => ({ id, path, manifest: { title: id } as SnapshotInfo['manifest'], files: [], signature: { state: 'unsigned' } })
  const showSideBar = (ws: Workspace, lists: Record<string, ListResult>) => {
    const a = actions()
    a.listDir = vi.fn(async (_rootId: string, path: string) => lists[path] ?? ({ error: 'no-dir' } as ListResult))
    render(
      <I18nProvider language="en">
        <SideBar ws={ws} dispatch={vi.fn()} actions={a} places={places} treeVersion={0} />
      </I18nProvider>,
    )
    return a
  }

  it('a snapshot tab whose .wsnp is at the root: the row of the .wsnp is the active one', async () => {
    const wsWithSnap: Workspace = { ...empty, selected: 'r1', roots: { r1: root }, snapshots: { s1: snap('s1', '/tmp/example/page.wsnp') }, tabs: [{ key: 's:s1', snapshotId: 's1', preview: false, pinned: false }], active: 's:s1' }
    showSideBar(wsWithSnap, lists)
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'page.wsnp' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('treeitem', { name: 'a.txt' }).getAttribute('aria-selected')).not.toBe('true')
  })
  it('a snapshot tab whose .wsnp is in a subfolder: the tree opens the subfolder and highlights the .wsnp', async () => {
    const wsWithSnap: Workspace = { ...empty, selected: 'r1', roots: { r1: root }, snapshots: { s2: snap('s2', '/tmp/example/sub/page.wsnp') }, tabs: [{ key: 's:s2', snapshotId: 's2', preview: false, pinned: false }], active: 's:s2' }
    showSideBar(wsWithSnap, lists)
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'sub' }).getAttribute('aria-expanded')).toBe('true'))
    const row = document.querySelector('[data-path="sub/page.wsnp"]') as HTMLElement
    expect(row.getAttribute('aria-selected')).toBe('true')
  })
  it('a file tab inside the snapshot takes the same root, and the .wsnp is the highlighted row', async () => {
    const wsWithSnap: Workspace = { ...empty, selected: 'r1', roots: { r1: root }, snapshots: { s3: snap('s3', '/tmp/example/page.wsnp') }, tabs: [{ key: 'f:s3:manifest.json', snapshotId: 's3', path: 'manifest.json', preview: false, pinned: false }], active: 'f:s3:manifest.json' }
    showSideBar(wsWithSnap, lists)
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'page.wsnp' }).getAttribute('aria-selected')).toBe('true'))
  })
  it('a metadata tab of the snapshot also takes the root and the .wsnp', async () => {
    const wsWithSnap: Workspace = { ...empty, selected: 'r1', roots: { r1: root }, snapshots: { s4: snap('s4', '/tmp/example/page.wsnp') }, tabs: [{ key: 'm:s4', snapshotId: 's4', view: 'metadata', preview: false, pinned: false }], active: 'm:s4' }
    showSideBar(wsWithSnap, lists)
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'page.wsnp' }).getAttribute('aria-selected')).toBe('true'))
  })
  it('a snapshot tab whose .wsnp is not in any open root: the activePath is undefined, no row is highlighted', async () => {
    const wsWithSnap: Workspace = { ...empty, selected: 'r1', roots: { r1: root, r2: other }, snapshots: { s5: snap('s5', '/elsewhere/page.wsnp') }, tabs: [{ key: 's:s5', snapshotId: 's5', preview: false, pinned: false }], active: 's:s5' }
    const a = showSideBar(wsWithSnap, lists)
    // The tree renders the listing of the selected root (r1); no open root contains the snapshot's .wsnp, so the activePath is undefined and the .wsnp row is not selected.
    await waitFor(() => expect(a.listDir).toHaveBeenCalledWith('r1', ''))
    const row = await screen.findByRole('treeitem', { name: 'page.wsnp' })
    expect(row.getAttribute('aria-selected')).not.toBe('true')
    expect(screen.queryByRole('treeitem', { name: 'sub' })?.getAttribute('aria-expanded')).not.toBe('true')
  })
})
