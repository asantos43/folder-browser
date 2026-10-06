import type { OpResult, DirEntry, ListResult, Place, PlacesData, RootInfo } from '@core/api.ts'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { showHidden, sortDescending, sortKey } from '@/state/setting.ts'
import { sortMenuEntries } from './sortMenu.ts'
import { MenuList, useDismiss } from '@/components/Menu.tsx'
import type { Action, Workspace } from '@/state/workspace.ts'
import type { SortKey } from '@core/fs/sort.ts'
import { ExplorerTree } from './ExplorerTree.tsx'
import { PlacesView } from './PlacesView.tsx'

function Section({ title, children, defaultOpen = true, actions }: { title: string; children?: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-t border-section-border first:border-t-0">
      <div className="group flex h-[22px] items-center hover:bg-list-hover">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-full min-w-0 flex-1 items-center gap-0.5 pl-0.5 text-left text-[11px] font-bold uppercase text-sidebar-fg">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} className="text-[16px]" />
          <span className="truncate">{title}</span>
        </button>
        {actions}
      </div>
      {open ? <div>{children}</div> : null}
    </section>
  )
}

/** The button that says how the files are ordered, and opens the choices (by name, by date, by size; which way). Always in sight: it is what a folder is browsed by. */
function SortButton({ by, descending }: { by: SortKey; descending: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  const label = t('sort.button', { by: t(`sort.${by}`), way: t(descending ? 'sort.wayDescending' : 'sort.wayAscending') })
  return (
    <div ref={ref} className="relative">
      <button type="button" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="mr-1 flex h-[22px] items-center justify-center gap-0.5 rounded px-1 opacity-80 hover:bg-toolbar-hover hover:opacity-100 focus-visible:opacity-100">
        <Icon name="sort-precedence" className="text-[16px]" />
        <Icon name={descending ? 'arrow-down' : 'arrow-up'} className="text-[12px]" />
      </button>
      {open ? (
        <div className="absolute top-[22px] right-0 z-50 text-[13px]">
          <MenuList entries={sortMenuEntries(t, by, descending, { key: (k) => (sortKey.set(k), close()), descending: (d) => (sortDescending.set(d), close()) })} label={t('sort.by')} onClose={close} autoSelect />
        </div>
      ) : null}
    </div>
  )
}

export interface SideBarActions {
  openFolder: () => void
  listDir: (rootId: string, path: string) => Promise<ListResult>
  openRootFile: (rootId: string, entry: Pick<DirEntry, 'path' | 'size'>, keep: boolean, as?: 'hex') => void
  reveal: (rootId: string, path: string) => void
  closeRoot: (rootId: string) => void
  openPlace: (place: Place) => void
  removeFavorite: (folder: string) => void
  moveFavorite: (folder: string, to: number) => void
  clearRecentFolders: () => void
  pinFolder: (rootId: string, path: string) => void
  restoreTrash: (rootId: string, path: string) => void
  emptyTrash: (rootId: string) => void
  openDefault: (rootId: string, path: string) => void
  properties: (root: RootInfo, entry: DirEntry) => void
  /** A `.wsnp` of a folder, as a snapshot. */
  openSnapshot: (rootId: string, path: string, keep: boolean) => void
  saveFile: (snapshotId: string, path: string) => void
  openWith: (snapshotId: string, path: string) => void
  copy: (text: string) => void
  /** The files of a folder that was opened: made, renamed, moved, deleted (core/fs/ops.ts). */
  createEntry: (rootId: string, parent: string, name: string, kind: 'file' | 'dir') => Promise<OpResult>
  renameEntry: (rootId: string, path: string, name: string) => Promise<OpResult>
  moveEntry: (rootId: string, path: string, toFolder: string) => void
  /** A copy of an item in a folder (a drop with Shift held). */
  copyEntry: (rootId: string, path: string, toFolder: string) => void
  /** Asks where to move an item to. */
  moveEntryTo: (rootId: string, entry: DirEntry) => void
  /** Asks, and moves an item to the trash. */
  removeEntry: (rootId: string, entry: DirEntry, forever?: boolean) => void
}

/** The side bar: the places, the folders (and ZIP files) that are open, and the files of the one chosen, as a tree. (A snapshot is a page in a tab, not something the side bar is about.) */
export function SideBar({ ws, dispatch, actions, places, treeVersion }: { /** The places of the side bar, once the main process has listed them. */ places: PlacesData | null; /** Changes when something outside the tree changed what it lists (the trash was emptied). */ treeVersion: number; ws: Workspace; dispatch: (a: Action) => void; actions: SideBarActions }) {
  const { t } = useI18n()
  const root = ws.selected ? ws.roots[ws.selected] : undefined
  const hidden = showHidden.use()
  const by = sortKey.use()
  const descending = sortDescending.use()
  const [refreshToken, setRefreshToken] = useState(0)
  const [createRequest, setCreateRequest] = useState<{ kind: 'file' | 'dir'; token: number } | undefined>(undefined)
  const rootIds = Object.keys(ws.roots)
  const activeTab = ws.tabs.find((tab) => tab.key === ws.active)
  // The file of the tab on screen, when it is of the folder the tree shows (the tree opens ZIP files like folders, so the whole path is a place in it).
  const activePath = activeTab && activeTab.snapshotId === ws.selected ? activeTab.path : undefined
  const iconButton = 'mr-1 flex h-[22px] w-[22px] items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-toolbar-hover focus-visible:opacity-100'

  return (
    <aside aria-label={t('sidebar.snapshots')} className="flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-fg">
      <h2 className="m-0 flex h-[35px] shrink-0 items-center pl-5 text-[11px] font-normal uppercase text-sidebar-title">{t('sidebar.snapshots')}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={t('places.title')}>
          <PlacesView
            data={places}
            activePath={root?.path}
            actions={{ open: actions.openPlace, removeFavorite: actions.removeFavorite, moveFavorite: actions.moveFavorite, clearRecent: actions.clearRecentFolders, pin: actions.pinFolder }}
          />
        </Section>
        <Section
          title={t('sidebar.openFolders')}
          actions={
            <button type="button" title={t('menu.openFolder')} aria-label={t('menu.openFolder')} onClick={actions.openFolder} className={iconButton}>
              <Icon name="new-folder" className="text-[16px]" />
            </button>
          }
        >
          {rootIds.length ? (
            <ul role="listbox" aria-label={t('sidebar.openFolders')} className="m-0 list-none p-0 py-0.5">
              {rootIds.map((id) => (
                <li
                  key={id}
                  role="option"
                  aria-selected={id === ws.selected}
                  tabIndex={0}
                  title={ws.roots[id].path}
                  onClick={() => dispatch({ type: 'select', snapshotId: id })}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && dispatch({ type: 'select', snapshotId: id })}
                  className={`group/row flex h-[22px] cursor-pointer items-center gap-1.5 pr-1 pl-5 text-[13px] outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus ${id === ws.selected ? 'bg-list-inactive' : 'hover:bg-list-hover'}`}
                >
                  <Icon name={ws.roots[id].kind === 'zip' ? 'file-zip' : 'folder'} className="shrink-0 text-[16px]" />
                  <span className="min-w-0 flex-1 truncate">{ws.roots[id].name}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t('tree.closeFolder')}
                    title={t('tree.closeFolder')}
                    onClick={(e) => {
                      e.stopPropagation()
                      actions.closeRoot(id)
                    }}
                    className="flex h-[18px] w-[18px] items-center justify-center rounded opacity-0 group-hover/row:opacity-100 hover:bg-toolbar-hover"
                  >
                    <Icon name="close" className="text-[14px]" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-1.5" title={t('sidebar.openFolderHint')}>
              <p className="m-0 mb-1.5 text-fg-muted">{t('sidebar.noFolder')}</p>
              <button type="button" onClick={actions.openFolder} className="h-[26px] w-full rounded-sm bg-button px-3 text-[13px] text-button-fg hover:bg-button-hover">
                {t('sidebar.openFolder')}
              </button>
            </div>
          )}
        </Section>
        {root ? (
        <Section
          title={`${t('sidebar.files')} — ${root.name}`}
          actions={
            (
              <>
                {root.kind === 'folder' && !root.trash ? (
                  <>
                    <button type="button" title={t('tree.newFile')} aria-label={t('tree.newFile')} onClick={() => setCreateRequest((c) => ({ kind: 'file', token: (c?.token ?? 0) + 1 }))} className={iconButton}>
                      <Icon name="new-file" className="text-[16px]" />
                    </button>
                    <button type="button" title={t('tree.newFolder')} aria-label={t('tree.newFolder')} onClick={() => setCreateRequest((c) => ({ kind: 'dir', token: (c?.token ?? 0) + 1 }))} className={iconButton}>
                      <Icon name="new-folder" className="text-[16px]" />
                    </button>
                  </>
                ) : null}
                <SortButton by={by} descending={descending} />
                {root.trash ? (
                  <button type="button" title={t('tree.emptyTrash')} aria-label={t('tree.emptyTrash')} onClick={() => actions.emptyTrash(root.id)} className={iconButton}>
                    <Icon name="trash" className="text-[16px]" />
                  </button>
                ) : null}
                <button type="button" title={hidden ? t('tree.hideHidden') : t('menu.showHidden')} aria-label={hidden ? t('tree.hideHidden') : t('menu.showHidden')} aria-pressed={hidden} onClick={() => showHidden.set(!hidden)} className={iconButton}>
                  <Icon name={hidden ? 'eye' : 'eye-closed'} className="text-[16px]" />
                </button>
                <button type="button" title={t('tree.refresh')} aria-label={t('tree.refresh')} onClick={() => setRefreshToken((n) => n + 1)} className={iconButton}>
                  <Icon name="refresh" className="text-[16px]" />
                </button>
              </>
            )
          }
        >
            <ExplorerTree
              key={root.id}
              rootId={root.id}
              rootKind={root.kind}
              trash={root.trash === true}
              writable={root.kind === 'folder' && root.trash !== true}
              createRequest={createRequest}
              activePath={activePath}
              showHidden={hidden}
              sortKey={by}
              sortDescending={descending}
              refreshToken={refreshToken + treeVersion}
              actions={{
                listDir: (path) => actions.listDir(root.id, path),
                open: (entry, keep, as) => actions.openRootFile(root.id, entry, keep, as),
                openSnapshot: (entry, keep) => actions.openSnapshot(root.id, entry.path, keep),
                openWith: (path) => actions.openWith(root.id, path),
                openDefault: (path) => actions.openDefault(root.id, path),
                properties: (entry) => actions.properties(root, entry),
                pin: (path) => actions.pinFolder(root.id, path),
                restore: (path) => actions.restoreTrash(root.id, path),
                save: (path) => actions.saveFile(root.id, path),
                copy: actions.copy,
                reveal: (path) => actions.reveal(root.id, path),
                create: (parent, name, kind) => actions.createEntry(root.id, parent, name, kind),
                rename: (path, name) => actions.renameEntry(root.id, path, name),
                move: (path, toFolder) => actions.moveEntry(root.id, path, toFolder),
                copyTo: (path, toFolder) => actions.copyEntry(root.id, path, toFolder),
                moveTo: (entry) => actions.moveEntryTo(root.id, entry),
                remove: (entry, forever) => actions.removeEntry(root.id, entry, forever),
              }}
            />
        </Section>
        ) : null}
      </div>
    </aside>
  )
}
