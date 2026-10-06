import type { DirEntry, ListResult, OpResult } from '@core/api.ts'
import { mediaKind } from '@core/filekind.ts'
import { nameProblem } from '@core/fs/names.ts'
import { compareEntries, type SortKey } from '@core/fs/sort.ts'
import { listingsAbove } from '@core/vpath.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { formatBytes, formatDate, shortDate } from '@/lib/format.ts'
import { fileIcon } from '@/lib/icons.ts'
import { remapPath } from '@/state/workspace.ts'
import type { MenuEntry } from '@/components/Menu.tsx'
import { FOLDER_DRAG } from './PlacesView.tsx'
import { treeMenuFor, type TreeAction } from './treeMenu.ts'

type Listing = { state: 'loading' } | { state: 'ready'; entries: DirEntry[]; truncated: boolean } | { state: 'error'; error: Extract<ListResult, { error: string }>['error'] }

/** What a row of the tree says when it is dragged to a folder of the same tree: the root it is in and its path there. */
export const ENTRY_DRAG = 'application/x-folder-browser-entry'

type Editing = { mode: 'rename'; path: string } | { mode: 'new'; parent: string; kind: 'file' | 'dir' }

type Row =
  | { type: 'entry'; entry: DirEntry; depth: number; parent: string }
  | { type: 'new'; depth: number; parent: string; kind: 'file' | 'dir' }
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
  /** `as`: show the bytes (hexadecimal) instead of what the kind of the file gets. */
  open: (entry: DirEntry, keep: boolean, as?: 'hex') => void
  /** A `.wsnp` of the disk: previewed as a file is (`keep` false: a click), or opened as a snapshot (a double click, Enter, the menu). */
  openSnapshot: (entry: DirEntry, keep: boolean) => void
  openWith: (path: string) => void
  /** Opens a copy in the application the system has for the type. */
  openDefault: (path: string) => void
  properties: (entry: DirEntry) => void
  save: (path: string) => void
  /** Pins a folder to the favourites. */
  pin: (path: string) => void
  /** Puts a top-level row of the trash back. */
  restore: (path: string) => void
  copy: (text: string) => void
  reveal: (path: string) => void
  /** A new empty file or folder in `parent`, named by the user (the answer says if the name was taken or refused). */
  create: (parent: string, name: string, kind: 'file' | 'dir') => Promise<OpResult>
  rename: (path: string, name: string) => Promise<OpResult>
  /** Moves an item into a folder (a drop on it). */
  move: (path: string, toFolder: string) => void
  /** Asks where to move an item to. */
  moveTo: (entry: DirEntry) => void
  /** Asks, and moves an item to the trash. */
  remove: (entry: DirEntry) => void
}

/** A text field in a row of the tree, to name something: Enter says it, Esc (or leaving) does not. */
function NameInput({ initial, label, problem, onChange, onSubmit, onCancel }: { initial: string; label: string; problem: string | null; onChange: (value: string) => void; onSubmit: (value: string) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    // As a file manager does: the name without its extension is what is selected (`.env` and a folder are selected whole).
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <span className="relative min-w-0 flex-1">
      <input
        ref={input}
        defaultValue={initial}
        aria-label={label}
        aria-invalid={problem !== null}
        spellCheck={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') onSubmit(e.currentTarget.value)
          else if (e.key === 'Escape') onCancel()
        }}
        className={`h-[20px] w-full rounded-sm border bg-editor px-1 text-[13px] text-fg outline-none ${problem ? 'border-error' : 'border-focus'}`}
      />
      {problem ? (
        <span role="alert" className="absolute top-[22px] left-0 z-30 max-w-[320px] border border-error bg-widget px-2 py-0.5 text-[12px] text-fg shadow-[0_2px_8px_var(--vscode-widget-shadow)]">
          {problem}
        </span>
      ) : null}
    </span>
  )
}

/**
 * A folder or a ZIP file opened to browse, as a tree in VS Code's Explorer style that asks the main process for one level at a time (a folder of a hundred thousand files is
 * not read until it is opened). A ZIP opens like a folder, also inside a ZIP. Clicks and keys are as in the tree of a snapshot: a click opens a preview tab, a double click (or
 * Enter) keeps it, arrows move, typing jumps to a name. Hidden files are listed but shown only when `showHidden` says so, so the switch needs no new request.
 */
export function ExplorerTree({ rootId, rootKind, trash, writable, createRequest, activePath, showHidden, sortKey, sortDescending, refreshToken, actions }: { /** How the rows of a folder are ordered (folders first, whatever it is), and which of size and date each row shows when there is little room. */ sortKey: SortKey; sortDescending: boolean; rootId: string; rootKind: 'folder' | 'zip'; /** The root is the trash: its top-level rows can be put back. */ trash: boolean; /** Files and folders of this root can be made, renamed, moved and deleted (a folder of the disk, not a ZIP and not the trash). */ writable: boolean; /** A new file or folder was asked for from outside the tree (the buttons of the side bar): `token` counts the requests. */ createRequest?: { kind: 'file' | 'dir'; token: number } | undefined; activePath?: string | undefined; showHidden: boolean; /** Changes when the user asks to read everything again. */ refreshToken: number; actions: ExplorerActions }) {
  const { t, language } = useI18n()
  const [listings, setListings] = useState<Record<string, Listing>>({})
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState<string | null>(null)
  // The path to take the focus when the listing that has it comes in (after a rename or a new file).
  const pendingFocus = useRef<string | null>(null)
  const typed = useRef({ text: '', at: 0 })
  const box = useRef<HTMLDivElement>(null)
  // What was asked of the main process, so that a slow answer to an older question (before a refresh) is not taken for the newest.
  const generation = useRef(0)
  const asked = useRef(new Set<string>())
  // The newest `listDir`, read when a listing is asked for: the one in `actions` is a new function at every render of the side bar, and a `load` that followed it would read
  // everything again (and take the rows away for a moment) each time anything changed.
  const listDir = useRef(actions.listDir)
  listDir.current = actions.listDir

  const load = useCallback(
    (path: string) => {
      if (asked.current.has(path)) return
      asked.current.add(path)
      const mine = generation.current
      // What is shown stays while it is read again (a refresh after a change must not take the rows away for a moment).
      setListings((all) => (all[path]?.state === 'ready' ? all : { ...all, [path]: { state: 'loading' } }))
      void listDir.current(path).then(
        (result) => {
          if (mine !== generation.current) return
          setListings((all) => ({ ...all, [path]: 'error' in result ? { state: 'error', error: result.error } : { state: 'ready', entries: result.entries, truncated: result.truncated } }))
        },
        () => mine === generation.current && setListings((all) => ({ ...all, [path]: { state: 'error', error: 'no-dir' } })),
      )
    },
    [],
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
      const shown = listing.entries.filter((e) => showHidden || !e.hidden).sort(compareEntries(sortKey, sortDescending))
      if (editing?.mode === 'new' && editing.parent === dir) out.push({ type: 'new', depth, parent: dir, kind: editing.kind })
      if (!shown.length) out.push({ type: 'note', key: `${dir}\0status`, depth, text: t(listing.entries.length ? 'tree.emptyHidden' : 'tree.empty') })
      for (const entry of shown) {
        out.push({ type: 'entry', entry, depth, parent: dir })
        if ((entry.kind === 'dir' || entry.kind === 'zip') && open.has(entry.path)) walk(entry.path, depth + 1)
      }
      if (listing.truncated) out.push({ type: 'note', key: `${dir}\0truncated`, depth, text: t('tree.truncated', { count: listing.entries.length }) })
    }
    walk('', 0)
    return out
  }, [listings, open, showHidden, sortKey, sortDescending, t, editing])
  const entries = useMemo(() => rows.filter((r): r is Extract<Row, { type: 'entry' }> => r.type === 'entry'), [rows])

  /** An item of the disk of this root can be changed: not one inside a ZIP, and not in a root that is a ZIP or the trash. */
  const changeable = (entry: DirEntry) => writable && !entry.path.includes('!/') && !trash

  /** Starts to name a new file or folder in `parent` (a folder of the disk; the folder opens to show the field). */
  const startNew = useCallback(
    (parent: string, kind: 'file' | 'dir') => {
      setProblem(null)
      setEditing({ mode: 'new', parent, kind })
      if (parent) {
        setOpen((current) => new Set(current).add(parent))
        load(parent)
      }
    },
    [load],
  )
  // Where "New File…" of the side bar's header makes it: in the folder that has the focus, or in the folder of the file that has it, or in the root.
  const focusedRef = useRef<{ path: string | undefined; entries: DirEntry[] }>({ path: undefined, entries: [] })
  focusedRef.current = { path: focused ?? undefined, entries: entries.map((r) => r.entry) }
  const handled = useRef(0)
  useEffect(() => {
    if (!createRequest || createRequest.token === handled.current) return
    handled.current = createRequest.token
    const { path, entries: all } = focusedRef.current
    const at = all.find((e) => e.path === path)
    const parent = !at ? '' : at.kind === 'dir' && !at.path.includes('!/') ? at.path : at.path.includes('!/') ? '' : at.path.split('/').slice(0, -1).join('/')
    if (writable) startNew(parent, createRequest.kind)
  }, [createRequest, writable, startNew])

  const stopEditing = () => {
    setEditing(null)
    setProblem(null)
  }
  /** The name was said: refused here when it cannot be a name, else asked of the main process, which says if it is taken. */
  const submit = async (value: string) => {
    if (!editing) return
    const name = value.trim()
    const bad = nameProblem(name, window.fb?.platform)
    if (bad) return setProblem(t(`fs.name.${bad}`))
    if (editing.mode === 'rename') {
      const entry = entries.find((r) => r.entry.path === editing.path)?.entry
      if (!entry || name === entry.name) return stopEditing()
      const result = await actions.rename(editing.path, name)
      if (!result.ok) return setProblem(t(`fs.error.${result.error}`))
      setOpen((current) => new Set([...current].map((p) => remapPath(p, editing.path, result.path))))
      pendingFocus.current = result.path
    } else {
      const result = await actions.create(editing.parent, name, editing.kind)
      if (!result.ok) return setProblem(t(`fs.error.${result.error}`))
      pendingFocus.current = result.path
    }
    stopEditing()
  }

  const focusRow = (path: string) => {
    setFocused(path)
    box.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const at = entries.findIndex((r) => r.entry.path === (focused ?? entries[0]?.entry.path))
    const row = entries[at]
    if (!row) return
    const go = (i: number) => entries[i] && focusRow(entries[i].entry.path)
    const expandable = row.entry.kind === 'dir' || row.entry.kind === 'zip'
    const snapshot = row.entry.kind === 'wsnp'
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
      case 'F2':
        if (changeable(row.entry)) {
          setProblem(null)
          setEditing({ mode: 'rename', path: row.entry.path })
        }
        break
      case 'Delete':
        if (changeable(row.entry)) actions.remove(row.entry)
        break
      case 'Enter':
        if (expandable) toggle(row.entry.path)
        else if (snapshot) actions.openSnapshot(row.entry, true)
        else actions.open(row.entry, true)
        break
      case ' ':
        if (expandable) toggle(row.entry.path)
        else if (snapshot) actions.openSnapshot(row.entry, false)
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

  /** A folder of the disk (not one inside a ZIP, nor of a ZIP root) can be pinned. */
  const pinnable = (entry: DirEntry) => entry.kind === 'dir' && rootKind === 'folder' && !entry.path.includes('!/')
  const contextMenu = (event: MouseEvent, entry: DirEntry) => {
    event.preventDefault()
    event.stopPropagation()
    setFocused(entry.path)
    const expanded = open.has(entry.path)
    const item = (action: TreeAction): MenuEntry => {
      switch (action) {
        case 'newFile': return { id: action, label: t('tree.newFile'), run: () => startNew(entry.path, 'file') }
        case 'newFolder': return { id: action, label: t('tree.newFolder'), run: () => startNew(entry.path, 'dir') }
        case 'rename': return { id: action, label: t('tree.rename'), shortcut: 'F2', run: () => { setProblem(null); setEditing({ mode: 'rename', path: entry.path }) } }
        case 'moveTo': return { id: action, label: t('tree.moveTo'), run: () => actions.moveTo(entry) }
        case 'delete': return { id: action, label: t('tree.delete'), shortcut: 'Delete', run: () => actions.remove(entry) }
        case 'restore': return { id: action, label: t('tree.restore'), run: () => actions.restore(entry.path) }
        case 'addFavorite': return { id: action, label: t('tree.addFavorite'), run: () => actions.pin(entry.path) }
        case 'toggle': return { id: action, label: expanded ? t('tree.collapse') : t('tree.expand'), run: () => toggle(entry.path) }
        case 'refresh': return { id: action, label: t('tree.refresh'), run: () => { asked.current.delete(entry.path); load(entry.path) } }
        case 'play': return { id: action, label: t('tree.play'), run: () => actions.open(entry, true) }
        case 'open': return { id: action, label: t('tree.open'), run: () => actions.open(entry, true) }
        case 'openAsList': return { id: action, label: t('tree.openAsList'), run: () => actions.open(entry, true) }
        case 'openAsZip': return { id: action, label: t('tree.openAsZip'), run: () => actions.open(entry, true) }
        case 'openAsHex': return { id: action, label: t('tree.openAsHex'), run: () => actions.open(entry, true, 'hex') }
        case 'openSnapshot': return { id: action, label: t('tree.open'), run: () => actions.openSnapshot(entry, true) }
        case 'openWith': return { id: action, label: t('tree.openWith'), run: () => actions.openWith(entry.path) }
        case 'openDefault': return { id: action, label: t('tree.openDefault'), run: () => actions.openDefault(entry.path) }
        case 'save': return { id: action, label: t('menu.saveAs'), run: () => actions.save(entry.path) }
        case 'reveal': return { id: action, label: t('tabs.reveal'), run: () => actions.reveal(entry.path) }
        case 'copyPath': return { id: action, label: t('tabs.copyPath'), run: () => actions.copy(entry.path) }
        case 'copyName': return { id: action, label: t('tree.copyName'), run: () => actions.copy(entry.name) }
        case 'properties': return { id: action, label: t('tree.properties'), run: () => actions.properties(entry) }
      }
    }
    setMenu({ x: event.clientX, y: event.clientY, label: entry.name, entries: treeMenuFor(entry, { canPin: pinnable(entry), trashItem: trash && !entry.path.includes('/'), media: mediaKind(undefined, entry.name) !== null, writable: changeable(entry) }).map((i): MenuEntry => (i === 'separator' ? { separator: true } : item(i))) })
  }

  // The item that was just named takes the focus once the listing that has it is in.
  useEffect(() => {
    const wanted = pendingFocus.current
    if (wanted && entries.some((r) => r.entry.path === wanted)) {
      pendingFocus.current = null
      focusRow(wanted)
    }
  })

  // What is dropped on a folder row (or on the empty part of the tree: the root) is moved into it.
  const dropOn = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!writable || !e.dataTransfer.types.includes(ENTRY_DRAG)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setDropOver(folder)
    },
    onDragLeave: () => setDropOver((now) => (now === folder ? null : now)),
    onDrop: (e: DragEvent) => {
      setDropOver(null)
      const raw = writable ? e.dataTransfer.getData(ENTRY_DRAG) : ''
      if (!raw) return
      e.preventDefault()
      e.stopPropagation()
      try {
        const dragged = JSON.parse(raw) as { rootId?: unknown; path?: unknown }
        if (dragged.rootId === rootId && typeof dragged.path === 'string' && dragged.path !== folder && dragged.path.split('/').slice(0, -1).join('/') !== folder) actions.move(dragged.path, folder)
      } catch {
        // not ours
      }
    },
  })
  // (A file is not a folder: what is dropped on it goes to the folder it is in.)
  /** The empty part of the tree: New File and New Folder in the root. */
  const backgroundMenu = (event: MouseEvent) => {
    event.preventDefault()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      label: t('sidebar.files'),
      entries: [
        ...(writable ? [{ id: 'newFile', label: t('tree.newFile'), run: () => startNew('', 'file') }, { id: 'newFolder', label: t('tree.newFolder'), run: () => startNew('', 'dir') }, { separator: true } as MenuEntry] : []),
        { id: 'refresh', label: t('tree.refresh'), run: () => { asked.current.delete(''); load('') } },
      ],
    })
  }

  const current = focused ?? entries[0]?.entry.path
  return (
    <>
      <div ref={box} role="tree" aria-label={t('sidebar.rootTreeLabel')} onKeyDown={onKeyDown} onContextMenu={backgroundMenu} {...dropOn('')} className={`@container min-h-full py-0.5 text-[13px] ${dropOver === '' ? 'outline-1 -outline-offset-1 outline-focus' : ''}`}>
        {rows.map((row) => {
          if (row.type === 'note') {
            return (
              <div key={row.key} role="none" style={{ paddingLeft: 8 + row.depth * 8 + 20 }} className={`flex h-[22px] items-center pr-2 text-[12px] ${row.error ? 'text-error' : 'text-fg-muted'}`}>
                <span className="truncate">{row.text}</span>
              </div>
            )
          }
          if (row.type === 'new') {
            return (
              <div key={`${row.parent}\0new`} role="none" style={{ paddingLeft: 8 + row.depth * 8 }} className="flex h-[22px] items-center gap-1 pr-2">
                <span className="w-4 shrink-0" />
                <Icon name={row.kind === 'dir' ? 'folder' : 'file'} className="shrink-0 text-[16px]" />
                <NameInput initial="" label={t('tree.nameInput')} problem={problem} onChange={() => setProblem(null)} onSubmit={(v) => void submit(v)} onCancel={stopEditing} />
              </div>
            )
          }
          const { entry, depth } = row
          const renaming = editing?.mode === 'rename' && editing.path === entry.path
          const expandable = entry.kind === 'dir' || entry.kind === 'zip'
          const expanded = expandable && open.has(entry.path)
          const selected = !expandable && entry.path === activePath
          return (
            <div
              key={entry.path}
              role="treeitem"
              data-path={entry.path}
              data-kind={entry.kind}
              aria-label={entry.name}
              aria-level={depth + 1}
              aria-expanded={expandable ? expanded : undefined}
              aria-selected={selected}
              tabIndex={entry.path === current ? 0 : -1}
              onFocus={() => setFocused(entry.path)}
              onClick={() => (expandable ? toggle(entry.path) : entry.kind === 'wsnp' ? actions.openSnapshot(entry, false) : actions.open(entry, false))}
              onDoubleClick={() => (entry.kind === 'wsnp' ? actions.openSnapshot(entry, true) : !expandable && actions.open(entry, true))}
              draggable={(pinnable(entry) || changeable(entry)) && !renaming}
              onDragStart={(e) => {
                const move = changeable(entry)
                if (pinnable(entry)) e.dataTransfer.setData(FOLDER_DRAG, JSON.stringify({ rootId, path: entry.path }))
                if (move) e.dataTransfer.setData(ENTRY_DRAG, JSON.stringify({ rootId, path: entry.path }))
                e.dataTransfer.effectAllowed = move && pinnable(entry) ? 'linkMove' : move ? 'move' : 'link'
              }}
              {...(changeable(entry) ? dropOn(entry.kind === 'dir' ? entry.path : row.parent) : {})}
              onContextMenu={(e) => contextMenu(e, entry)}
              title={[entry.link ? `${entry.path} (${t('tree.linkOutside')})` : entry.path, ...(expandable && entry.kind === 'dir' ? [] : [formatBytes(entry.size)]), formatDate(entry.modified, language)].join('\n')}
              style={{ paddingLeft: 8 + depth * 8 }}
              className={`flex h-[22px] cursor-pointer items-center gap-1 pr-2 outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus ${entry.hidden ? 'opacity-60' : ''} ${dropOver === entry.path ? 'bg-list-active text-list-active-fg' : selected ? 'bg-list-inactive focus-within:bg-list-active focus-within:text-list-active-fg' : 'hover:bg-list-hover'}`}
            >
              <span className="flex w-4 shrink-0 justify-center">{expandable ? <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className="text-[16px]" /> : null}</span>
              <Icon name={entry.kind === 'dir' ? (expanded ? 'folder-opened' : 'folder') : entry.kind === 'zip' ? 'file-zip' : fileIcon(undefined, entry.name)} className="shrink-0 text-[16px]" />
              {renaming ? (
                <NameInput initial={entry.name} label={t('tree.nameInput')} problem={problem} onChange={() => setProblem(null)} onSubmit={(v) => void submit(v)} onCancel={stopEditing} />
              ) : (
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              )}
              {/* Size and date, small and to the right. Little room: the one the order is by; room for both (a wide side bar): both. */}
              {renaming ? null : entry.kind === 'dir' ? null : <span className={`shrink-0 pl-2 text-[11px] tabular-nums text-fg-muted ${sortKey === 'modified' ? 'hidden @[340px]:inline' : ''}`}>{formatBytes(entry.size)}</span>}
              {renaming ? null : shortDate(entry.modified, language) ? <span className={`shrink-0 pl-2 text-[11px] tabular-nums text-fg-muted ${sortKey === 'modified' ? '' : 'hidden @[340px]:inline'}`}>{shortDate(entry.modified, language)}</span> : null}
            </div>
          )
        })}
        {/* A little room under the last row that belongs to the root: a right click there asks for a new file or folder in it, and a drop there moves into it. */}
        <div role="none" data-blank className="h-10" />
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  )
}
