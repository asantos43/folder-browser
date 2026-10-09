// @vitest-environment happy-dom
import type { DirEntry, ListResult, OpResult, Place, PlacesData } from '@core/api.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RootInfo } from '@core/roots.ts'
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
