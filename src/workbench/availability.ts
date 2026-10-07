import type { PrintRequest } from '@core/api.ts'
import { isSvg, languageOf } from '@core/filekind.ts'
import { svgView } from '@/state/setting.ts'
import { isInner } from '@core/vpath.ts'
import { basename } from '@/lib/format.ts'
import { isHeldBack, isSnapshotTab, type Tab, type Workspace } from '@/state/workspace.ts'
import { kindOf } from './tabInfo.ts'

export const activeTabOf = (ws: Workspace): Tab | undefined => ws.tabs.find((tab) => tab.key === ws.active)

/** The snapshot the tab on screen belongs to (its page, its metadata, or one of its files), when it does. */
export const activeSnapshotId = (ws: Workspace): string | undefined => {
  const tab = activeTabOf(ws)
  return tab && ws.snapshots[tab.snapshotId] ? tab.snapshotId : undefined
}

/** Everything that shows text can be searched: a page, source, a PDF, the metadata, a ZIP's list, Settings. A picture and a font sample have none. */
export function canFind(ws: Workspace): boolean {
  const tab = activeTabOf(ws)
  if (!tab) return false
  if (tab.path === undefined) return true
  const { kind, file } = kindOf(ws, tab)
  // An SVG shown as a picture has no text to search.
  if (kind === 'text' && isSvg(file?.mediaType, tab.path) && svgView.get() === 'image') return false
  return kind !== 'image' && kind !== 'font' && kind !== 'media'
}

/** What can be printed: the page of a snapshot that is shown, a text, a picture. */
export function canPrint(ws: Workspace): boolean {
  const tab = activeTabOf(ws)
  if (!tab) return false
  if (isSnapshotTab(tab)) return !isHeldBack(ws, tab.snapshotId)
  if (tab.path === undefined) return false
  const { kind } = kindOf(ws, tab)
  return kind === 'text' || kind === 'image' || kind === 'document'
}

/**
 * What `Ctrl+=`, `Ctrl+-`, `Ctrl+0` and `Ctrl`+wheel zoom in the tab on screen: its zoom (the page of a snapshot, a text), the zoom a picture or a PDF keeps for itself
 * (`view`), or nothing (a ZIP's list, the metadata, Settings).
 */
export function zoomTargetOf(ws: Workspace): 'page' | 'text' | 'view' | null {
  const tab = activeTabOf(ws)
  if (!tab) return null
  if (isSnapshotTab(tab)) return isHeldBack(ws, tab.snapshotId) ? null : 'page'
  // Two files compared are drawn as text, at the tab's zoom.
  if (tab.view === 'diff' || tab.view === 'untitled') return 'text'
  if (tab.path === undefined) return null
  const { kind, file } = kindOf(ws, tab)
  if (kind === 'image' || kind === 'pdf') return 'view'
  // A document is a page, and the bytes of a file are drawn at a size: both have the tab's own zoom.
  if (kind === 'document') return 'page'
  if (kind === 'hex') return 'text'
  if (kind !== 'text') return null
  return isSvg(file?.mediaType, tab.path) && svgView.get() === 'image' ? 'view' : 'text'
}

/**
 * What Print and Save as PDF act on, for the tab on screen: the page of a snapshot; an HTML file of the snapshot, shown as the page it is;
 * any other text, as the tab shows it (`shown` gives that text); a picture. Nothing for a ZIP's list, a PDF, the metadata or Settings.
 */
export function printRequestOf(ws: Workspace, shown: () => string | null): PrintRequest | null {
  const tab = activeTabOf(ws)
  if (!tab || !canPrint(ws)) return null
  if (isSnapshotTab(tab)) return { kind: 'snapshot', id: tab.snapshotId }
  const path = tab.path!
  const { kind, file } = kindOf(ws, tab)
  if (kind === 'image') return { kind: 'image', id: tab.snapshotId, path }
  if (kind === 'document') return { kind: 'document', id: tab.snapshotId, path }
  // An SVG shown as a picture is printed as one.
  if (isSvg(file?.mediaType, path) && svgView.get() === 'image' && !isInner(path)) return { kind: 'image', id: tab.snapshotId, path }
  // (An HTML file of a folder is printed as text: only a snapshot's files are shown as pages.)
  if (languageOf(file?.mediaType, path) === 'html' && !isInner(path) && !ws.roots[tab.snapshotId]) return { kind: 'html', id: tab.snapshotId, path }
  return { kind: 'text', title: basename(path), text: shown() ?? '', name: basename(path) }
}

/** The snapshot of the tab on screen was made from a ZIP saved by PageKeep: it can be saved as a `.wsnp`. */
export function canSaveWsnp(ws: Workspace): boolean {
  const tab = activeTabOf(ws)
  return Boolean(tab && ws.snapshots[tab.snapshotId]?.converted)
}
