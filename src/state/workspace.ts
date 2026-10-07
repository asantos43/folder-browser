import type { IntegrityEvent, RootInfo } from '@core/api.ts'
import { UNTITLED_ROOT, untitledKey, type DiffSide } from '@core/diff.ts'
import type { SnapshotInfo } from '@core/snapshots.ts'
import type { IntegrityReport } from '@core/validate/index.ts'
import type { Issue } from '@core/validate/issues.ts'

/**
 * What is open: the snapshots and the tabs of the one editor group. All of it is plain data changed by a pure function, so
 * every rule of VS Code's tabs (preview, pinned, close others, most-recently-used order) is tested without a window.
 */
export interface Tab {
  /** `s:<snapshot id>` for a snapshot, `f:<snapshot id>:<path>` for one of its files. */
  key: string
  snapshotId: string
  /** The file's path in the archive; absent for the tab of the snapshot itself. */
  path?: string
  /** The size of a file that is an entry of a ZIP (the manifest does not list it), known when it is opened from the ZIP's list. */
  size?: number
  /** How the file is shown when the user chose, whatever its kind: its bytes (hexadecimal). The same file can be open in a tab of its own kind and in one of these. */
  as?: 'hex'
  /** A view that is not a file: a snapshot's metadata, the settings, two files compared (`diff`; `snapshotId` is the left side's root), or a new text file that exists only in the window (`untitled`, key `u:<n>`, no path). */
  view?: 'metadata' | 'settings' | 'diff' | 'guide' | 'untitled'
  /** The two files of a comparison: files of the folders and ZIP files that were opened, read-only. */
  diff?: { left: DiffSide; right: DiffSide }
  /** The editor group the tab is in: absent for the first (left) one, 1 for the second (right) one, which exists only while it has tabs. */
  group?: 1
  /** Shown in italics and replaced by the next single click, until it is kept (double click, or a tab of the snapshot itself). */
  preview: boolean
  pinned: boolean
}

export type IntegrityState = { state: 'running'; done: number; total: number } | { state: 'done'; report: IntegrityReport }

/** The editor groups: the left one, and the right one that a tab is dragged or split into. */
export type GroupId = 0 | 1
export const groupOf = (tab: Tab): GroupId => (tab.group === 1 ? 1 : 0)

export interface Workspace {
  snapshots: Record<string, SnapshotInfo>
  /** The folders and ZIP files opened to browse. A tab of one of their files has the root's id in `snapshotId`. */
  roots: Record<string, RootInfo>
  tabs: Tab[]
  /** The tab in front in the group that has the focus: what the menus, the keys, Find and Save act on. */
  active: string | null
  /** The group that has the focus. */
  focus: GroupId
  /** The tab in front in the group that has not the focus (null: there is no other group). */
  other: string | null
  /** Keys of the tabs, the one used last first. */
  recent: string[]
  /** The snapshot or root whose files the side bar shows. */
  selected: string | null
  integrity: Record<string, IntegrityState>
  /** Snapshots found not valid that the user chose to see anyway. */
  shownAnyway: Record<string, true>
  /** The tabs of a text file that has changes not saved (by key): the tab says so, closing it asks, and the window asks before it closes. */
  dirty: Record<string, true>
}

export const empty: Workspace = { snapshots: {}, roots: {}, tabs: [], active: null, focus: 0, other: null, recent: [], selected: null, integrity: {}, shownAnyway: {}, dirty: {} }

export const snapshotKey = (id: string) => `s:${id}`
export const metadataKey = (id: string) => `m:${id}`
export const SETTINGS_KEY = 'settings'
export const GUIDE_KEY = 'guide'
/** The tab in front in a group. */
export const shownIn = (ws: Workspace, group: GroupId): string | null => (group === ws.focus ? ws.active : ws.other)
/** The workspace as one group sees it: its tabs, and the one in front of it as the active one. */
export const groupView = (ws: Workspace, group: GroupId): Workspace => ({ ...ws, tabs: ws.tabs.filter((t) => groupOf(t) === group), active: shownIn(ws, group) })
/** Whether there are two groups. */
export const isSplit = (ws: Workspace): boolean => ws.tabs.some((t) => t.group === 1)
/** The tab of a snapshot itself (its page), as against one of its files or of its metadata. */
export const isSnapshotTab = (tab: Tab): boolean => tab.path === undefined && tab.view === undefined

/** What makes a snapshot not valid: a file that is not what the manifest says (FORMAT.md section 10, step 7), or a manifest that is not what was signed. Scans of the page are warnings, not this. */
const INVALID: readonly Issue['code'][] = ['hash-mismatch', 'size-mismatch', 'read-error']
export const invalidProblems = (ws: Workspace, id: string): Issue[] => {
  const state = ws.integrity[id]
  const files = state?.state === 'done' ? state.report.problems.filter((p) => INVALID.includes(p.code)) : []
  // A signature that does not check means the manifest was edited after it was signed: known at once, as it is the manifest's own.
  const signature = ws.snapshots[id]?.signature
  return signature?.state === 'invalid' ? [{ code: 'signature-invalid', path: 'manifest.json', detail: signature.reason }, ...files] : files
}
/** Not valid, and not yet chosen to be shown anyway: the page is held back. */
export const isHeldBack = (ws: Workspace, id: string): boolean => invalidProblems(ws, id).length > 0 && !ws.shownAnyway[id]
export const fileKey = (id: string, path: string) => `f:${id}:${path}`
/** The tab of a file shown as its bytes: a key of its own, so that the file can be open both ways. */
export const hexKey = (id: string, path: string) => `x:${id}:${path}`
/** The tab of two files compared: one tab for the pair, in the order given. */
export const diffKey = (left: DiffSide, right: DiffSide) => `d:${left.rootId}:${left.path}\0${right.rootId}:${right.path}`

/** Whether `path` is `from` or something inside it (a folder, or a ZIP file and its entries: `from!/…`). */
export const isUnder = (path: string, from: string): boolean => path === from || path.startsWith(`${from}/`) || path.startsWith(`${from}!/`)

/** `path` after `from` became `to`; the same path when it was not under `from`. */
export const remapPath = (path: string, from: string, to: string): string => (isUnder(path, from) ? to + path.slice(from.length) : path)

/** The key of a tab of a file or of a comparison, by how it is shown. */
const keyOfFileTab = (tab: Tab): string => (tab.diff ? diffKey(tab.diff.left, tab.diff.right) : tab.as === 'hex' ? hexKey(tab.snapshotId, tab.path!) : fileKey(tab.snapshotId, tab.path!))

/** Whether the tab shows `path` of the root `rootId` or something in it: its file, or a side of its comparison. */
const touches = (t: Tab, rootId: string, path: string): boolean =>
  (t.snapshotId === rootId && t.path !== undefined && isUnder(t.path, path)) || (t.diff !== undefined && [t.diff.left, t.diff.right].some((side) => side.rootId === rootId && isUnder(side.path, path)))

export type Action =
  /**
   * The page of a snapshot, in a tab. `preview`: shown as a file is on a single click (an italic tab, replaced by the next preview); otherwise it is kept. A snapshot is a page,
   * never what the side bar shows: that is a folder (or a ZIP file) that was opened.
   */
  | { type: 'snapshot-opened'; snapshot: SnapshotInfo; preview?: boolean }
  | { type: 'root-opened'; root: RootInfo }
  | { type: 'root-closed'; id: string }
  /** Two files compared, in a tab of their own (kept, beside the active tab). */
  | { type: 'open-diff'; left: DiffSide; right: DiffSide }
  /** A new text file that exists only in the window, in a tab of its own (kept, beside the active tab, in the group that has the focus). */
  | { type: 'open-untitled'; /** The tab it was (`u:<n>`) when it comes back from the last session; else the lowest number that is free. */ key?: string }
  | { type: 'open-file'; snapshotId: string; path: string; keep: boolean; /** Of an entry of a ZIP (`zip!/entry`). */ size?: number; /** Show the bytes (hexadecimal) instead of what the kind of the file gets. */ as?: 'hex'; /** The group to open it in (a tab of the file that is in the other group goes there); else the one that has the focus. */ group?: GroupId }
  /** A tab goes to a group (the second one is made if it was not there), next to the tab `at` when that one is in the group (before it, or `after` it), else after the one in front of the group; it comes to the front and the group has the focus. */
  | { type: 'move-to-group'; key: string; group: GroupId; at?: { key: string; after: boolean } }
  /** An item of a folder was renamed or moved: the tabs of it (and of what is in it) follow it, keeping their place, their preview and their pin. */
  | { type: 'path-changed'; rootId: string; from: string; to: string }
  /** An item of a folder was deleted: the tabs of it (and of what was in it) close. */
  | { type: 'path-removed'; rootId: string; path: string }
  /** The text of a tab differs from what is saved (or is the same again). */
  | { type: 'dirty'; key: string; dirty: boolean }
  | { type: 'open-metadata'; snapshotId: string }
  | { type: 'open-settings' }
  /** The user guide, in a tab of its own (one at most). */
  | { type: 'open-guide' }
  | { type: 'show-anyway'; snapshotId: string }
  | { type: 'activate'; key: string; /** Do not count it as the most recent (a Ctrl+Tab in progress). */ transient?: boolean }
  | { type: 'touch' }
  | { type: 'keep'; key: string }
  | { type: 'close'; key: string }
  | { type: 'close-others'; key: string }
  | { type: 'close-right'; key: string }
  | { type: 'close-all' }
  | { type: 'pin'; key: string; pinned: boolean }
  | { type: 'move'; key: string; to: number }
  | { type: 'step'; direction: 1 | -1 }
  /** The side bar goes to a folder (or ZIP file) that is open. */
  | { type: 'select'; snapshotId: string }
  | { type: 'integrity'; event: IntegrityEvent }

/** Pinned tabs come first, in the order they have; the rest keep theirs. */
const arranged = (tabs: Tab[]): Tab[] => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]

/** Bringing a tab to the front: a file of an open folder takes the side bar to that folder; the page of a snapshot, its metadata and its files never do (a snapshot is a page, not a folder). */
function withActive(ws: Workspace, key: string | null, touch = true): Workspace {
  if (key === null) return { ...ws, active: null }
  const tab = ws.tabs.find((t) => t.key === key)
  const follows = tab !== undefined && ws.roots[tab.snapshotId] !== undefined
  // A tab of the other group takes the focus to its group; the tab that was in front there stays in front of the group that lost it.
  const toOther = tab !== undefined && groupOf(tab) !== ws.focus
  const groups = toOther ? { focus: groupOf(tab), other: ws.active } : {}
  return { ...ws, ...groups, active: key, selected: follows ? tab.snapshotId : ws.selected, recent: touch ? [key, ...ws.recent.filter((k) => k !== key)] : ws.recent }
}

/**
 * Makes the groups true after tabs went or moved: each group has a tab in front (the most recently used one that is left when its own is gone), the second group ends when it
 * has no tab (and the focus goes to the first), and a first group with no tab leaves the second as the only one.
 */
function normalize(ws: Workspace): Workspace {
  const mine = (group: GroupId) => ws.tabs.filter((t) => groupOf(t) === group)
  const pick = (group: GroupId, current: string | null): string | null => {
    const tabs = mine(group)
    if (current !== null && tabs.some((t) => t.key === current)) return current
    // As VS Code does: the most recently used tab that is left.
    return ws.recent.find((k) => tabs.some((t) => t.key === k)) ?? tabs.at(-1)?.key ?? null
  }
  let first = pick(0, shownIn(ws, 0))
  let second = pick(1, shownIn(ws, 1))
  let { tabs, focus } = ws
  if (!mine(1).length) {
    focus = 0
    second = null
  } else if (!mine(0).length) {
    tabs = tabs.map((t) => {
      const { group: _gone, ...rest } = t
      return rest
    })
    first = second
    second = null
    focus = 0
  }
  return { ...ws, tabs, focus, active: focus === 0 ? first : second, other: focus === 0 ? second : first }
}

/** A tab goes to a group (see `move-to-group`). */
function moveToGroup(ws: Workspace, key: string, group: GroupId, place?: { key: string; after: boolean }): Workspace {
  const tab = ws.tabs.find((t) => t.key === key)
  if (!tab) return ws
  const { group: _was, ...plain } = tab
  const moved: Tab = group === 1 ? { ...plain, group: 1 } : plain
  const rest = ws.tabs.filter((t) => t.key !== key)
  const near = place ? rest.findIndex((t) => t.key === place.key && groupOf(t) === group) : -1
  // Next to the tab it was dropped on; else after the one in front of the group, or at the end.
  const front = near >= 0 ? -1 : rest.findIndex((t) => t.key === shownIn(ws, group) && groupOf(t) === group)
  const at = near >= 0 ? near + (place!.after ? 1 : 0) : front >= 0 ? front + 1 : rest.length
  const tabs = arranged([...rest.slice(0, at), moved, ...rest.slice(at)])
  return normalize(withActive({ ...ws, tabs }, key))
}

/** Removes the tabs of the given keys, and the snapshots that are left without a tab of their own. */
function without(ws: Workspace, keys: Set<string>): Workspace {
  // A comparison with a new text file (it exists only in its tab) goes with it.
  for (const t of ws.tabs) if (t.diff && [t.diff.left, t.diff.right].some((side) => side.rootId === UNTITLED_ROOT && keys.has(side.path))) keys = new Set([...keys, t.key])
  let tabs = ws.tabs.filter((t) => !keys.has(t.key))
  // A snapshot's own tab closing closes the snapshot: the tabs of its files go with it.
  const closed = new Set(ws.tabs.filter((t) => keys.has(t.key) && isSnapshotTab(t)).map((t) => t.snapshotId))
  tabs = tabs.filter((t) => !closed.has(t.snapshotId))
  const snapshots = { ...ws.snapshots }
  const integrity = { ...ws.integrity }
  const shownAnyway = { ...ws.shownAnyway }
  for (const id of closed) {
    delete snapshots[id]
    delete integrity[id]
    delete shownAnyway[id]
  }
  const alive = new Set(tabs.map((t) => t.key))
  const recent = ws.recent.filter((k) => alive.has(k))
  const dirty = Object.fromEntries(Object.entries(ws.dirty).filter(([key]) => alive.has(key))) as Record<string, true>
  const next = normalize({ ...ws, tabs, snapshots, integrity, shownAnyway, recent, dirty })
  const active = next.active
  const activeTab = active ? next.tabs.find((t) => t.key === active) : undefined
  const ofRoot = activeTab && ws.roots[activeTab.snapshotId] ? activeTab.snapshotId : undefined
  const exists = (id: string | null): id is string => id !== null && Boolean(ws.roots[id])
  return { ...next, selected: ofRoot ?? (exists(ws.selected) ? ws.selected : (Object.keys(ws.roots)[0] ?? null)) }
}

export function reduce(ws: Workspace, action: Action): Workspace {
  switch (action.type) {
    case 'snapshot-opened': {
      const { id } = action.snapshot
      const key = snapshotKey(id)
      const snapshots = { ...ws.snapshots, [id]: action.snapshot }
      const existing = ws.tabs.find((t) => t.key === key)
      if (existing) {
        // A double click keeps what was only previewed; a preview of what is kept changes nothing.
        const tabs = existing.preview && !action.preview ? ws.tabs.map((t) => (t.key === key ? { ...t, preview: false } : t)) : ws.tabs
        return withActive({ ...ws, snapshots, tabs }, key)
      }
      const tab: Tab = { key, snapshotId: id, preview: action.preview === true, pinned: false }
      if (!tab.preview) return withActive({ ...ws, snapshots, tabs: arranged([...ws.tabs, tab]) }, key)
      // A preview takes the place of the one before it, and that one (a snapshot too, perhaps) is closed.
      const old = ws.tabs.findIndex((t) => t.preview && !t.pinned && groupOf(t) === 0)
      if (old < 0) return withActive({ ...ws, snapshots, tabs: arranged([...ws.tabs, tab]) }, key)
      const base = without({ ...ws, snapshots }, new Set([ws.tabs[old].key]))
      return withActive({ ...base, tabs: arranged([...base.tabs.slice(0, old), tab, ...base.tabs.slice(old)]) }, key)
    }
    case 'root-opened': {
      const roots = { ...ws.roots, [action.root.id]: action.root }
      return { ...ws, roots, selected: action.root.id }
    }
    case 'root-closed': {
      if (!ws.roots[action.id]) return ws
      const roots = { ...ws.roots }
      delete roots[action.id]
      return without({ ...ws, roots }, new Set(ws.tabs.filter((t) => t.snapshotId === action.id || t.diff?.right.rootId === action.id).map((t) => t.key)))
    }
    case 'open-file': {
      const key = action.as === 'hex' ? hexKey(action.snapshotId, action.path) : fileKey(action.snapshotId, action.path)
      const existing = ws.tabs.find((t) => t.key === key)
      if (existing) {
        const there = action.group !== undefined && groupOf(existing) !== action.group ? moveToGroup(ws, key, action.group) : ws
        const tabs = existing.preview && action.keep ? there.tabs.map((t) => (t.key === key ? { ...t, preview: false } : t)) : there.tabs
        return normalize(withActive({ ...there, tabs }, key))
      }
      const group = action.group ?? ws.focus
      const tab: Tab = { key, snapshotId: action.snapshotId, path: action.path, ...(action.size === undefined ? {} : { size: action.size }), ...(action.as ? { as: action.as } : {}), ...(group === 1 ? { group: 1 as const } : {}), preview: !action.keep, pinned: false }
      // A new preview takes the place of the old one (of its group); a kept tab opens beside the one in front of its group, as VS Code does.
      const old = tab.preview ? ws.tabs.findIndex((t) => t.preview && !t.pinned && groupOf(t) === group) : -1
      // (A snapshot that was only previewed goes with its preview: the snapshot is closed, not left open with no tab.)
      if (old >= 0 && isSnapshotTab(ws.tabs[old])) {
        const base = without(ws, new Set([ws.tabs[old].key]))
        return normalize(withActive({ ...base, tabs: arranged([...base.tabs.slice(0, old), tab, ...base.tabs.slice(old)]) }, key))
      }
      let tabs: Tab[]
      if (old >= 0) tabs = ws.tabs.map((t, i) => (i === old ? tab : t))
      else {
        const at = ws.tabs.findIndex((t) => t.key === shownIn(ws, group))
        tabs = at < 0 ? [...ws.tabs, tab] : [...ws.tabs.slice(0, at + 1), tab, ...ws.tabs.slice(at + 1)]
        tabs = arranged(tabs)
      }
      const replaced = old >= 0 ? ws.tabs[old].key : null
      return normalize(withActive({ ...ws, tabs, recent: ws.recent.filter((k) => k !== replaced) }, key))
    }
    case 'path-changed': {
      const moved = (t: Tab) => touches(t, action.rootId, action.from)
      if (!ws.tabs.some(moved)) return ws
      const keys = new Map<string, string>()
      const follow = (side: DiffSide): DiffSide => (side.rootId === action.rootId ? { ...side, path: remapPath(side.path, action.from, action.to) } : side)
      let tabs = ws.tabs.map((t) => {
        if (!moved(t)) return t
        const next: Tab = t.diff ? { ...t, diff: { left: follow(t.diff.left), right: follow(t.diff.right) } } : { ...t, path: remapPath(t.path!, action.from, action.to) }
        next.key = keyOfFileTab(next)
        keys.set(t.key, next.key)
        return next
      })
      // A tab already open at the new name (it cannot be: a name that was taken is refused) would be two of the same: the one that moved stays.
      const seen = new Set<string>()
      tabs = tabs.filter((t, i) => {
        const keep = !seen.has(t.key) || tabs.findIndex((o) => o.key === t.key) !== i
        seen.add(t.key)
        return keep
      })
      const rekey = (key: string | null) => (key !== null ? (keys.get(key) ?? key) : null)
      const alive = new Set(tabs.map((t) => t.key))
      const dirty = Object.fromEntries(Object.keys(ws.dirty).map((k) => [rekey(k)!, true as const])) as Record<string, true>
      return { ...ws, tabs, active: rekey(ws.active), other: rekey(ws.other), recent: [...new Set(ws.recent.map((k) => rekey(k)!))].filter((k) => alive.has(k)), dirty }
    }
    case 'path-removed': {
      const gone = ws.tabs.filter((t) => touches(t, action.rootId, action.path))
      return gone.length ? without(ws, new Set(gone.map((t) => t.key))) : ws
    }
    case 'dirty': {
      if (!ws.tabs.some((t) => t.key === action.key) || Boolean(ws.dirty[action.key]) === action.dirty) return ws
      const dirty = { ...ws.dirty }
      if (action.dirty) dirty[action.key] = true
      else delete dirty[action.key]
      return { ...ws, dirty }
    }
    case 'open-untitled': {
      const used = new Set(ws.tabs.filter((t) => t.view === 'untitled').map((t) => t.key))
      let n = 1
      while (used.has(untitledKey(n))) n++
      const key = action.key !== undefined && /^u:[1-9]\d{0,5}$/.test(action.key) ? action.key : untitledKey(n)
      if (used.has(key)) return withActive(ws, key)
      const tab: Tab = { key, snapshotId: '', view: 'untitled', ...(ws.focus === 1 ? { group: 1 as const } : {}), preview: false, pinned: false }
      const at = ws.tabs.findIndex((t) => t.key === ws.active)
      const tabs = at < 0 ? [...ws.tabs, tab] : [...ws.tabs.slice(0, at + 1), tab, ...ws.tabs.slice(at + 1)]
      return withActive({ ...ws, tabs: arranged(tabs) }, key)
    }
    case 'open-diff': {
      const key = diffKey(action.left, action.right)
      const exists = (side: DiffSide) => (side.rootId === UNTITLED_ROOT ? ws.tabs.some((t) => t.key === side.path) : Boolean(ws.roots[side.rootId]))
      if (!exists(action.left) || !exists(action.right)) return ws
      if (ws.tabs.some((t) => t.key === key)) return withActive(ws, key)
      const tab: Tab = { key, snapshotId: action.left.rootId, view: 'diff', diff: { left: action.left, right: action.right }, ...(ws.focus === 1 ? { group: 1 as const } : {}), preview: false, pinned: false }
      const at = ws.tabs.findIndex((t) => t.key === ws.active)
      const tabs = at < 0 ? [...ws.tabs, tab] : [...ws.tabs.slice(0, at + 1), tab, ...ws.tabs.slice(at + 1)]
      return withActive({ ...ws, tabs: arranged(tabs) }, key)
    }
    case 'open-metadata': {
      const key = metadataKey(action.snapshotId)
      if (!ws.snapshots[action.snapshotId]) return ws
      if (ws.tabs.some((t) => t.key === key)) return withActive(ws, key)
      const tab: Tab = { key, snapshotId: action.snapshotId, view: 'metadata', preview: false, pinned: false }
      const at = ws.tabs.findIndex((t) => t.key === ws.active)
      const tabs = at < 0 ? [...ws.tabs, tab] : [...ws.tabs.slice(0, at + 1), tab, ...ws.tabs.slice(at + 1)]
      return withActive({ ...ws, tabs: arranged(tabs) }, key)
    }
    case 'open-guide': {
      if (ws.tabs.some((t) => t.key === GUIDE_KEY)) return withActive(ws, GUIDE_KEY)
      const tab: Tab = { key: GUIDE_KEY, snapshotId: '', view: 'guide', ...(ws.focus === 1 ? { group: 1 as const } : {}), preview: false, pinned: false }
      const at = ws.tabs.findIndex((t) => t.key === ws.active)
      const tabs = at < 0 ? [...ws.tabs, tab] : [...ws.tabs.slice(0, at + 1), tab, ...ws.tabs.slice(at + 1)]
      return withActive({ ...ws, tabs: arranged(tabs) }, GUIDE_KEY)
    }
    case 'open-settings': {
      if (ws.tabs.some((t) => t.key === SETTINGS_KEY)) return withActive(ws, SETTINGS_KEY)
      const tab: Tab = { key: SETTINGS_KEY, snapshotId: '', view: 'settings', preview: false, pinned: false }
      const at = ws.tabs.findIndex((t) => t.key === ws.active)
      const tabs = at < 0 ? [...ws.tabs, tab] : [...ws.tabs.slice(0, at + 1), tab, ...ws.tabs.slice(at + 1)]
      return withActive({ ...ws, tabs: arranged(tabs) }, SETTINGS_KEY)
    }
    case 'show-anyway':
      return ws.snapshots[action.snapshotId] ? { ...ws, shownAnyway: { ...ws.shownAnyway, [action.snapshotId]: true } } : ws
    case 'activate':
      return ws.tabs.some((t) => t.key === action.key) ? withActive(ws, action.key, !action.transient) : ws
    case 'keep':
      return { ...ws, tabs: ws.tabs.map((t) => (t.key === action.key && t.preview ? { ...t, preview: false } : t)) }
    case 'touch':
      return ws.active ? withActive(ws, ws.active) : ws
    case 'close':
      return ws.tabs.some((t) => t.key === action.key) ? without(ws, new Set([action.key])) : ws
    case 'close-others': {
      const tab = ws.tabs.find((t) => t.key === action.key)
      if (!tab) return ws
      return without(ws, new Set(ws.tabs.filter((t) => t.key !== action.key && !t.pinned && groupOf(t) === groupOf(tab)).map((t) => t.key)))
    }
    case 'close-right': {
      const at = ws.tabs.findIndex((t) => t.key === action.key)
      if (at < 0) return ws
      const group = groupOf(ws.tabs[at])
      return without(ws, new Set(ws.tabs.slice(at + 1).filter((t) => !t.pinned && groupOf(t) === group).map((t) => t.key)))
    }
    case 'close-all':
      return without(ws, new Set(ws.tabs.filter((t) => !t.pinned).map((t) => t.key)))
    case 'pin': {
      const tabs = arranged(ws.tabs.map((t) => (t.key === action.key ? { ...t, pinned: action.pinned, preview: action.pinned ? false : t.preview } : t)))
      return { ...ws, tabs }
    }
    case 'move': {
      const from = ws.tabs.findIndex((t) => t.key === action.key)
      if (from < 0) return ws
      const tab = ws.tabs[from]
      const rest = ws.tabs.filter((t) => t.key !== action.key)
      // A tab stays on its own side of the pinned ones.
      const pinnedCount = rest.filter((t) => t.pinned).length
      const to = Math.max(tab.pinned ? 0 : pinnedCount, Math.min(tab.pinned ? pinnedCount : rest.length, action.to))
      return { ...ws, tabs: [...rest.slice(0, to), tab, ...rest.slice(to)] }
    }
    case 'step': {
      // Through the tabs of the group that has the focus.
      const mine = ws.tabs.filter((t) => groupOf(t) === ws.focus)
      if (!mine.length) return ws
      const at = mine.findIndex((t) => t.key === ws.active)
      const next = mine[(at + action.direction + mine.length) % mine.length]
      return withActive(ws, next.key)
    }
    case 'move-to-group':
      return moveToGroup(ws, action.key, action.group, action.at)
    case 'select':
      return ws.roots[action.snapshotId] ? { ...ws, selected: action.snapshotId } : ws
    case 'integrity': {
      const { event } = action
      if (!ws.snapshots[event.id]) return ws
      const state: IntegrityState = event.state === 'running' ? { state: 'running', done: event.done, total: event.total } : { state: 'done', report: event.report }
      return { ...ws, integrity: { ...ws.integrity, [event.id]: state } }
    }
  }
}

/** The ids of snapshots and roots that were open and are not: the main process is told to release them. */
export const released = (before: Workspace, after: Workspace): string[] => [...Object.keys(before.snapshots).filter((id) => !after.snapshots[id]), ...Object.keys(before.roots).filter((id) => !after.roots[id])]
