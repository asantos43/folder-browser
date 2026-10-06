import { mediaKind, viewKind } from '@core/filekind.ts'
import { isInner } from '@core/vpath.ts'
import type { Translate } from '@/i18n/index.ts'
import { basename } from '@/lib/format.ts'
import { fileIcon } from '@/lib/icons.ts'
import type { Tab, Workspace } from '@/state/workspace.ts'

export interface TabView {
  label: string
  /** Shown beside the label when two tabs have the same one. */
  description: string
  icon: string
  tooltip: string
}

/**
 * What a snapshot is called in the tabs, the list and the breadcrumbs: the name of its file. The title of its page and its address are the page's, and two files can say the
 * same (the same address, saved at two times): a name in a folder is unique, so it is what a tab is told apart by.
 */
export const snapshotTitle = (ws: Workspace, id: string): string => {
  const snapshot = ws.snapshots[id]
  return snapshot ? basename(snapshot.path) : ''
}

/** Where the file of a snapshot is, for the second line of a tooltip and for telling two tabs of the same name apart: its folder. */
const folderOfSnapshot = (ws: Workspace, id: string): string => {
  const path = ws.snapshots[id]?.path ?? ''
  return path.replace(/[\\/][^\\/]*$/, '')
}

/** The name of what a tab belongs to: a snapshot's title, or the name of the folder or ZIP file that was opened. */
export const sourceTitle = (ws: Workspace, id: string): string => ws.roots[id]?.name ?? snapshotTitle(ws, id)

/** Where one side of a comparison is, for a person: the folder or ZIP file it was opened from, then its path in it (`›` into a ZIP too). */
export const sideLabel = (ws: Workspace, side: { rootId: string; path: string }): string => `${sourceTitle(ws, side.rootId)} › ${side.path.replaceAll('!/', ' › ')}`

const parentOf = (path: string): string => path.replaceAll('!/', '/').split('/').slice(0, -1).join('/')

/** What a tab shows: its name, an icon, and where it is from when the name alone would be ambiguous. */
export function describeTabs(ws: Workspace, t: Translate): Map<string, TabView> {
  const base = ws.tabs.map((tab): [Tab, string, string, string] => {
    const snapshot = ws.snapshots[tab.snapshotId]
    if (tab.view === 'settings') return [tab, t('settings.title'), 'settings-gear', t('settings.title')]
    if (tab.view === 'guide') return [tab, t('guide.title'), 'book', t('guide.title')]
    if (tab.view === 'diff' && tab.diff) {
      const { left, right } = tab.diff
      return [tab, t('tabs.diffOf', { left: basename(left.path), right: basename(right.path) }), 'diff', `${sideLabel(ws, left)}\n${sideLabel(ws, right)}`]
    }
    if (tab.view === 'metadata') return [tab, t('tabs.metadataOf', { name: snapshotTitle(ws, tab.snapshotId) }), 'info', snapshot?.path ?? '']
    // (The tooltip of a page: where the file is, and the address the page was saved from.)
    if (tab.path === undefined) return [tab, snapshotTitle(ws, tab.snapshotId), 'browser', [snapshot?.path, snapshot?.manifest.source.url].filter(Boolean).join('\n')]
    const file = snapshot?.files.find((f) => f.path === tab.path)
    const where = `${sourceTitle(ws, tab.snapshotId)} › ${tab.path.replaceAll('!/', ' › ')}`
    if (tab.as === 'hex') return [tab, t('tabs.hexOf', { name: basename(tab.path) }), 'file-binary', where]
    return [tab, basename(tab.path), fileIcon(file?.mediaType, tab.path), where]
  })
  const counts = new Map<string, number>()
  for (const [, label] of base) counts.set(label, (counts.get(label) ?? 0) + 1)
  return new Map(
    base.map(([tab, label, icon, tooltip]) => [
      tab.key,
      {
        label,
        icon,
        tooltip: tooltip || label,
        description: (counts.get(label) ?? 0) > 1 ? (tab.view === 'diff' && tab.diff ? [tab.diff.left, tab.diff.right].map((side) => [sourceTitle(ws, side.rootId), parentOf(side.path)].filter(Boolean).join('/')).join(' ↔ ') : tab.path === undefined || tab.view === 'metadata' ? folderOfSnapshot(ws, tab.snapshotId) : ws.roots[tab.snapshotId] ? [ws.roots[tab.snapshotId].name, parentOf(tab.path)].filter(Boolean).join('/') : snapshotTitle(ws, tab.snapshotId)) : '',
      },
    ]),
  )
}

/**
 * A text file of a tab can be edited when the tab is a file of a folder or of a ZIP that was opened (an entry of a ZIP too, also one in a ZIP in it), not the trash, not a snapshot,
 * and the tab is not the file's bytes (those are edited as bytes). (Whether it is a text, and a UTF-8 one under 5 MB, is the main process's to say, when the file is opened.)
 */
export function isEditable(ws: Workspace, tab: Tab): boolean {
  const root = ws.roots[tab.snapshotId]
  return Boolean(root && !root.trash && tab.path !== undefined && tab.view === undefined)
}

/** How the file of a tab is shown, from what the manifest and the archive say about it. */
export const kindOf = (ws: Workspace, tab: Tab) => {
  const found = kindOfFile(ws, tab)
  // A file shown as its bytes by the user's choice, whatever it is.
  return tab.as === 'hex' && found.file ? { ...found, kind: 'hex' as const } : found
}

const kindOfFile = (ws: Workspace, tab: Tab) => {
  // A file of a folder or a ZIP that was opened to browse: no manifest, so its type is told by its name (and, if that says nothing, by looking at it) and its size is the one the tree listed.
  if (ws.roots[tab.snapshotId] && tab.path) {
    const file: { path: string; size: number; mediaType?: string } = { path: tab.path, size: tab.size ?? 0 }
    // A `.wsnp` of a folder opened as a ZIP ("Open as ZIP") is listed like one.
    return { file, kind: /\.wsnp$/i.test(tab.path) ? ('zip' as const) : mediaKind(undefined, tab.path) ? ('media' as const) : viewKind(undefined, tab.path, file.size) }
  }
  let file: { path: string; size: number; mediaType?: string } | undefined = ws.snapshots[tab.snapshotId]?.files.find((f) => f.path === tab.path)
  // An entry of a ZIP in the snapshot is not in the manifest: its type comes from its name and its size from the ZIP's list.
  if (!file && tab.path && isInner(tab.path) && ws.snapshots[tab.snapshotId]) file = { path: tab.path, size: tab.size ?? 0 }
  // A video or a sound of a snapshot is played too, by the type its manifest declares (or by its name, for an entry of a ZIP in it).
  return { file, kind: file && tab.path ? (mediaKind(file.mediaType, tab.path) ? ('media' as const) : viewKind(file.mediaType, tab.path, file.size)) : ('other' as const) }
}
