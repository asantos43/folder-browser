import { fileKey, isSnapshotTab, metadataKey, snapshotKey, type Workspace } from './workspace.ts'

/** What is remembered of the tabs at the end of a session: only names (the path of each snapshot, and of each file in it), never contents. */
export interface SessionTab {
  /** The path of the snapshot on this computer. */
  snapshot: string
  kind: 'page' | 'file' | 'metadata'
  /** The path of the file in the snapshot, for a file tab. */
  file?: string
  /** The size of a file that is an entry of a ZIP (the manifest does not list it). */
  size?: number
  pinned?: boolean
}

export interface Session {
  tabs: SessionTab[]
  /** Index in `tabs` of the tab that was in front; -1 for none. */
  active: number
}

const MAX_TABS = 100

/** The tabs as they are, in order. Settings is not remembered: it is one key away. */
export function sessionOf(ws: Workspace): Session {
  const tabs: SessionTab[] = []
  let active = -1
  for (const tab of ws.tabs) {
    const snapshot = ws.snapshots[tab.snapshotId]?.path
    if (!snapshot || tabs.length >= MAX_TABS) continue
    if (tab.key === ws.active) active = tabs.length
    if (tab.view === 'metadata') tabs.push({ snapshot, kind: 'metadata' })
    else if (tab.path !== undefined) tabs.push({ snapshot, kind: 'file', file: tab.path, ...(tab.size === undefined ? {} : { size: tab.size }), ...(tab.pinned ? { pinned: true } : {}) })
    else if (isSnapshotTab(tab)) tabs.push({ snapshot, kind: 'page', ...(tab.pinned ? { pinned: true } : {}) })
  }
  return { tabs, active }
}

/** The key the tab of a session entry has once its snapshot is open with `id`. */
export function keyOfEntry(entry: SessionTab, id: string): string {
  return entry.kind === 'page' ? snapshotKey(id) : entry.kind === 'metadata' ? metadataKey(id) : fileKey(id, entry.file ?? '')
}

/** What is read back from storage is trusted no further than its shape. */
export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.tabs) &&
    v.tabs.length <= MAX_TABS &&
    typeof v.active === 'number' &&
    v.tabs.every((t) => {
      const e = t as Record<string, unknown> | null
      return Boolean(e) && typeof e!.snapshot === 'string' && (e!.kind === 'page' || e!.kind === 'metadata' || (e!.kind === 'file' && typeof e!.file === 'string')) && (e!.size === undefined || typeof e!.size === 'number')
    })
  )
}
