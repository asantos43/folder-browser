import type { DirEntry, ListResult } from '@core/api.ts'
import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { basename } from '@/lib/format.ts'
import { showHidden } from '@/state/setting.ts'
import { isSnapshotTab, snapshotKey, type Action, type Workspace } from '@/state/workspace.ts'
import { ExplorerTree } from './ExplorerTree.tsx'
import { FileTree } from './FileTree.tsx'
import { InfoPanel } from './InfoPanel.tsx'
import { IntegrityPanel } from './IntegrityPanel.tsx'
import type { Signers } from './signature.ts'
import { snapshotTitle } from './tabInfo.ts'

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

export interface SideBarActions {
  openFile: () => void
  openFolder: () => void
  listDir: (rootId: string, path: string) => Promise<ListResult>
  openRootFile: (rootId: string, entry: Pick<DirEntry, 'path' | 'size'>, keep: boolean) => void
  reveal: (rootId: string, path: string) => void
  closeRoot: (rootId: string) => void
  openTreeFile: (snapshotId: string, path: string, keep: boolean) => void
  saveFile: (snapshotId: string, path: string) => void
  openWith: (snapshotId: string, path: string) => void
  copy: (text: string) => void
  openExternal: (url: string) => void
  showMetadata: (snapshotId: string) => void
}

/** The side bar of the Snapshots view: the open snapshots, the files of the selected one, what its manifest says and what its integrity check found. */
export function SideBar({ ws, dispatch, actions, signers }: { ws: Workspace; dispatch: (a: Action) => void; actions: SideBarActions; signers: Signers }) {
  const { t } = useI18n()
  const ids = ws.tabs.filter(isSnapshotTab).map((tab) => tab.snapshotId)
  const selected = ws.selected ? ws.snapshots[ws.selected] : undefined
  const root = ws.selected ? ws.roots[ws.selected] : undefined
  const hidden = showHidden.use()
  const [refreshToken, setRefreshToken] = useState(0)
  const rootIds = Object.keys(ws.roots)
  const activeTab = ws.tabs.find((tab) => tab.key === ws.active)
  // A snapshot's tree lists its entries flat, so only the part before a ZIP's `!/` is a place in it; a folder's tree opens ZIP files like folders, so the whole path is.
  const activePath = activeTab && activeTab.snapshotId === ws.selected ? (root ? activeTab.path : activeTab.path?.split('!/')[0]) : undefined
  const iconButton = 'mr-1 flex h-[22px] w-[22px] items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-toolbar-hover focus-visible:opacity-100'

  return (
    <aside aria-label={t('sidebar.snapshots')} className="flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-fg">
      <h2 className="m-0 flex h-[35px] shrink-0 items-center pl-5 text-[11px] font-normal uppercase text-sidebar-title">{t('sidebar.snapshots')}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
            <div className="px-5 py-2">
              <p className="m-0 mb-3 text-fg-muted">{t('sidebar.noFolder')}</p>
              <button type="button" onClick={actions.openFolder} className="h-[26px] w-full rounded-sm bg-button px-3 text-[13px] text-button-fg hover:bg-button-hover">
                {t('sidebar.openFolder')}
              </button>
              <p className="m-0 mt-3 text-[12px] text-fg-muted">{t('sidebar.openFolderHint')}</p>
            </div>
          )}
        </Section>
        <Section
          title={t('sidebar.openSnapshots')}
          actions={
            <button type="button" title={t('menu.openFile')} aria-label={t('menu.openFile')} onClick={actions.openFile} className="mr-1 flex h-[22px] w-[22px] items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-toolbar-hover focus-visible:opacity-100">
              <Icon name="new-folder" className="text-[16px]" />
            </button>
          }
        >
          {ids.length ? (
            <ul role="listbox" aria-label={t('sidebar.openSnapshots')} className="m-0 list-none p-0 py-0.5">
              {ids.map((id) => (
                <li
                  key={id}
                  role="option"
                  aria-selected={id === ws.selected}
                  tabIndex={0}
                  title={ws.snapshots[id].path}
                  onClick={() => dispatch({ type: 'activate', key: snapshotKey(id) })}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && dispatch({ type: 'activate', key: snapshotKey(id) })}
                  className={`group/row flex h-[22px] cursor-pointer items-center gap-1.5 pr-1 pl-5 text-[13px] outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus ${id === ws.selected ? 'bg-list-inactive' : 'hover:bg-list-hover'}`}
                >
                  <Icon name="browser" className="shrink-0 text-[16px]" />
                  <span className="min-w-0 flex-1 truncate">{snapshotTitle(ws, id)}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t('tabs.close')}
                    title={t('tabs.close')}
                    onClick={(e) => {
                      e.stopPropagation()
                      dispatch({ type: 'close', key: snapshotKey(id) })
                    }}
                    className="flex h-[18px] w-[18px] items-center justify-center rounded opacity-0 group-hover/row:opacity-100 hover:bg-toolbar-hover"
                  >
                    <Icon name="close" className="text-[14px]" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-2">
              <p className="m-0 mb-3 text-fg-muted">{t('sidebar.noSnapshot')}</p>
              <button type="button" onClick={actions.openFile} className="h-[26px] w-full rounded-sm bg-button px-3 text-[13px] text-button-fg hover:bg-button-hover">
                {t('sidebar.openFile')}
              </button>
              <p className="m-0 mt-3 text-[12px] text-fg-muted">{t('sidebar.openSnapshotsHint')}</p>
            </div>
          )}
        </Section>
        <Section
          title={root ? `${t('sidebar.files')} — ${root.name}` : selected ? `${t('sidebar.files')} — ${basename(selected.path)}` : t('sidebar.files')}
          actions={
            root ? (
              <>
                <button type="button" title={hidden ? t('tree.hideHidden') : t('menu.showHidden')} aria-label={hidden ? t('tree.hideHidden') : t('menu.showHidden')} aria-pressed={hidden} onClick={() => showHidden.set(!hidden)} className={iconButton}>
                  <Icon name={hidden ? 'eye' : 'eye-closed'} className="text-[16px]" />
                </button>
                <button type="button" title={t('tree.refresh')} aria-label={t('tree.refresh')} onClick={() => setRefreshToken((n) => n + 1)} className={iconButton}>
                  <Icon name="refresh" className="text-[16px]" />
                </button>
              </>
            ) : null
          }
        >
          {root ? (
            <ExplorerTree
              key={root.id}
              activePath={activePath}
              showHidden={hidden}
              refreshToken={refreshToken}
              actions={{
                listDir: (path) => actions.listDir(root.id, path),
                open: (entry, keep) => actions.openRootFile(root.id, entry, keep),
                openWith: (path) => actions.openWith(root.id, path),
                save: (path) => actions.saveFile(root.id, path),
                copy: actions.copy,
                reveal: (path) => actions.reveal(root.id, path),
              }}
            />
          ) : selected ? (
            <FileTree key={selected.id} snapshot={selected} activePath={activePath} onOpen={(path, keep) => actions.openTreeFile(selected.id, path, keep)} onOpenWith={(path) => actions.openWith(selected.id, path)} onSave={(path) => actions.saveFile(selected.id, path)} onCopy={actions.copy} />
          ) : (
            <p className="m-0 px-5 py-2 text-fg-muted">{t('sidebar.noSelection')}</p>
          )}
        </Section>
        <Section title={t('sidebar.information')} defaultOpen={false}>
          <div className="px-5 py-2">{selected ? <InfoPanel snapshot={selected} signers={signers} onOpenExternal={actions.openExternal} onShowAll={() => actions.showMetadata(selected.id)} /> : <p className="m-0 text-fg-muted">{t('sidebar.noSelection')}</p>}</div>
        </Section>
        <Section title={t('sidebar.integrity')} defaultOpen={false}>
          <div className="px-5 py-2 text-[13px]">{selected ? <IntegrityPanel state={ws.integrity[selected.id]} onOpenFile={(path) => actions.openTreeFile(selected.id, path, false)} /> : <p className="m-0 text-fg-muted">{t('sidebar.noSelection')}</p>}</div>
        </Section>
      </div>
    </aside>
  )
}
