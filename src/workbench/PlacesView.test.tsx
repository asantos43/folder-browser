// @vitest-environment happy-dom
import type { Place, PlacesData } from '@core/api.ts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { FOLDER_DRAG, PlacesView } from './PlacesView.tsx'

afterEach(cleanup)

const p = (kind: Place['kind'], path: string, name = path.split('/').at(-1) || path): Place => ({ id: `${kind}:${path}`, kind, name, path })
const data: PlacesData = {
  places: [p('home', '/home/me'), p('documents', '/home/me/Documents'), p('trash', '/home/me/.local/share/Trash/files')],
  favorites: [p('favorite', '/home/me/work'), p('favorite', '/srv/data')],
  recent: [p('recent', '/tmp/x')],
  volumes: [p('volume', '/run/media/me/USB', 'USB')],
}
function show(value: PlacesData | null = data, activePath?: string) {
  const actions = { open: vi.fn(), removeFavorite: vi.fn(), moveFavorite: vi.fn(), clearRecent: vi.fn(), pin: vi.fn() }
  render(
    <I18nProvider language="en">
      <PlacesView data={value} activePath={activePath} actions={actions} />
    </I18nProvider>,
  )
  return actions
}

describe('PlacesView', () => {
  it('has the places, the favourites, the recent folders and the devices, by name', () => {
    show()
    expect(screen.getAllByRole('listbox').map((l) => l.getAttribute('aria-label'))).toEqual(['Places', 'Favorites', 'Recent Folders', 'Devices'])
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Home', 'Documents', 'Trash', 'work', 'data', 'x', 'USB'])
  })
  it('says the name of a fixed place in the language of the interface, and the folder name for the others', () => {
    cleanup()
    render(
      <I18nProvider language="pt-BR">
        <PlacesView data={data} activePath={undefined} actions={{ open: vi.fn(), removeFavorite: vi.fn(), moveFavorite: vi.fn(), clearRecent: vi.fn(), pin: vi.fn() }} />
      </I18nProvider>,
    )
    expect(screen.getByRole('option', { name: 'Documentos' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Lixeira' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'work' })).toBeTruthy()
  })
  it('opens a place with a click, and lights the one that is open', () => {
    const { open } = show(data, '/home/me/Documents')
    fireEvent.click(screen.getByRole('option', { name: 'Documents' }))
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'documents', path: '/home/me/Documents' }))
    expect(screen.getByRole('option', { name: 'Documents' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('option', { name: 'Home' }).getAttribute('aria-selected')).toBe('false')
  })
  it('hides the groups with nothing in them, but keeps Favorites, which says how to fill it', () => {
    show({ places: [p('home', '/h')], favorites: [], recent: [], volumes: [] })
    expect(screen.getAllByRole('listbox').map((l) => l.getAttribute('aria-label'))).toEqual(['Places'])
    expect(screen.getByText('Favorites')).toBeTruthy()
    expect(screen.getByText('Drop a folder here to pin it.')).toBeTruthy()
  })
  it('removes and moves a favourite from its menu, and the first cannot go up', () => {
    const { removeFavorite, moveFavorite } = show()
    fireEvent.contextMenu(screen.getByRole('option', { name: 'work' }))
    expect((screen.getByRole('menuitem', { name: 'Move Up' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Down' }))
    expect(moveFavorite).toHaveBeenCalledWith('/home/me/work', 1)
    fireEvent.contextMenu(screen.getByRole('option', { name: 'data' }))
    expect((screen.getByRole('menuitem', { name: 'Move Down' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Favorites' }))
    expect(removeFavorite).toHaveBeenCalledWith('/srv/data')
  })
  it('clears the recent folders from the menu of one, and a fixed place has only Open', () => {
    const { clearRecent } = show()
    fireEvent.contextMenu(screen.getByRole('option', { name: 'x' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear Recent Folders' }))
    expect(clearRecent).toHaveBeenCalled()
    fireEvent.contextMenu(screen.getByRole('option', { name: 'Home' }))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open'])
  })
  it('pins a folder dropped on the favourites, and takes nothing else', () => {
    const { pin } = show()
    const favorites = screen.getByRole('listbox', { name: 'Favorites' }).parentElement!
    const drop = (type: string, data: string) => fireEvent.drop(favorites, { dataTransfer: { types: [type], getData: (t: string) => (t === type ? data : '') } })
    drop(FOLDER_DRAG, JSON.stringify({ rootId: 'r1', path: 'docs/deep' }))
    expect(pin).toHaveBeenCalledWith('r1', 'docs/deep')
    pin.mockClear()
    drop(FOLDER_DRAG, 'not json')
    drop(FOLDER_DRAG, JSON.stringify({ rootId: 3, path: 'x' }))
    drop('text/plain', 'x')
    expect(pin).not.toHaveBeenCalled()
    const places = screen.getByRole('listbox', { name: 'Places' }).parentElement!
    fireEvent.drop(places, { dataTransfer: { types: [FOLDER_DRAG], getData: () => JSON.stringify({ rootId: 'r1', path: 'a' }) } })
    expect(pin).not.toHaveBeenCalled()
  })
  it('shows nothing until the places are known', () => {
    show(null)
    expect(screen.queryAllByRole('listbox')).toHaveLength(0)
  })
})
