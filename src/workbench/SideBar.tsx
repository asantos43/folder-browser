import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { basename } from '@/lib/format.ts'
import { isSnapshotTab, snapshotKey, type Action, type Workspace } from '@/state/workspace.ts'
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
  const activeTab = ws.tabs.find((tab) => tab.key === ws.active)
  const activePath = activeTab && activeTab.snapshotId === ws.selected ? activeTab.path?.split('!/')[0] : undefined

  return (
    <aside aria-label={t('sidebar.snapshots')} className="flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-fg">
      <h2 className="m-0 flex h-[35px] shrink-0 items-center pl-5 text-[11px] font-normal uppercase text-sidebar-title">{t('sidebar.snapshots')}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
        <Section title={selected ? `${t('sidebar.files')} — ${basename(selected.path)}` : t('sidebar.files')}>
          {selected ? (
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
