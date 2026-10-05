import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { Action, Tab, Workspace } from '@/state/workspace.ts'
import type { TabView } from './tabInfo.ts'

const DRAG_TYPE = 'application/x-wsnp-tab'

/** The tab strip: 35 px, as VS Code's, with preview (italic) and pinned tabs, drag to reorder, middle click and × to close, a context menu. */
export function TabStrip({ ws, views, dispatch, onReveal, onCopy }: { ws: Workspace; views: Map<string, TabView>; dispatch: (a: Action) => void; onReveal: (snapshotId: string, path?: string) => void; onCopy: (text: string) => void }) {
  const { t } = useI18n()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [over, setOver] = useState<{ key: string; after: boolean } | null>(null)
  const strip = useRef<HTMLDivElement>(null)

  // The active tab is always in view, and the wheel scrolls the strip sideways.
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [ws.active, ws.tabs.length])
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (e.deltaY && !e.deltaX) {
        el.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const contextMenu = (event: MouseEvent, tab: Tab) => {
    event.preventDefault()
    const snapshot = ws.snapshots[tab.snapshotId]
    const source = snapshot?.manifest.source.url
    setMenu({
      x: event.clientX,
      y: event.clientY,
      label: t('tabs.label'),
      entries: [
        { id: 'close', label: t('tabs.close'), run: () => dispatch({ type: 'close', key: tab.key }) },
        { id: 'others', label: t('tabs.closeOthers'), disabled: ws.tabs.filter((x) => x.key !== tab.key && !x.pinned).length === 0, run: () => dispatch({ type: 'close-others', key: tab.key }) },
        { id: 'right', label: t('tabs.closeRight'), disabled: ws.tabs.slice(ws.tabs.findIndex((x) => x.key === tab.key) + 1).filter((x) => !x.pinned).length === 0, run: () => dispatch({ type: 'close-right', key: tab.key }) },
        { id: 'all', label: t('tabs.closeAll'), run: () => dispatch({ type: 'close-all' }) },
        { separator: true },
        { id: 'pin', label: tab.pinned ? t('tabs.unpin') : t('tabs.pin'), run: () => dispatch({ type: 'pin', key: tab.key, pinned: !tab.pinned }) },
        { separator: true },
        ...(tab.view === 'settings' || ws.roots[tab.snapshotId] ? [] : [{ id: 'metadata', label: t('tabs.showMetadata'), run: () => dispatch({ type: 'open-metadata', snapshotId: tab.snapshotId }) }]),
        ...(tab.view ? [] : tab.path === undefined ? [{ id: 'source', label: t('tabs.copySource'), disabled: !source, run: () => source && onCopy(source) }] : [{ id: 'path', label: t('tabs.copyPath'), run: () => onCopy(tab.path!) }]),
        ...(tab.view === 'settings' ? [] : [{ id: 'reveal', label: t('tabs.reveal'), run: () => (ws.roots[tab.snapshotId] && tab.path !== undefined ? onReveal(tab.snapshotId, tab.path) : onReveal(tab.snapshotId)) }]),
      ],
    })
  }

  const drop = (event: DragEvent, target: Tab) => {
    const key = event.dataTransfer.getData(DRAG_TYPE)
    setOver(null)
    if (!key || key === target.key) return
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    const after = event.clientX > box.left + box.width / 2
    const others = ws.tabs.filter((x) => x.key !== key)
    dispatch({ type: 'move', key, to: others.findIndex((x) => x.key === target.key) + (after ? 1 : 0) })
  }

  return (
    <>
      <div ref={strip} role="tablist" aria-label={t('tabs.label')} className="no-scrollbar flex h-[35px] shrink-0 overflow-x-auto bg-tabs">
        {ws.tabs.map((tab) => {
          const view = views.get(tab.key)!
          const active = ws.active === tab.key
          const indicator = over?.key === tab.key ? (over.after ? 'shadow-[inset_-2px_0_0_var(--vscode-focusBorder)]' : 'shadow-[inset_2px_0_0_var(--vscode-focusBorder)]') : ''
          return (
            <div
              key={tab.key}
              data-key={tab.key}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={view.tooltip}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, tab.key)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                const box = e.currentTarget.getBoundingClientRect()
                setOver({ key: tab.key, after: e.clientX > box.left + box.width / 2 })
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => drop(e, tab)}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && dispatch({ type: 'close', key: tab.key })}
              onClick={() => dispatch({ type: 'activate', key: tab.key })}
              onDoubleClick={() => dispatch({ type: 'keep', key: tab.key })}
              onContextMenu={(e) => contextMenu(e, tab)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') dispatch({ type: 'activate', key: tab.key })
              }}
              className={`group relative flex h-full min-w-[120px] max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-tab-border pr-1 pl-3 text-[13px] ${indicator} ${active ? 'bg-tab-active text-tab-active-fg' : 'bg-tab-inactive text-tab-inactive-fg hover:text-tab-active-fg'}`}
            >
              <Icon name={view.icon} className="shrink-0 text-[16px]" />
              <span className={`min-w-0 truncate ${tab.preview ? 'italic' : ''}`}>{view.label}</span>
              {view.description ? <span className="min-w-0 truncate text-[11px] opacity-60">{view.description}</span> : null}
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('tabs.close')}
                title={tab.pinned ? t('tabs.unpin') : t('tabs.close')}
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch(tab.pinned ? { type: 'pin', key: tab.key, pinned: false } : { type: 'close', key: tab.key })
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className={`ml-auto flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded hover:bg-toolbar-hover ${active || tab.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              >
                <Icon name={tab.pinned ? 'pinned' : 'close'} className="text-[16px]" />
              </button>
            </div>
          )
        })}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  )
}
