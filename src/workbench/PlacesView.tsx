import type { Place, PlaceKind, PlacesData } from '@core/api.ts'
import { useState, type DragEvent } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { Icon } from '@/components/Icon.tsx'
import type { MenuEntry } from '@/components/Menu.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'

/** What a tree row of a folder says when it is dragged to the favourites: the root it is in and its path there. */
export const FOLDER_DRAG = 'application/x-folder-browser-folder'

const ICONS: Record<PlaceKind, string> = { home: 'home', desktop: 'device-desktop', documents: 'book', downloads: 'cloud-download', music: 'unmute', pictures: 'file-media', videos: 'device-camera-video', trash: 'trash', computer: 'server', volume: 'archive', recent: 'history', favorite: 'star-full' }
const FIXED: PlaceKind[] = ['home', 'desktop', 'documents', 'downloads', 'music', 'pictures', 'videos', 'trash', 'computer']

export interface PlacesActions {
  /** A place was clicked: its folder opens as a root. */
  open: (place: Place) => void
  removeFavorite: (folder: string) => void
  moveFavorite: (folder: string, to: number) => void
  clearRecent: () => void
  /** A folder of the tree was dropped on the favourites. */
  pin: (rootId: string, path: string) => void
}

/**
 * The places of the side bar, as a file manager has them: Home, Documents, Downloads, Music, Pictures, Videos, Trash…, the folders pinned to Favorites (drop a folder of the tree on them to
 * pin it), the folders opened lately, and the mounted devices. A click opens the folder as a root of the tree; the one that is open is lit.
 */
export function PlacesView({ data, activePath, actions }: { data: PlacesData | null; activePath: string | undefined; actions: PlacesActions }) {
  const { t } = useI18n()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [over, setOver] = useState(false)
  if (!data) return null

  const label = (place: Place) => (FIXED.includes(place.kind) ? t(`places.${place.kind}` as MessageKey) : place.name)
  const contextMenu = (event: React.MouseEvent, place: Place, index: number, count: number) => {
    event.preventDefault()
    const entries: MenuEntry[] = [{ id: 'open', label: t('places.open'), run: () => actions.open(place) }]
    if (place.kind === 'favorite') {
      entries.push(
        { separator: true },
        { id: 'up', label: t('places.moveUp'), disabled: index === 0, run: () => actions.moveFavorite(place.path, index - 1) },
        { id: 'down', label: t('places.moveDown'), disabled: index === count - 1, run: () => actions.moveFavorite(place.path, index + 1) },
        { id: 'remove', label: t('places.removeFavorite'), run: () => actions.removeFavorite(place.path) },
      )
    }
    if (place.kind === 'recent') entries.push({ separator: true }, { id: 'clear', label: t('places.clearRecent'), run: actions.clearRecent })
    setMenu({ x: event.clientX, y: event.clientY, label: label(place), entries })
  }

  const row = (place: Place, index: number, list: Place[]) => (
    <li key={place.id} role="none">
      <button
        type="button"
        role="option"
        aria-selected={place.path !== '' && place.path === activePath}
        title={place.path || label(place)}
        onClick={() => actions.open(place)}
        onContextMenu={(e) => contextMenu(e, place, index, list.length)}
        className={`flex h-[22px] w-full cursor-pointer items-center gap-1.5 pr-2 pl-5 text-left text-[13px] outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus ${place.path !== '' && place.path === activePath ? 'bg-list-inactive' : 'hover:bg-list-hover'}`}
      >
        <Icon name={ICONS[place.kind]} className="shrink-0 text-[16px]" />
        <span className="min-w-0 flex-1 truncate">{label(place)}</span>
      </button>
    </li>
  )
  const group = (title: MessageKey, places: Place[], extra?: { drop?: boolean; empty?: MessageKey }) => {
    if (!places.length && !extra?.drop) return null
    return (
      <div
        key={title}
        onDragOver={(e: DragEvent) => {
          if (extra?.drop && e.dataTransfer.types.includes(FOLDER_DRAG)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'link'
            setOver(true)
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          setOver(false)
          const raw = extra?.drop ? e.dataTransfer.getData(FOLDER_DRAG) : ''
          if (!raw) return
          e.preventDefault()
          try {
            const { rootId, path } = JSON.parse(raw) as { rootId?: unknown; path?: unknown }
            if (typeof rootId === 'string' && typeof path === 'string') actions.pin(rootId, path)
          } catch {
            // not ours
          }
        }}
        className={extra?.drop && over ? 'bg-list-hover outline-1 -outline-offset-1 outline-focus' : ''}
      >
        <h3 className="m-0 flex h-[20px] items-center pl-5 text-[11px] font-normal uppercase text-sidebar-title">{t(title)}</h3>
        {places.length ? (
          <ul role="listbox" aria-label={t(title)} className="m-0 list-none p-0">
            {places.map((p, i) => row(p, i, places))}
          </ul>
        ) : (
          <p className="m-0 px-5 pb-1 text-[12px] text-fg-muted">{extra?.empty ? t(extra.empty) : ''}</p>
        )}
      </div>
    )
  }

  return (
    <div className="pb-1">
      {group('places.title', data.places)}
      {group('places.favorites', data.favorites, { drop: true, empty: 'places.dropHint' })}
      {group('places.recent', data.recent)}
      {group('places.devices', data.volumes)}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
