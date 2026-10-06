import type { DirEntry, ListResult, OpResult } from '@core/api.ts'
import { comparable, type DiffSide } from '@core/diff.ts'
import { mediaKind } from '@core/filekind.ts'
import { nameProblem } from '@core/fs/names.ts'
import { compareEntries, type SortKey } from '@core/fs/sort.ts'
import { listingsAbove, parentPath } from '@core/vpath.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { formatBytes, formatDate, shortDate } from '@/lib/format.ts'
import { fileIcon } from '@/lib/icons.ts'
import { isUnder, remapPath } from '@/state/workspace.ts'
import type { MenuEntry } from '@/components/Menu.tsx'
import { dragging as dragStore, FILE_DRAG, type DraggedFile } from './dnd.ts'
import { FOLDER_DRAG } from './PlacesView.tsx'
import { shortcut } from './commands.ts'
import { fileClipboard, useFileClip } from './fileClipboard.ts'
import { rangeBetween, topmost } from './selection.ts'
import { treeMenuFor, type TreeAction } from './treeMenu.ts'

type Listing = { state: 'loading' } | { state: 'ready'; entries: DirEntry[]; truncated: boolean } | { state: 'error'; error: Extract<ListResult, { error: string }>['error'] }

/** What a row of the tree says when it is dragged to a folder of the same tree: the root it is in and its path there. */
export const ENTRY_DRAG = 'application/x-folder-browser-entry'
/** How long a dragged item rests on a closed folder before the folder opens. */
export const HOVER_OPEN_MS = 600

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
  /** Moves items into a folder (a drop on it). */
  move: (paths: string[], toFolder: string) => void
  /** Asks where to move items to. */
  moveTo: (entries: DirEntry[]) => void
  /** Copies of items in a folder (a drop with Shift held; into the folder they are in, duplicates). */
  copyTo: (paths: string[], toFolder: string) => void
  /** Pastes what was cut or copied (the application's file clipboard, `fileClipboard`) into a folder: a copy, or a move for a cut. */
  paste: (toFolder: string) => void
  /** Asks, and moves items to the trash; `forever` (Shift held): asks to delete them permanently. */
  remove: (entries: DirEntry[], forever?: boolean) => void
  /** Comparing two text files: the file chosen as one side (of any root that is open), choosing one, and comparing with it. */
  compare?: { selected: DiffSide | null; select: (entry: DirEntry) => void; with: (entry: DirEntry) => void; /** Two files marked in the tree: compared, the first as the left side. */ pair: (left: DirEntry, right: DirEntry) => void; /** A text file was dropped on another text file: asks what to do with the two. */ drop: (dragged: { path: string; size: number }, entry: DirEntry) => void }
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
export function ExplorerTree({ rootId, rootKind, trash, writable, createRequest, activePath, showHidden, sortKey, sortDescending, refreshToken, actions }: { /** How the rows of a folder are ordered (folders first, whatever it is), and which of size and date each row shows when there is little room. */ sortKey: SortKey; sortDescending: boolean; rootId: string; rootKind: 'folder' | 'zip'; /** The root is the trash: its top-level rows can be put back. */ trash: boolean; /** Files and folders of this root can be made, renamed, moved and deleted (a folder of the disk, not a ZIP, an entry of a ZIP; not the trash). */ writable: boolean; /** A new file or folder was asked for from outside the tree (the buttons of the side bar): `token` counts the requests. */ createRequest?: { kind: 'file' | 'dir'; token: number } | undefined; activePath?: string | undefined; showHidden: boolean; /** Changes when the user asks to read everything again. */ refreshToken: number; actions: ExplorerActions }) {
  const { t, language } = useI18n()
  const [listings, setListings] = useState<Record<string, Listing>>({})
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState<string | null>(null)
  // The rows marked with Ctrl+click, Shift+click and Shift+arrows (an action on a marked row is on all of them), and where a range starts.
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set())
  const anchor = useRef<string | null>(null)
  // What Cut and Copy took (the rows cut are dimmed, and Paste is offered while there is something to paste).
  const clip = useFileClip()
  // The path to take the focus when the listing that has it comes in (after a rename or a new file).
  const pendingFocus = useRef<string | null>(null)
  // The row being dragged, and the folder the pointer has rested on while dragging (it opens after a moment).
  const dragging = useRef<string[]>([])
  // The file being dragged (what a drag's data cannot say until the drop): a text file dropped on another asks what to do with the two.
  const draggedFile = useRef<DraggedFile | null>(null)
  const hover = useRef<{ path: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  useEffect(
    () => () => {
      if (hover.current) clearTimeout(hover.current.timer)
    },
    [],
  )
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

  /** An item of this root can be changed (a file or folder of the disk, an entry of a ZIP): not in the trash. */
  const canChange = writable && !trash

  // ---- several rows: marked with Ctrl+click, Shift+click, Shift+arrows and Ctrl+A; an action on a marked row is on all of them
  const visiblePaths = useMemo(() => entries.map((r) => r.entry.path), [entries])
  // A mark goes when its row is no longer on screen (deleted, moved, or its folder closed).
  useEffect(() => {
    if (!marked.size) return
    const shown = new Set(visiblePaths)
    const kept = [...marked].filter((path) => shown.has(path))
    if (kept.length !== marked.size) setMarked(new Set(kept))
  })
  const clearMarks = () => setMarked((now) => (now.size ? new Set() : now))
  /** The rows an action on the marked ones is done to: in the order on screen, and not what is in a folder that is marked too. */
  const markedEntries = (): DirEntry[] => {
    const keep = new Set(topmost([...marked]))
    return entries.map((r) => r.entry).filter((e) => keep.has(e.path))
  }
  /** A click with Ctrl (or ⌘) marks or unmarks the row, with Shift marks from where the last one was to it; either is only a mark, nothing opens. */
  const markByClick = (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, entry: DirEntry): boolean => {
    if (event.shiftKey) {
      // (The row clicked has the focus already when the click comes: where the range starts is the anchor, the last row that was clicked or reached by the keys.)
      setMarked(new Set(rangeBetween(visiblePaths, anchor.current, entry.path)))
      if (anchor.current === null) anchor.current = entry.path
      return true
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(marked)
      // The row clicked or reached last is the first one marked, so that Ctrl+click adds to it.
      if (!next.size && anchor.current && anchor.current !== entry.path && visiblePaths.includes(anchor.current)) next.add(anchor.current)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      setMarked(next)
      anchor.current = entry.path
      setFocused(entry.path)
      return true
    }
    clearMarks()
    anchor.current = entry.path
    setFocused(entry.path)
    return false
  }

  // ---- Cut, Copy and Paste of files and folders (Ctrl+X, Ctrl+C, Ctrl+V; ⌘ on macOS; the menus): the application's own clipboard, of this root
  /** The rows Cut and Copy are for: the marked ones, or else the row that has the focus. */
  const clipTargets = (): DirEntry[] => (marked.size > 1 ? markedEntries() : entries.filter((r) => r.entry.path === focused).map((r) => r.entry))
  const takeToClip = (mode: 'copy' | 'cut', group: DirEntry[] = clipTargets()): boolean => {
    if (!canChange || !group.length) return false
    fileClipboard.set({ rootId, paths: group.map((e) => e.path), mode })
    return true
  }
  /** Where Paste puts things: in the folder (or ZIP) that has the focus, else next to the file that has it, else in the root. */
  const pasteFolderFor = (at: DirEntry | undefined): string => (!at ? '' : at.kind === 'dir' || at.kind === 'zip' ? at.path : parentPath(at.path))
  const pasteInto = (folder: string): boolean => {
    if (!canChange || !fileClipboard.get()) return false
    actions.paste(folder)
    return true
  }
  const inField = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  const cutRow = (path: string): boolean => clip !== null && clip.mode === 'cut' && clip.rootId === rootId && clip.paths.some((p) => isUnder(path, p))

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
    const parent = !at ? '' : at.kind === 'dir' || at.kind === 'zip' ? at.path : parentPath(at.path)
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
    // The arrows, Home and End move the focus; with Shift they mark the rows from where the range began.
    const go = (i: number) => {
      const to = entries[i]
      if (!to) return
      if (event.shiftKey) {
        const from = anchor.current ?? row.entry.path
        anchor.current = from
        setMarked(new Set(rangeBetween(visiblePaths, from, to.entry.path)))
      } else {
        clearMarks()
        anchor.current = to.entry.path
      }
      focusRow(to.entry.path)
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setMarked(new Set(visiblePaths))
      return
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && ['c', 'x', 'v'].includes(event.key.toLowerCase())) {
      const key = event.key.toLowerCase()
      const done = key === 'v' ? pasteInto(pasteFolderFor(row.entry)) : takeToClip(key === 'c' ? 'copy' : 'cut', marked.size > 1 ? markedEntries() : [row.entry])
      // (Where nothing can be done, the key is left alone.)
      if (done) event.preventDefault()
      return
    }
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
      case 'Escape':
        if (!marked.size) return
        clearMarks()
        break
      case 'F2':
        if (canChange && marked.size < 2) {
          setProblem(null)
          setEditing({ mode: 'rename', path: row.entry.path })
        }
        break
      case 'Delete':
        // Shift+Delete: the permanent delete, asked about first.
        if (canChange) actions.remove(marked.size > 1 ? markedEntries() : [row.entry], event.shiftKey)
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
    // On a marked row (with others marked) the menu is for all the marked rows; on any other row the marks go.
    if (marked.size > 1 && marked.has(entry.path)) {
      const group = markedEntries()
      const both = group.length === 2 && actions.compare !== undefined && group.every((e) => e.kind === 'file' && comparable(e.name, e.size))
      const many: MenuEntry[] = [
        ...(canChange ? [{ id: 'cut', label: t('tree.cut'), shortcut: shortcut('Ctrl+X'), run: () => takeToClip('cut', group) }, { id: 'copyItems', label: t('tree.copyItems'), shortcut: shortcut('Ctrl+C'), run: () => takeToClip('copy', group) }, { separator: true } as MenuEntry] : []),
        ...(canChange && group.length > 1 ? [{ id: 'moveTo', label: t('tree.moveToMany', { count: group.length }), run: () => actions.moveTo(group) }, { id: 'delete', label: t('tree.deleteMany', { count: group.length }), shortcut: 'Delete', run: () => actions.remove(group) }] : []),
        ...(both ? [{ id: 'compareSelected', label: t('tree.compareSelected'), run: () => actions.compare!.pair(group[0], group[1]) }] : []),
      ]
      if (many.length) return setMenu({ x: event.clientX, y: event.clientY, label: t('tree.selectedCount', { count: marked.size }), entries: many })
    }
    clearMarks()
    const expanded = open.has(entry.path)
    const selectedForCompare = actions.compare?.selected
    const item = (action: TreeAction): MenuEntry => {
      switch (action) {
        case 'cut': return { id: action, label: t('tree.cut'), shortcut: shortcut('Ctrl+X'), run: () => takeToClip('cut', [entry]) }
        case 'copyItems': return { id: action, label: t('tree.copyItems'), shortcut: shortcut('Ctrl+C'), run: () => takeToClip('copy', [entry]) }
        case 'paste': return { id: action, label: t('tree.paste'), shortcut: shortcut('Ctrl+V'), run: () => pasteInto(pasteFolderFor(entry)) }
        case 'newFile': return { id: action, label: t('tree.newFile'), run: () => startNew(entry.path, 'file') }
        case 'newFolder': return { id: action, label: t('tree.newFolder'), run: () => startNew(entry.path, 'dir') }
        case 'rename': return { id: action, label: t('tree.rename'), shortcut: 'F2', run: () => { setProblem(null); setEditing({ mode: 'rename', path: entry.path }) } }
        case 'moveTo': return { id: action, label: t('tree.moveTo'), run: () => actions.moveTo([entry]) }
        case 'delete': return { id: action, label: t('tree.delete'), shortcut: 'Delete', run: () => actions.remove([entry]) }
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
        case 'selectForCompare': return { id: action, label: t('tree.selectForCompare'), run: () => actions.compare?.select(entry) }
        case 'compareWithSelected': return { id: action, label: t('tree.compareWithSelected'), run: () => actions.compare?.with(entry) }
        case 'properties': return { id: action, label: t('tree.properties'), run: () => actions.properties(entry) }
      }
    }
    setMenu({ x: event.clientX, y: event.clientY, label: entry.name, entries: treeMenuFor(entry, { canPin: pinnable(entry), trashItem: trash && !entry.path.includes('/'), canPaste: canChange && clip !== null, media: mediaKind(undefined, entry.name) !== null, writable: canChange, comparable: actions.compare !== undefined && entry.kind === 'file' && comparable(entry.name, entry.size), compareWithSelected: Boolean(selectedForCompare) && !(selectedForCompare!.rootId === rootId && selectedForCompare!.path === entry.path) }).map((i): MenuEntry => (i === 'separator' ? { separator: true } : item(i))) })
  }

  // The item that was just named takes the focus once the listing that has it is in.
  useEffect(() => {
    const wanted = pendingFocus.current
    if (wanted && entries.some((r) => r.entry.path === wanted)) {
      pendingFocus.current = null
      focusRow(wanted)
    }
  })

  // What is dropped on a folder row (or on the empty part of the tree: the root) is moved into it, or copied into it when Shift is held.
  const clearHover = () => {
    if (hover.current) clearTimeout(hover.current.timer)
    hover.current = null
  }
  const dropOn = (folder: string, expandable = false) => ({
    onDragOver: (e: DragEvent) => {
      if (!writable || !e.dataTransfer.types.includes(ENTRY_DRAG)) return
      e.preventDefault()
      e.stopPropagation()
      // Shift held: a copy; else a move.
      e.dataTransfer.dropEffect = e.shiftKey ? 'copy' : 'move'
      setDropOver(folder)
      // Held over a folder that is closed, it opens after a moment (and so on, down to the folder the item is to be dropped in); not the folder that is being dragged.
      if (hover.current?.path !== folder) clearHover()
      if (expandable && !hover.current && !open.has(folder) && !dragging.current.includes(folder)) {
        hover.current = { path: folder, timer: setTimeout(() => toggle(folder, true), HOVER_OPEN_MS) }
      }
    },
    onDragLeave: (e: DragEvent) => {
      // (Moving from the row to something inside it is not leaving it.)
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDropOver((now) => (now === folder ? null : now))
      if (hover.current?.path === folder) clearHover()
    },
    onDrop: (e: DragEvent) => {
      setDropOver(null)
      clearHover()
      const raw = writable ? e.dataTransfer.getData(ENTRY_DRAG) : ''
      if (!raw) return
      e.preventDefault()
      e.stopPropagation()
      try {
        const dragged = JSON.parse(raw) as { rootId?: unknown; path?: unknown; paths?: unknown }
        if (dragged.rootId !== rootId || typeof dragged.path !== 'string') return
        // (Several rows dragged together name all of them in `paths`.)
        const all = Array.isArray(dragged.paths) && dragged.paths.every((p) => typeof p === 'string') && dragged.paths.length ? (dragged.paths as string[]) : [dragged.path]
        // A folder dropped on itself is nothing.
        const paths = all.filter((path) => path !== folder)
        if (!paths.length) return
        // With Shift: a copy (into the folder it is in too: a duplicate). Without: a move, which into the folder it is in is nothing.
        if (e.shiftKey) actions.copyTo(paths, folder)
        else {
          const moving = paths.filter((path) => parentPath(path) !== folder)
          if (moving.length) actions.move(moving, folder)
        }
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
        ...(canChange && clip ? [{ id: 'paste', label: t('tree.paste'), shortcut: shortcut('Ctrl+V'), run: () => pasteInto('') }] : []),
        { id: 'refresh', label: t('tree.refresh'), run: () => { asked.current.delete(''); load('') } },
      ],
    })
  }

  /** The file being dragged and this one are both texts that can be compared: dropped on it, the user is asked what to do with the two (and nothing is moved). */
  const asCompare = (entry: DirEntry): boolean => {
    const from = draggedFile.current
    return actions.compare !== undefined && entry.kind === 'file' && comparable(entry.name, entry.size) && from !== null && from.path !== entry.path && comparable(from.name, from.size)
  }
  const current = focused ?? entries[0]?.entry.path
  return (
    <>
      <div ref={box} role="tree" aria-multiselectable="true" onCopy={(e) => { if (!inField(e.target) && takeToClip('copy')) e.preventDefault() }} onCut={(e) => { if (!inField(e.target) && takeToClip('cut')) e.preventDefault() }} onPaste={(e) => { if (!inField(e.target) && pasteInto(pasteFolderFor(entries.find((r) => r.entry.path === focused)?.entry))) e.preventDefault() }} aria-label={t('sidebar.rootTreeLabel')} onKeyDown={onKeyDown} onContextMenu={backgroundMenu} {...dropOn('')} className={`@container min-h-full py-0.5 text-[13px] select-none ${dropOver === '' ? 'outline-1 -outline-offset-1 outline-focus' : ''}`}>
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
          const folderDrop = canChange ? dropOn(entry.kind === 'dir' ? entry.path : row.parent, entry.kind === 'dir') : undefined
          return (
            <div
              key={entry.path}
              role="treeitem"
              data-path={entry.path}
              data-kind={entry.kind}
              aria-label={entry.name}
              aria-level={depth + 1}
              aria-expanded={expandable ? expanded : undefined}
              aria-selected={selected || marked.has(entry.path)}
              data-marked={marked.has(entry.path) ? 'true' : undefined}
              tabIndex={entry.path === current ? 0 : -1}
              onFocus={() => setFocused(entry.path)}
              onClick={(e) => {
                if (markByClick(e, entry)) return
                if (expandable) toggle(entry.path)
                else if (entry.kind === 'wsnp') actions.openSnapshot(entry, false)
                else actions.open(entry, false)
              }}
              onDoubleClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey) return
                if (entry.kind === 'wsnp') actions.openSnapshot(entry, true)
                else if (!expandable) actions.open(entry, true)
              }}
              draggable={(pinnable(entry) || canChange || entry.kind === 'file') && !renaming}
              onDragStart={(e) => {
                const move = canChange
                // A marked row drags all the marked rows; any other row drags itself and the marks go.
                const together = marked.size > 1 && marked.has(entry.path)
                if (!together) clearMarks()
                const group = together ? markedEntries() : [entry]
                // Any file can be dragged to the editor (to open it there) or onto another text file.
                if (entry.kind === 'file' && group.length === 1) {
                  draggedFile.current = { rootId, path: entry.path, name: entry.name, size: entry.size }
                  e.dataTransfer.setData(FILE_DRAG, JSON.stringify(draggedFile.current))
                  dragStore.start('file', undefined, draggedFile.current)
                }
                if (pinnable(entry) && group.length === 1) e.dataTransfer.setData(FOLDER_DRAG, JSON.stringify({ rootId, path: entry.path }))
                if (move) e.dataTransfer.setData(ENTRY_DRAG, JSON.stringify({ rootId, path: entry.path, paths: group.map((g) => g.path) }))
                dragging.current = move ? group.map((e) => e.path) : []
                e.dataTransfer.effectAllowed = group.length === 1 && (entry.kind === 'file' || (move && pinnable(entry))) ? 'all' : move ? 'copyMove' : 'copy'
              }}
              onDragEnd={() => {
                dragging.current = []
                draggedFile.current = null
                dragStore.end()
                clearHover()
                setDropOver(null)
              }}
              onDragOver={(e) => {
                if (asCompare(entry) && !e.shiftKey && e.dataTransfer.types.includes(FILE_DRAG)) {
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'copy'
                  return setDropOver(entry.path)
                }
                folderDrop?.onDragOver(e)
              }}
              onDragLeave={(e) => {
                if (asCompare(entry) && !e.shiftKey) {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver((now) => (now === entry.path ? null : now))
                  return
                }
                folderDrop?.onDragLeave(e)
              }}
              onDrop={(e) => {
                const from = draggedFile.current
                if (asCompare(entry) && !e.shiftKey && from) {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropOver(null)
                  return actions.compare!.drop({ path: from.path, size: from.size }, entry)
                }
                folderDrop?.onDrop(e)
              }}
              onContextMenu={(e) => contextMenu(e, entry)}
              title={[entry.link ? `${entry.path} (${t('tree.linkOutside')})` : entry.path, ...(expandable && entry.kind === 'dir' ? [] : [formatBytes(entry.size)]), formatDate(entry.modified, language)].join('\n')}
              style={{ paddingLeft: 8 + depth * 8 }}
              className={`flex h-[22px] cursor-pointer items-center gap-1 pr-2 outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus ${entry.hidden || cutRow(entry.path) ? 'opacity-60' : ''} ${dropOver === entry.path || marked.has(entry.path) ? 'bg-list-active text-list-active-fg' : selected ? 'bg-list-inactive focus-within:bg-list-active focus-within:text-list-active-fg' : 'hover:bg-list-hover'}`}
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
