import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { comparable } from '@core/diff.ts'
import { basename } from '@/lib/format.ts'
import { groupOf, isSplit, shownIn, type Action, type GroupId, type Tab, type Workspace } from '@/state/workspace.ts'
import { dragging, TAB_DRAG } from './dnd.ts'
import type { TabView } from './tabInfo.ts'

/** Whether a tab shows a text file that can be one side of a comparison, or of two files side by side. */
export const isTextTab = (tab: Tab | undefined): boolean => tab !== undefined && tab.path !== undefined && tab.view === undefined && tab.as === undefined && comparable(basename(tab.path), tab.size ?? 0)

/** The tab strip: 35 px, as VS Code's, with preview (italic) and pinned tabs, drag to reorder, middle click and × to close, a context menu. */
export function TabStrip({ ws, group, views, dispatch, onReveal, onCopy, onOpenWith, onDropOnTab }: { ws: Workspace; /** The group whose tabs this strip shows. */ group: GroupId; /** A tab was dropped in the middle of another one (two text files): asks what to do with the two. */ onDropOnTab?: (dragged: string, target: string) => void; views: Map<string, TabView>; dispatch: (a: Action) => void; onReveal: (snapshotId: string, path?: string) => void; onCopy: (text: string) => void; /** Opens the file of the tab in another application (a file of a snapshot has no other way to be handed to one). */ onOpenWith?: (snapshotId: string, path: string) => void }) {
  const { t } = useI18n()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [over, setOver] = useState<{ key: string; after: boolean; middle: boolean } | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const tabs = ws.tabs.filter((tab) => groupOf(tab) === group)
  const shown = shownIn(ws, group)
  const split = isSplit(ws)

  // The active tab is always in view, and the wheel scrolls the strip sideways.
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [shown, tabs.length])
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
        { id: 'others', label: t('tabs.closeOthers'), disabled: tabs.filter((x) => x.key !== tab.key && !x.pinned).length === 0, run: () => dispatch({ type: 'close-others', key: tab.key }) },
        { id: 'right', label: t('tabs.closeRight'), disabled: tabs.slice(tabs.findIndex((x) => x.key === tab.key) + 1).filter((x) => !x.pinned).length === 0, run: () => dispatch({ type: 'close-right', key: tab.key }) },
        { id: 'all', label: t('tabs.closeAll'), run: () => dispatch({ type: 'close-all' }) },
        { separator: true },
        { id: 'pin', label: tab.pinned ? t('tabs.unpin') : t('tabs.pin'), run: () => dispatch({ type: 'pin', key: tab.key, pinned: !tab.pinned }) },
        // As VS Code's Split Right: the tab goes to a second group on the right (a tab is one file, so it moves and is not shown twice).
        { id: 'split', label: !split ? t('tabs.splitRight') : group === 0 ? t('tabs.moveToRight') : t('tabs.moveToLeft'), disabled: !split && tabs.length < 2, run: () => dispatch({ type: 'move-to-group', key: tab.key, group: group === 0 ? 1 : 0 }) },
        { separator: true },
        ...(tab.view === 'settings' || ws.roots[tab.snapshotId] ? [] : [{ id: 'metadata', label: t('tabs.showMetadata'), run: () => dispatch({ type: 'open-metadata', snapshotId: tab.snapshotId }) }]),
        ...(tab.view ? [] : tab.path === undefined ? [{ id: 'source', label: t('tabs.copySource'), disabled: !source, run: () => source && onCopy(source) }] : [{ id: 'path', label: t('tabs.copyPath'), run: () => onCopy(tab.path!) }]),
        ...(tab.path !== undefined && onOpenWith ? [{ id: 'openWith', label: t('tree.openWith'), run: () => onOpenWith(tab.snapshotId, tab.path!) }] : []),
        ...(tab.view === 'settings' || tab.view === 'diff' ? [] : [{ id: 'reveal', label: t('tabs.reveal'), run: () => (ws.roots[tab.snapshotId] && tab.path !== undefined ? onReveal(tab.snapshotId, tab.path) : onReveal(tab.snapshotId)) }]),
      ],
    })
  }

  /** Where on a tab the pointer is: the middle of it (two text files then ask what to do), and the half it is in (the side of the tab the dragged one lands on). */
  const place = (event: DragEvent, target: Tab, dragged: Tab | undefined) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width
    return { after: x > 0.5, middle: x > 0.3 && x < 0.7 && isTextTab(dragged) && isTextTab(target) && dragged!.key !== target.key }
  }
  const drop = (event: DragEvent, target: Tab) => {
    const key = event.dataTransfer.getData(TAB_DRAG)
    setOver(null)
    if (!key || key === target.key) return
    event.preventDefault()
    const dragged = ws.tabs.find((x) => x.key === key)
    if (!dragged) return
    const { after, middle } = place(event, target, dragged)
    if (middle && onDropOnTab) return onDropOnTab(key, target.key)
    // From the other group: it goes into this one, next to the tab it was dropped on. In the group: it is moved.
    if (groupOf(dragged) !== group) return dispatch({ type: 'move-to-group', key, group, at: { key: target.key, after } })
    const others = ws.tabs.filter((x) => x.key !== key)
    dispatch({ type: 'move', key, to: others.findIndex((x) => x.key === target.key) + (after ? 1 : 0) })
  }

  return (
    <>
      <div ref={strip} role="tablist" aria-label={t('tabs.label')} className="no-scrollbar flex h-[35px] shrink-0 overflow-x-auto bg-tabs">
        {tabs.map((tab) => {
          const view = views.get(tab.key)!
          const active = shown === tab.key
          const indicator = over?.key === tab.key ? over.middle ? 'outline outline-1 -outline-offset-2 outline-focus' : (over.after ? 'shadow-[inset_-2px_0_0_var(--vscode-focusBorder)]' : 'shadow-[inset_2px_0_0_var(--vscode-focusBorder)]') : ''
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
                e.dataTransfer.setData(TAB_DRAG, tab.key)
                e.dataTransfer.effectAllowed = 'move'
                dragging.start('tab', tab.key)
              }}
              onDragEnd={() => dragging.end()}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TAB_DRAG)) return
                e.preventDefault()
                setOver({ key: tab.key, ...place(e, tab, ws.tabs.find((x) => x.key === dragging.tab())) })
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
              {ws.dirty[tab.key] ? <span className="sr-only">{t('edit.modified')}</span> : null}
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
                className={`ml-auto flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded hover:bg-toolbar-hover ${active || tab.pinned || ws.dirty[tab.key] ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              >
                {/* A text with changes not saved shows a dot in place of the ×, until the pointer is over the tab. */}
                {ws.dirty[tab.key] && !tab.pinned ? (
                  <>
                    <Icon name="circle-filled" className="text-[10px] group-hover:hidden" />
                    <Icon name="close" className="hidden text-[16px] group-hover:inline" />
                  </>
                ) : (
                  <Icon name={tab.pinned ? 'pinned' : 'close'} className="text-[16px]" />
                )}
              </button>
            </div>
          )
        })}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  )
}
