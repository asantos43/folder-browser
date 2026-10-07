import type { FbApi } from '@core/api.ts'
import { draftOf, hasBuffer } from './buffers.ts'
import { UNTITLED_ROOT } from '@core/diff.ts'
import type { Workspace } from './workspace.ts'

/**
 * The changes of the tabs that are not saved, kept by the main process in the application's own folder (`core/drafts.ts`) so that they are there at the next start, also after a
 * crash: a draft is written a moment after the changes stop (not at every key), and is let go as soon as the tab has no changes any more (saved, undone, closed, or the changes
 * thrown away). Which tabs have changes is the workspace's `dirty`; what the text is, the editor's buffer.
 */
export const DRAFT_DELAY_MS = 1200

interface Entry {
  rootId: string
  path: string
  timer: ReturnType<typeof setTimeout> | undefined
}
const known = new Map<string, Entry>()
let enabled = true

/** The setting says whether changes are kept for the next start (off: nothing is written, and what was kept is let go). */
export const setDraftsEnabled = (on: boolean): void => void (enabled = on)

async function write(api: Pick<FbApi, 'drafts'>, key: string): Promise<void> {
  const entry = known.get(key)
  const draft = entry ? draftOf(key) : null
  if (!entry || !draft) return
  entry.timer = undefined
  await api.drafts.put(entry.rootId, entry.path, draft)
}

/** The text of a tab changed: a draft of it is written when the changes pause. */
export function touchDraft(api: Pick<FbApi, 'drafts'>, key: string, rootId: string, path: string): void {
  if (!enabled) return
  const entry = known.get(key) ?? { rootId, path, timer: undefined }
  entry.rootId = rootId
  entry.path = path
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => void write(api, key), DRAFT_DELAY_MS)
  known.set(key, entry)
}

/** Writes at once the drafts that are waiting (the window is closing). */
export async function flushDrafts(api: Pick<FbApi, 'drafts'>): Promise<void> {
  const waiting = [...known.entries()].filter(([, entry]) => entry.timer)
  for (const [, entry] of waiting) if (entry.timer) clearTimeout(entry.timer)
  await Promise.all(waiting.map(([key]) => write(api, key)))
}

/**
 * Follows the workspace: a tab that has no changes any more has no draft (its file was saved, the changes were undone or thrown away, the tab was closed or its file deleted),
 * and a tab that has changes and no draft yet (its file was renamed, so its key is new) gets one.
 */
export function syncDrafts(api: Pick<FbApi, 'drafts'>, ws: Workspace): void {
  for (const [key, entry] of known) {
    if (ws.dirty[key]) continue
    if (entry.timer) clearTimeout(entry.timer)
    known.delete(key)
    void api.drafts.delete(entry.rootId, entry.path)
  }
  if (!enabled) return
  for (const key of Object.keys(ws.dirty)) {
    if (known.has(key)) continue
    const tab = ws.tabs.find((candidate) => candidate.key === key)
    if (tab?.view === 'untitled' && hasBuffer(key)) touchDraft(api, key, UNTITLED_ROOT, key)
    else if (tab?.path !== undefined && hasBuffer(key)) touchDraft(api, key, tab.snapshotId, tab.path)
  }
}

/** For the tests. */
export function forgetDrafts(): void {
  for (const entry of known.values()) if (entry.timer) clearTimeout(entry.timer)
  known.clear()
  enabled = true
}
