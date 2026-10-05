import type { DirEntry, ListResult, RootInfo } from '@core/api.ts'
import { listingsAbove } from '@core/vpath.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { fileIcon } from '@/lib/icons.ts'

type Listing = { state: 'loading' } | { state: 'ready'; entries: DirEntry[]; truncated: boolean } | { state: 'error'; error: Extract<ListResult, { error: string }>['error'] }

type Row =
  | { type: 'entry'; entry: DirEntry; depth: number; parent: string }
  | { type: 'note'; key: string; depth: number; text: string; error?: boolean }

const ERROR_TEXT: Record<Extract<ListResult, { error: string }>['error'], MessageKey> = {
  denied: 'tree.errorDenied',
  'no-dir': 'tree.errorMissing',
  'no-root': 'tree.errorMissing',
  'not-zip': 'tree.errorZip',
  'too-large': 'tree.errorLarge',
}

export interface ExplorerActions {
  listDir: (path: string) => Promise<ListResult>
  /** A file was clicked (`keep` for a double click or Enter). */
  open: (entry: DirEntry, keep: boolean) => void
  openWith: (path: string) => void
  save: (path: string) => void
  copy: (text: string) => void
  reveal: (path: string) => void
}

/**
 * A folder or a ZIP file opened to browse, as a tree in VS Code's Explorer style that asks the main process for one level at a time (a folder of a hundred thousand files is
 * not read until it is opened). A ZIP opens like a folder, also inside a ZIP. Clicks and keys are as in the tree of a snapshot: a click opens a preview tab, a double click (or
 * Enter) keeps it, arrows move, typing jumps to a name. Hidden files are listed but shown only when `showHidden` says so, so the switch needs no new request.
 */
export function ExplorerTree({ root, activePath, showHidden, refreshToken, actions }: { root: RootInfo; activePath: string | undefined; showHidden: boolean; /** Changes when the user asks to read everything again. */ refreshToken: number; actions: ExplorerActions }) {
  const { t } = useI18n()
  const [listings, setListings] = useState<Record<string, Listing>>({})
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const typed = useRef({ text: '', at: 0 })
  const box = useRef<HTMLDivElement>(null)
  // What was asked of the main process, so that a slow answer to an older question (before a refresh) is not taken for the newest.
  const generation = useRef(0)
  const asked = useRef(new Set<string>())
  const { listDir } = actions

  const load = useCallback(
    (path: string) => {
      if (asked.current.has(path)) return
      asked.current.add(path)
      const mine = generation.current
      setListings((all) => ({ ...all, [path]: { state: 'loading' } }))
      void listDir(path).then(
        (result) => {
          if (mine !== generation.current) return
          setListings((all) => ({ ...all, [path]: 'error' in result ? { state: 'error', error: result.error } : { state: 'ready', entries: result.entries, truncated: result.truncated } }))
        },
        () => mine === generation.current && setListings((all) => ({ ...all, [path]: { state: 'error', error: 'no-dir' } })),
      )
    },
    [listDir],
  )

  // The root is read when the tree appears, and everything that is open again when the user refreshes.
  const first = useRef(true)
  useEffect(() => {
    const again = first.current ? [] : [...open]
    first.current = false
    generation.current++
    asked.current = new Set()
    load('')
    for (const path of again) load(path)
    // `open` is read once, when the token changes: a folder opened later loads itself (see `toggle`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, load])

  // The file of the active tab is always visible in the tree: what is above it opens (and is read, if it was not).
  useEffect(() => {
    if (!activePath) return
    const above = listingsAbove(activePath)
    setOpen((current) => (above.every((p) => current.has(p)) ? current : new Set([...current, ...above])))
    for (const path of above) load(path)
  }, [activePath, load])

  const toggle = (path: string, force?: boolean) => {
    const opening = force ?? !open.has(path)
    setOpen((current) => {
      const next = new Set(current)
      if (opening) next.add(path)
      else next.delete(path)
      return next
    })
    if (opening) load(path)
  }

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: string, depth: number) => {
      const listing = listings[dir]
      if (!listing) return
      if (listing.state === 'loading') {
        // The root's own "Loading…" is not shown: it would flash for a folder that answers at once.
        if (dir !== '') out.push({ type: 'note', key: `${dir}\0status`, depth, text: t('tree.loading') })
        return
      }
      if (listing.state === 'error') return void out.push({ type: 'note', key: `${dir}\0status`, depth, text: t(ERROR_TEXT[listing.error]), error: true })
      const shown = listing.entries.filter((e) => showHidden || !e.hidden)
      if (!shown.length) out.push({ type: 'note', key: `${dir}\0status`, depth, text: t(listing.entries.length ? 'tree.emptyHidden' : 'tree.empty') })
      for (const entry of shown) {
        out.push({ type: 'entry', entry, depth, parent: dir })
        if (entry.kind !== 'file' && open.has(entry.path)) walk(entry.path, depth + 1)
      }
      if (listing.truncated) out.push({ type: 'note', key: `${dir}\0truncated`, depth, text: t('tree.truncated', { count: listing.entries.length }) })
    }
    walk('', 0)
    return out
  }, [listings, open, showHidden, t])
  const entries = useMemo(() => rows.filter((r): r is Extract<Row, { type: 'entry' }> => r.type === 'entry'), [rows])

  const focusRow = (path: string) => {
    setFocused(path)
    box.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const at = entries.findIndex((r) => r.entry.path === (focused ?? entries[0]?.entry.path))
    const row = entries[at]
    if (!row) return
    const go = (i: number) => entries[i] && focusRow(entries[i].entry.path)
    const expandable = row.entry.kind !== 'file'
    switch (event.key) {
      case 'ArrowDown': go(Math.min(entries.length - 1, at + 1)); break
      case 'ArrowUp': go(Math.max(0, at - 1)); break
      case 'Home': go(0); break
      case 'End': go(entries.length - 1); break
      case 'ArrowRight':
        if (expandable) {
          if (open.has(row.entry.path)) go(at + 1)
          else toggle(row.entry.path, true)
        }
        break
      case 'ArrowLeft':
        if (expandable && open.has(row.entry.path)) toggle(row.entry.path, false)
        else if (row.parent) focusRow(row.parent)
        break
      case 'Enter':
        if (expandable) toggle(row.entry.path)
        else actions.open(row.entry, true)
        break
      case ' ':
        if (expandable) toggle(row.entry.path)
        else actions.open(row.entry, false)
        break
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
        const now = Date.now()
        typed.current = { text: (now - typed.current.at < 800 ? typed.current.text : '') + event.key.toLowerCase(), at: now }
        const from = typed.current.text.length === 1 ? at + 1 : at
        const found = [...entries.slice(from), ...entries.slice(0, from)].find((r) => r.entry.name.toLowerCase().startsWith(typed.current.text))
        if (found) focusRow(found.entry.path)
        break
      }
    }
    event.preventDefault()
  }

  const contextMenu = (event: MouseEvent, entry: DirEntry) => {
    event.preventDefault()
    setFocused(entry.path)
    const expanded = open.has(entry.path)
    const common = [{ id: 'path', label: t('tabs.copyPath'), run: () => actions.copy(entry.path) }, { id: 'reveal', label: t('tabs.reveal'), run: () => actions.reveal(entry.path) }]
    setMenu({
      x: event.clientX,
      y: event.clientY,
      label: entry.name,
      entries:
        entry.kind === 'dir'
          ? [{ id: 'toggle', label: expanded ? t('tree.collapse') : t('tree.expand'), run: () => toggle(entry.path) }, { id: 'refresh', label: t('tree.refresh'), run: () => { asked.current.delete(entry.path); load(entry.path) } }, { separator: true }, ...common]
          : entry.kind === 'zip'
            ? [
                { id: 'toggle', label: expanded ? t('tree.collapse') : t('tree.expand'), run: () => toggle(entry.path) },
                { id: 'list', label: t('tree.openAsList'), run: () => actions.open(entry, true) },
                { id: 'openWith', label: t('tree.openWith'), run: () => actions.openWith(entry.path) },
                { id: 'save', label: t('menu.saveAs'), run: () => actions.save(entry.path) },
                { separator: true },
                ...common,
              ]
            : [
                { id: 'open', label: t('tree.open'), run: () => actions.open(entry, true) },
                { id: 'openWith', label: t('tree.openWith'), run: () => actions.openWith(entry.path) },
                { id: 'save', label: t('menu.saveAs'), run: () => actions.save(entry.path) },
                { separator: true },
                ...common,
              ],
    })
  }

  const current = focused ?? entries[0]?.entry.path
  return (
    <>
      <div ref={box} role="tree" aria-label={t('sidebar.rootTreeLabel')} onKeyDown={onKeyDown} className="py-0.5 text-[13px]">
        {rows.map((row) => {
          if (row.type === 'note') {
            return (
              <div key={row.key} role="none" style={{ paddingLeft: 8 + row.depth * 8 + 20 }} className={`flex h-[22px] items-center pr-2 text-[12px] ${row.error ? 'text-error' : 'text-fg-muted'}`}>
                <span className="truncate">{row.text}</span>
              </div>
            )
          }
          const { entry, depth } = row
          const expandable = entry.kind !== 'file'
          const expanded = expandable && open.has(entry.path)
          const selected = !expandable && entry.path === activePath
          return (
            <div
              key={entry.path}
              role="treeitem"
              data-path={entry.path}
              data-kind={entry.kind}
              aria-level={depth + 1}
              aria-expanded={expandable ? expanded : undefined}
              aria-selected={selected}
              tabIndex={entry.path === current ? 0 : -1}
              onFocus={() => setFocused(entry.path)}
              onClick={() => (expandable ? toggle(entry.path) : actions.open(entry, false))}
              onDoubleClick={() => !expandable && actions.open(entry, true)}
              onContextMenu={(e) => contextMenu(e, entry)}
              title={entry.link ? `${entry.path} (${t('tree.linkOutside')})` : entry.path}
              style={{ paddingLeft: 8 + depth * 8 }}
              className={`flex h-[22px] cursor-pointer items-center gap-1 pr-2 outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus ${entry.hidden ? 'opacity-60' : ''} ${selected ? 'bg-list-inactive focus-within:bg-list-active focus-within:text-list-active-fg' : 'hover:bg-list-hover'}`}
            >
              <span className="flex w-4 shrink-0 justify-center">{expandable ? <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className="text-[16px]" /> : null}</span>
              <Icon name={entry.kind === 'dir' ? (expanded ? 'folder-opened' : 'folder') : entry.kind === 'zip' ? 'file-zip' : fileIcon(undefined, entry.name)} className="shrink-0 text-[16px]" />
              <span className="truncate">{entry.name}</span>
            </div>
          )
        })}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  )
}
