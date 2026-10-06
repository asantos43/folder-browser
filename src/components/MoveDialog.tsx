import type { DirEntry, ListResult } from '@core/api.ts'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { isUnder } from '@/state/workspace.ts'
import { isInner, parentPath } from '@core/vpath.ts'

type Listing = { state: 'loading' } | { state: 'ready'; folders: DirEntry[] } | { state: 'error' }

/**
 * Where to move an item to: the folders of the root as a tree that reads one level at a time, from the top. A folder cannot be moved into itself (it and what is in it are
 * not offered), and the folder the item is in is not a place to move it to. Enter moves, Esc leaves.
 */
export function MoveDialog({ rootName, entries, listDir, onMove, onCancel }: { rootName: string; entries: DirEntry[]; listDir: (path: string) => Promise<ListResult>; onMove: (toFolder: string) => void; onCancel: () => void }) {
  const { t } = useI18n()
  const [listings, setListings] = useState<Record<string, Listing>>({})
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['']))
  const [selected, setSelected] = useState<string | null>(null)
  const move = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  // The keys (Esc, Enter) are the dialog's from the start: the focus is in it.
  useEffect(() => dialog.current?.focus(), [])
  const entry = entries[0]
  // (Several items go together: the place is refused only when all of them are in it already.)
  const parents = new Set(entries.map((e) => parentPath(e.path)))
  // An entry of a ZIP is moved inside its ZIP: the ZIP files (and their folders) are places too; an item of the disk goes to a folder of the disk.
  const inZip = entries.some((e) => isInner(e.path))

  const load = (path: string) => {
    setListings((all) => (all[path] ? all : { ...all, [path]: { state: 'loading' } }))
    void listDir(path).then(
      (result) => setListings((all) => ({ ...all, [path]: 'entries' in result ? { state: 'ready', folders: result.entries.filter((e) => (e.kind === 'dir' || (inZip && e.kind === 'zip')) && !entries.some((moved) => (moved.kind === 'dir' || moved.kind === 'zip') && isUnder(e.path, moved.path))) } : { state: 'error' } })),
      () => setListings((all) => ({ ...all, [path]: { state: 'error' } })),
    )
  }
  useEffect(() => load(''), []) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (path: string) => {
    setOpen((now) => {
      const next = new Set(now)
      if (next.has(path)) next.delete(path)
      else {
        next.add(path)
        load(path)
      }
      return next
    })
  }

  const rows: { path: string; name: string; depth: number }[] = []
  const walk = (path: string, depth: number) => {
    const listing = listings[path]
    if (listing?.state !== 'ready') return
    for (const folder of listing.folders) {
      rows.push({ path: folder.path, name: folder.name, depth })
      if (open.has(folder.path)) walk(folder.path, depth + 1)
    }
  }
  walk('', 1)
  const all = [{ path: '', name: rootName, depth: 0 }, ...rows]
  const title = entries.length > 1 ? t('fs.moveTitleMany', { count: entries.length }) : t('fs.moveTitle', { name: entry.name })
  const here = (path: string) => parents.size === 1 && parents.has(path)
  const canMove = selected !== null && !here(selected)

  const button = 'h-[26px] rounded-sm px-4 text-[13px]'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          } else if (e.key === 'Enter' && canMove && document.activeElement !== move.current) {
            e.preventDefault()
            onMove(selected)
          }
        }}
        className="flex max-h-[min(520px,calc(100vh-64px))] w-[min(460px,calc(100vw-32px))] flex-col gap-3 border border-widget-border bg-widget p-5 text-[13px] text-fg shadow-[0_2px_16px_var(--vscode-widget-shadow)]"
      >
        <h2 className="m-0 text-[16px] font-normal break-all">{title}</h2>
        <div role="tree" aria-label={t('fs.moveFolders')} className="min-h-[160px] flex-1 overflow-y-auto border border-group-border bg-editor py-0.5">
          {all.map((row) => {
            const isHere = here(row.path)
            const expandable = row.path !== ''
            return (
              <div
                key={row.path}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={selected === row.path}
                aria-disabled={isHere}
                aria-expanded={expandable ? open.has(row.path) : undefined}
                tabIndex={0}
                onClick={() => !isHere && setSelected(row.path)}
                onDoubleClick={() => expandable && toggle(row.path)}
                onKeyDown={(e) => {
                  if (e.key === ' ') {
                    e.preventDefault()
                    if (!isHere) setSelected(row.path)
                  } else if (e.key === 'ArrowRight' && expandable && !open.has(row.path)) toggle(row.path)
                  else if (e.key === 'ArrowLeft' && expandable && open.has(row.path)) toggle(row.path)
                }}
                style={{ paddingLeft: 8 + row.depth * 12 }}
                className={`flex h-[22px] cursor-pointer items-center gap-1 pr-2 outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus ${isHere ? 'opacity-50' : ''} ${selected === row.path ? 'bg-list-active text-list-active-fg' : 'hover:bg-list-hover'}`}
              >
                <span
                  className="flex w-4 shrink-0 justify-center"
                  onClick={(e) => {
                    if (!expandable) return
                    e.stopPropagation()
                    toggle(row.path)
                  }}
                >
                  {expandable ? <Icon name={open.has(row.path) ? 'chevron-down' : 'chevron-right'} className="text-[16px]" /> : null}
                </span>
                <Icon name={row.path === '' || open.has(row.path) ? 'folder-opened' : 'folder'} className="shrink-0 text-[16px]" />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={`${button} hover:bg-toolbar-hover`}>
            {t('confirm.cancel')}
          </button>
          <button ref={move} type="button" disabled={!canMove} onClick={() => selected !== null && onMove(selected)} className={`${button} bg-button text-button-fg hover:bg-button-hover disabled:opacity-40 disabled:hover:bg-button`}>
            {t('fs.moveHere')}
          </button>
        </div>
      </div>
    </div>
  )
}
