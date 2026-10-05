import type { ZipEntryInfo } from '@core/api.ts'
import type { ExtractResult } from '@core/extract.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { basename, formatBytes, formatDate } from '@/lib/format.ts'
import { fileIcon } from '@/lib/icons.ts'
import type { Notice } from '@/state/messages.ts'
import { SaveButton, Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'

const ROW = 24
const COLUMNS = 'grid-cols-[32px_minmax(0,1fr)_84px_84px_190px]'

type Load = { state: 'loading' } | { state: 'ready'; entries: ZipEntryInfo[]; truncated: boolean } | { state: 'failed'; error: 'no-snapshot' | 'no-file' | 'too-large' | 'not-zip' }

const errorKey = (error: 'no-snapshot' | 'no-file' | 'too-large' | 'not-zip'): MessageKey => (error === 'too-large' ? 'zip.error.tooLarge' : error === 'not-zip' ? 'zip.error.notZip' : 'zip.error.noFile')

/**
 * A ZIP of the snapshot in a tab: its list of files, in the order the ZIP has them, with their sizes and dates. Rows are selected as in a file
 * manager (click, Ctrl and Shift, the boxes, Ctrl+A); **Extract** writes the selection to a folder (one file asks for a name, as Save As does), and
 * **View** (double click, Enter, the context menu) opens an entry in a tab of its own, a ZIP inside a ZIP as a list again. Nothing is unzipped
 * to disk until the user extracts.
 */
export function ZipView({ snapshotId, path, name, size, onSave, onView, onNotify }: { snapshotId: string; path: string; name: string; size: number; onSave: () => void; onView: (entry: ZipEntryInfo) => void; onNotify: (notice: Notice) => void }) {
  const { t, language } = useI18n()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [focus, setFocus] = useState(0)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [scroll, setScroll] = useState({ top: 0, height: 0 })
  const anchor = useRef(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setLoad({ state: 'loading' })
    setSelected(new Set())
    setFocus(0)
    void window.fb?.zipList(snapshotId, path).then((result) => {
      if (alive) setLoad('entries' in result ? { state: 'ready', entries: result.entries, truncated: result.truncated } : { state: 'failed', error: result.error })
    })
    return () => {
      alive = false
    }
  }, [snapshotId, path])

  const entries = useMemo(() => (load.state === 'ready' ? load.entries : []), [load])
  const total = useMemo(() => entries.reduce((sum, e) => sum + (e.directory ? 0 : e.size), 0), [entries])

  const measure = useCallback(() => box.current && setScroll({ top: box.current.scrollTop, height: box.current.clientHeight }), [])
  useEffect(() => {
    measure()
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure, load.state])

  // Only the rows near the window are drawn: a ZIP may list tens of thousands.
  const visible = Math.max(40, Math.ceil(scroll.height / ROW) + 12)
  const start = Math.max(0, Math.min(Math.floor(scroll.top / ROW) - 6, Math.max(0, entries.length - visible)))
  const end = Math.min(entries.length, start + visible)

  const extract = async (names: string[], all = false) => {
    const result = await window.fb?.zipExtract(snapshotId, path, names, all ? { folder: true } : undefined)
    const notice = result ? describeExtraction(result) : null
    if (notice) onNotify(notice)
  }
  const describeExtraction = (result: ExtractResult): Notice | null => {
    if ('cancelled' in result) return null
    if ('error' in result) return { level: 'error', text: t('zip.extractFailed', { reason: result.error === 'unreadable' ? t('zip.error.unreadable') : t(errorKey(result.error)) }) }
    if (result.path) return { level: 'info', text: t('file.saved', { name: basename(result.path) }) }
    const folder = result.folder ?? ''
    return result.skipped
      ? { level: 'info', text: t('zip.extractedSome', { count: result.extracted, folder, skipped: result.skipped, name: result.firstSkipped?.name ?? '' }) }
      : { level: 'info', text: t('zip.extracted', { count: result.extracted, folder }) }
  }

  const choose = (index: number, mode: 'only' | 'toggle' | 'range') => {
    const entry = entries[index]
    if (!entry) return
    setFocus(index)
    if (mode === 'range') {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)]
      setSelected(new Set(entries.slice(a, b + 1).map((e) => e.name)))
      return
    }
    anchor.current = index
    setSelected((current) => {
      if (mode === 'only') return new Set([entry.name])
      const next = new Set(current)
      if (!next.delete(entry.name)) next.add(entry.name)
      return next
    })
  }

  const view = (entry: ZipEntryInfo | undefined) => entry && !entry.directory && !entry.unreadable && onView(entry)
  const move = (index: number) => {
    const next = Math.max(0, Math.min(entries.length - 1, index))
    setFocus(next)
    const el = box.current
    if (el) {
      if (next * ROW < el.scrollTop) el.scrollTop = next * ROW
      else if ((next + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (next + 1) * ROW - el.clientHeight
    }
    return next
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!entries.length) return
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const next = move(focus + (event.key === 'ArrowDown' ? 1 : -1))
      if (event.shiftKey) choose(next, 'range')
      else if (!mod) choose(next, 'only')
    } else if (event.key === 'Home' || event.key === 'End') {
      const next = move(event.key === 'Home' ? 0 : entries.length - 1)
      if (event.shiftKey) choose(next, 'range')
      else if (!mod) choose(next, 'only')
    } else if (event.key === ' ') choose(focus, 'toggle')
    else if (event.key === 'Enter') view(entries[focus])
    else if (mod && event.key.toLowerCase() === 'a') setSelected(new Set(entries.map((e) => e.name)))
    else return
    event.preventDefault()
  }

  const contextMenu = (event: MouseEvent, index: number) => {
    event.preventDefault()
    const entry = entries[index]
    // A click on a row that is not selected selects it alone, as a file manager does; on a selected row the selection stays.
    const names = selected.has(entry.name) ? [...selected] : [entry.name]
    if (!selected.has(entry.name)) choose(index, 'only')
    const single = names.length === 1 ? entries.find((e) => e.name === names[0]) : undefined
    setMenu({
      x: event.clientX,
      y: event.clientY,
      label: entry.name,
      entries: [
        ...(single ? [{ id: 'view', label: t('zip.view'), disabled: single.directory || Boolean(single.unreadable), run: () => view(single) }] : []),
        { id: 'extract', label: names.length > 1 ? t('zip.extractCount', { count: names.length }) : t('zip.extract'), run: () => void extract(names) },
      ],
    })
  }

  if (load.state === 'loading') return <p className="m-0 p-6 text-fg-muted">{t('zip.loading')}</p>
  if (load.state === 'failed') {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <Toolbar>
          <SaveButton label={t('file.saveAs')} onClick={onSave} />
        </Toolbar>
        <p role="alert" className="m-0 p-6 text-fg-muted">{t(errorKey(load.error))}</p>
      </div>
    )
  }

  const count = selected.size
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        <ToolbarButton icon="export" text={count ? t('zip.extractCount', { count }) : t('zip.extractSelected')} label={t('zip.extractSelected')} disabled={!count} onClick={() => void extract([...selected])} />
        <ToolbarButton icon="package" text={t('zip.extractAll')} label={t('zip.extractAll')} disabled={!entries.length} onClick={() => void extract(entries.filter((e) => !e.directory).map((e) => e.name), true)} />
        <Separator />
        <SaveButton label={t('file.saveAs')} onClick={onSave} />
        <span className="ml-auto pr-1 text-[12px] text-fg-muted" aria-live="polite">
          {count ? `${t('zip.selected', { count })} · ` : ''}
          {t(load.truncated ? 'zip.summaryCut' : 'zip.summary', { count: entries.length, size: formatBytes(total) })}
          {' · '}
          {formatBytes(size)}
        </span>
      </Toolbar>
      {entries.length === 0 ? (
        <p className="m-0 p-6 text-fg-muted">{t('zip.empty')}</p>
      ) : (
        <div role="table" aria-label={`${t('zip.label')}: ${name}`} aria-rowcount={entries.length + 1} className="flex min-h-0 flex-1 flex-col text-[13px]">
          <div role="row" className={`grid ${COLUMNS} h-[24px] shrink-0 items-center border-b border-group-border bg-sidebar pr-4 text-[12px] text-fg-muted`}>
            <span role="columnheader" className="flex justify-center">
              <input
                type="checkbox"
                aria-label={t('zip.selectAll')}
                checked={count === entries.length}
                ref={(el) => {
                  if (el) el.indeterminate = count > 0 && count < entries.length
                }}
                onChange={(e) => setSelected(e.target.checked ? new Set(entries.map((x) => x.name)) : new Set())}
              />
            </span>
            <span role="columnheader" className="px-2">{t('zip.name')}</span>
            <span role="columnheader" className="px-2 text-right">{t('zip.size')}</span>
            <span role="columnheader" className="px-2 text-right">{t('zip.packed')}</span>
            <span role="columnheader" className="px-2">{t('zip.modified')}</span>
          </div>
          <div ref={box} tabIndex={0} aria-label={t('zip.label')} aria-multiselectable onKeyDown={onKeyDown} onScroll={measure} className="min-h-0 flex-1 overflow-auto outline-none" >
            <div style={{ paddingTop: start * ROW, paddingBottom: (entries.length - end) * ROW }}>
              {entries.slice(start, end).map((entry, i) => {
                const index = start + i
                const on = selected.has(entry.name)
                const dim = entry.unreadable ? 'opacity-60' : ''
                return (
                  <div
                    key={`${index}:${entry.name}`}
                    role="row"
                    aria-selected={on}
                    aria-rowindex={index + 2}
                    title={entry.unreadable ? t(`zip.unreadable.${entry.unreadable}` as MessageKey) : entry.name}
                    // Shift and Ctrl select rows: the browser must not also select text between them.
                    onMouseDown={(e) => (e.shiftKey || e.ctrlKey || e.metaKey) && e.preventDefault()}
                    onClick={(e) => choose(index, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'only')}
                    onDoubleClick={() => view(entry)}
                    onContextMenu={(e) => contextMenu(e, index)}
                    style={{ height: ROW }}
                    className={`grid ${COLUMNS} cursor-default items-center pr-4 ${dim} ${on ? 'bg-list-inactive' : 'hover:bg-list-hover'} ${index === focus ? 'outline outline-1 -outline-offset-1 outline-focus' : ''}`}
                  >
                    <span role="cell" className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={t('zip.select', { name: entry.name })} checked={on} onChange={() => choose(index, 'toggle')} />
                    </span>
                    <span role="cell" className="flex min-w-0 items-center gap-1.5 px-2">
                      <Icon name={entry.directory ? 'folder' : entry.unreadable ? 'lock' : fileIcon(undefined, entry.name)} className="shrink-0 text-[16px]" />
                      <span className="truncate select-text">{entry.name}</span>
                    </span>
                    <span role="cell" className="px-2 text-right tabular-nums text-fg-muted">{entry.directory ? '' : formatBytes(entry.size)}</span>
                    <span role="cell" className="px-2 text-right tabular-nums text-fg-muted">{entry.directory ? '' : formatBytes(entry.compressedSize)}</span>
                    <span role="cell" className="truncate px-2 text-fg-muted">{formatDate(entry.modified, language)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
