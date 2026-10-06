import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDomFindTarget } from '@/find/dom.ts'
import { FindBar } from '@/find/FindBar.tsx'
import { ConvertedBar } from './ConvertedBar.tsx'
import { createFrameFindTarget } from '@/find/frame.ts'
import { fileTarget, type FindTarget } from '@/find/types.ts'
import { useI18n } from '@/i18n/context.tsx'
import type { ZipEntryInfo } from '@core/api.ts'
import { isInner, trailOf } from '@core/vpath.ts'
import type { Notice } from '@/state/messages.ts'
import { describeIssue } from '@/state/messages.ts'
import { GroupContext } from '@/state/groups.ts'
import { groupView, invalidProblems, isHeldBack, isSnapshotTab, snapshotKey, type Action, type GroupId, type Tab, type Workspace } from '@/state/workspace.ts'
import { FileView } from '@/views/FileView.tsx'
import { DocumentView } from '@/views/DocumentView.tsx'
import { DiffView } from '@/views/DiffView.tsx'
import { MediaView } from '@/views/MediaView.tsx'
import { MetadataView } from '@/views/MetadataView.tsx'
import { SettingsView } from '@/views/SettingsView.tsx'
import type { ThemeSetting } from '@/theme/theme.ts'
import { Icon } from '@/components/Icon.tsx'
import { basename } from '@/lib/format.ts'
import { comparable } from '@core/diff.ts'
import { Breadcrumbs } from './Breadcrumbs.tsx'
import { shortcut } from './commands.ts'
import type { Signers } from './signature.ts'
import { tabZoomOf } from '@/state/tabZoom.ts'
import { describeTabs, isEditable, kindOf, sideLabel, snapshotTitle, sourceTitle } from './tabInfo.ts'
import { draggedFile, dragging, FILE_DRAG, TAB_DRAG, type DraggedFile } from './dnd.ts'
import { isTextTab, TabStrip } from './TabStrip.tsx'

/**
 * The editor group: the tab strip, the breadcrumbs and the area of the active tab. Every open snapshot keeps its `<iframe sandbox>`
 * (hidden while another tab shows), so its scroll and state stay as they were; a file tab shows the file.
 */
export function EditorGroup({ group, onDropOnTab, onDropFileOnTab, onDropFile, zooms, onZoom, reloads, onSaveTab, onSaveBufferAs, onSaveBytesAs, onChanged, onRestored, onSaveConverted, onViewEntry, onNotify, find, onCloseFind, ws: wsAll, dispatch, onSaveFile, onOpenWith, onReveal, onCopy, onOpenExternal, signers, onTrust, onForget, theme, setTheme }: { /** Which of the two groups this is. */ group: GroupId; /** A tab was dropped on another tab, in the middle of it: the workbench asks what to do with the two. */ onDropOnTab: (dragged: string, target: string) => void; /** A file of the tree was dropped on a text tab (or on the middle of the editor that shows one): the workbench asks what to do with the two. */ onDropFileOnTab: (file: DraggedFile, target: string) => void; /** A file of the tree was dropped on the group: open it there. */ onDropFile: (file: DraggedFile, group: GroupId) => void; /** The zoom of each tab that has one. */ zooms: Readonly<Record<string, number>>; /** A text whose editor is made again (it was reloaded from the disk): the key of the tab and how many times. */ reloads: Readonly<Record<string, number>>; /** Saves the text of a tab to its file (the workbench says what went wrong). */ onSaveTab: (key: string) => void; onSaveBufferAs: (name: string, text: string, options: { eol: 'lf' | 'crlf' | 'cr'; bom: boolean }) => void; /** Save As of the bytes on screen. */ onSaveBytesAs: (name: string, bytes: Uint8Array) => void; /** A text has changes not saved, or has none now. */ onChanged: (key: string, changed: boolean) => void; /** Changes that were not saved came back from a draft. */ onRestored: (name: string) => void; /** The wheel or a zoom key over a document (a zoom of its tab). */ onZoom: (change: { wheel: number } | { direction: 'in' | 'out' | 'reset' }) => void; onSaveConverted: (snapshotId: string) => void; onViewEntry: (snapshotId: string, zipPath: string, entry: ZipEntryInfo) => void; onNotify: (notice: Notice) => void; find: { open: boolean; token: number }; onCloseFind: () => void; theme: ThemeSetting; setTheme: (theme: ThemeSetting) => void; signers: Signers; onTrust: (fingerprint: string, name?: string) => void; onForget: (fingerprint: string) => void; ws: Workspace; dispatch: (a: Action) => void; onSaveFile: (snapshotId: string, path: string) => void; onOpenWith: (snapshotId: string, path: string) => void; onReveal: (snapshotId: string, path?: string) => void; onCopy: (text: string) => void; onOpenExternal: (url: string) => void }) {
  const { t } = useI18n()
  // What this group shows: its own tabs, and the one in front of it as the active one.
  const ws = useMemo(() => groupView(wsAll, group), [wsAll, group])
  const focused = wsAll.focus === group
  const views = useMemo(() => describeTabs(ws, t), [ws, t])
  const active = ws.tabs.find((tab) => tab.key === ws.active)
  // The frames keep the order in which the snapshots were opened, whatever the order of the tabs: moving an iframe in the page reloads it.
  const frames = Object.keys(ws.snapshots).flatMap((id) => ws.tabs.filter((tab) => tab.snapshotId === id && isSnapshotTab(tab)))
  const trail = active ? (active.view === 'settings' ? [t('settings.title')] : active.view === 'diff' && active.diff ? [t('tabs.diffOf', { left: basename(active.diff.left.path), right: basename(active.diff.right.path) })] : [sourceTitle(ws, active.snapshotId), ...(active.view === 'metadata' ? [t('metadata.breadcrumb')] : active.path ? trailOf(active.path) : [])]) : []
  const fileTab = active?.path !== undefined ? active : undefined
  const metadataTab = active?.view === 'metadata' ? active : undefined
  const heldBack = active && isSnapshotTab(active) && isHeldBack(ws, active.snapshotId) ? active : undefined
  const info = fileTab ? kindOf(ws, fileTab) : undefined
  // A video or a sound keeps playing when another tab comes to the front: its player stays (hidden), as a snapshot's frame does.
  const players = ws.tabs.flatMap((tab) => {
    const { kind, file } = tab.path !== undefined ? kindOf(ws, tab) : { kind: undefined, file: undefined }
    return kind === 'media' ? [{ tab, size: file?.size ?? 0 }] : []
  })

  // An office document is drawn once and kept (hidden, but laid out, so that what measures its room still can) while another tab is in front: the file is not read and drawn
  // again at every switch. A document is drawn when its tab is first brought to the front (a session of twenty is not drawn all at once), and goes with its tab.
  const documents = ws.tabs.flatMap((tab) => {
    const { kind, file } = tab.path !== undefined ? kindOf(ws, tab) : { kind: undefined, file: undefined }
    return kind === 'document' && file ? [{ tab, file }] : []
  })
  const [drawn, setDrawn] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    if (ws.active && documents.some(({ tab }) => tab.key === ws.active)) setDrawn((old) => (old.has(ws.active!) ? old : new Set(old).add(ws.active!)))
  }, [ws.active, documents])

  // What Find searches: the page of a snapshot (in its own frame, through the main process), the source editor or the PDF (they register
  // themselves), or the text of whatever else is shown (metadata, a ZIP's list, Settings).
  const area = useRef<HTMLDivElement>(null)
  const dom = useMemo(() => createDomFindTarget(() => area.current), [])
  const pageId = active && isSnapshotTab(active) && !heldBack ? active.snapshotId : null
  const frame = useMemo(() => (pageId && window.fb ? createFrameFindTarget(window.fb, pageId) : null), [pageId])
  const fileKind = fileTab ? info?.kind : undefined
  const getTarget = useCallback((): FindTarget | null => (frame ? frame : fileKind === 'text' || fileKind === 'pdf' || fileKind === 'document' ? fileTarget.get() : dom), [frame, fileKind, dom])

  return (
    <GroupContext.Provider value={group}>
    <main aria-label={wsAll.tabs.some((tab) => tab.group === 1) ? t(group === 0 ? 'editor.leftGroup' : 'editor.rightGroup') : 'Editor'} data-group={group} onMouseDownCapture={() => !focused && ws.active !== null && dispatch({ type: 'activate', key: ws.active })} className="flex h-full min-w-0 flex-col bg-editor text-editor-fg">
      <TabStrip ws={wsAll} group={group} views={views} dispatch={dispatch} onReveal={onReveal} onCopy={onCopy} onOpenWith={onOpenWith} onDropOnTab={onDropOnTab} onDropFileOnTab={onDropFileOnTab} onDropFile={onDropFile} />
      {active ? <Breadcrumbs trail={trail} /> : null}
      <div ref={area} className="relative flex min-h-0 flex-1 flex-col">
        {active && isSnapshotTab(active) && !heldBack && ws.snapshots[active.snapshotId]?.converted ? <ConvertedBar info={ws.snapshots[active.snapshotId].converted!} onSave={() => onSaveConverted(active.snapshotId)} /> : null}
        {/* No key: Find closes when the tab changes, so there is no state to carry over (and a key on it kept it mounted once closed). */}
        {find.open && focused && active && fileKind !== 'hex' ? <FindBar getTarget={getTarget} focusToken={find.token} onClose={onCloseFind} /> : null}
        {frames.map((tab) => {
          // The zoom of the page is the tab's own: the frame is laid out at 1/zoom of the room and scaled up (or down) to fill it, as a browser's zoom lays a page out.
          const zoom = tabZoomOf(zooms, tab.key)
          return (
            <div key={tab.snapshotId} hidden={ws.active !== tab.key || isHeldBack(ws, tab.snapshotId)} className="relative min-h-0 flex-1 overflow-hidden">
              <iframe
                id={`frame-${tab.snapshotId}`}
                title={t('editor.snapshotFrame', { name: snapshotTitle(ws, tab.snapshotId) })}
                src={`wsnp://${tab.snapshotId}/`}
                sandbox="allow-scripts"
                className="absolute top-0 left-0 border-0 bg-white"
                style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, ...(zoom === 1 ? {} : { transform: `scale(${zoom})`, transformOrigin: '0 0' }) }}
              />
            </div>
          )
        })}
        {heldBack ? <Invalid ws={ws} id={heldBack.snapshotId} dispatch={dispatch} /> : null}
        {active?.view === 'diff' && active.diff ? <DiffView key={active.key} left={active.diff.left} right={active.diff.right} leftTitle={sideLabel(ws, active.diff.left)} rightTitle={sideLabel(ws, active.diff.right)} zoom={tabZoomOf(zooms, active.key)} /> : null}
        {active?.view === 'settings' ? <SettingsView theme={theme} setTheme={setTheme} /> : null}
        {metadataTab && ws.snapshots[metadataTab.snapshotId] ? (
          <MetadataView
            snapshot={ws.snapshots[metadataTab.snapshotId]}
            integrity={ws.integrity[metadataTab.snapshotId]}
            signers={signers}
            onTrust={onTrust}
            onForget={onForget}
            onOpenExternal={onOpenExternal}
            onOpenManifest={() => dispatch({ type: 'open-file', snapshotId: metadataTab.snapshotId, path: 'manifest.json', keep: false })}
            onCopy={onCopy}
            onOpenFile={(path) => dispatch({ type: 'open-file', snapshotId: metadataTab.snapshotId, path, keep: false })}
          />
        ) : null}
        {players.map(({ tab, size }) => (
          <div key={tab.key} hidden={ws.active !== tab.key} className="min-h-0 flex-1">
            <MediaView
              rootId={tab.snapshotId}
              path={tab.path!}
              size={size}
              onOpenSibling={(path) => dispatch({ type: 'open-file', snapshotId: tab.snapshotId, path, keep: false })}
              onOpenWith={() => onOpenWith(tab.snapshotId, tab.path!)}
              onSave={() => onSaveFile(tab.snapshotId, tab.path!)}
            />
          </div>
        ))}
        {documents.filter(({ tab }) => drawn.has(tab.key) || tab.key === ws.active).map(({ tab, file }) => (
          <div key={tab.key} className={ws.active === tab.key ? 'flex min-h-0 flex-1 flex-col' : 'pointer-events-none invisible absolute inset-0 flex flex-col'} aria-hidden={ws.active !== tab.key}>
            <DocumentView
              snapshotId={tab.snapshotId}
              path={tab.path!}
              name={tab.path!.split(/[!/]+/).pop() ?? tab.path!}
              mediaType={file.mediaType}
              size={file.size}
              active={ws.active === tab.key}
              zoom={tabZoomOf(zooms, tab.key)}
              onZoom={onZoom}
              onSave={() => onSaveFile(tab.snapshotId, tab.path!)}
              onOpenWith={() => onOpenWith(tab.snapshotId, tab.path!)}
              onHex={() => dispatch({ type: 'open-file', snapshotId: tab.snapshotId, path: tab.path!, keep: true, size: file.size, as: 'hex' })}
            />
          </div>
        ))}
        {fileTab && info?.file && info.kind !== 'media' && info.kind !== 'document' ? (
          <FileView key={`${fileTab.key}:${reloads[fileTab.key] ?? 0}`} edit={isEditable(ws, fileTab) ? { rootId: fileTab.snapshotId, tabKey: fileTab.key, dirty: Boolean(ws.dirty[fileTab.key]), hexEditable: ws.roots[fileTab.snapshotId]?.kind === 'folder' && !isInner(fileTab.path!), onRestored, onSave: () => onSaveTab(fileTab.key), onSaveAs: (text, options) => onSaveBufferAs(fileTab.path!.split(/[!/]+/).pop() ?? fileTab.path!, text, options), onSaveBytesAs, onChanged } : undefined} snapshotId={fileTab.snapshotId} path={fileTab.path!} kind={info.kind} mediaType={info.file.mediaType} size={info.file.size} onSave={() => onSaveFile(fileTab.snapshotId, fileTab.path!)} onOpenWith={() => onOpenWith(fileTab.snapshotId, fileTab.path!)} findToken={find.open ? find.token : 0} onHex={() => dispatch({ type: 'open-file', snapshotId: fileTab.snapshotId, path: fileTab.path!, keep: true, size: info.file!.size, as: 'hex' })} onViewEntry={(entry) => onViewEntry(fileTab.snapshotId, fileTab.path!, entry)} onNotify={onNotify} zoom={tabZoomOf(zooms, fileTab.key)} />
        ) : null}
        {!active ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 text-fg-muted">
            <img src="./icon.svg" alt="" className="h-40 w-40 opacity-15 grayscale" />
            <p className="m-0 text-[15px]">{t('editor.empty')}</p>
            <dl className="m-0 grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-[13px]">
              <dt className="text-right">{t('editor.hintOpenFolder')}</dt>
              <dd className="m-0"><kbd className="rounded-sm border border-group-border px-1.5 font-sans">{shortcut('Ctrl+Shift+O')}</kbd></dd>
              <dt className="text-right">{t('editor.hintPalette')}</dt>
              <dd className="m-0"><kbd className="rounded-sm border border-group-border px-1.5 font-sans">{shortcut('Ctrl+Shift+P')}</kbd></dd>
            </dl>
          </div>
        ) : null}
        <DropLayer group={group} split={wsAll.tabs.some((tab) => tab.group === 1)} ws={wsAll} target={active ?? undefined} dispatch={dispatch} onDropFile={onDropFile} onDropOnTab={onDropOnTab} onDropFileOnTab={onDropFileOnTab} />
      </div>
    </main>
    </GroupContext.Provider>
  )
}

/**
 * Where a tab or a file of the tree dragged over the editor lands, as in VS Code: with one group, the right half makes a second group and the left half is the group there is;
 * with two, the group the pointer is over. The window is listened to (a drag is heard wherever the pointer is, and the first move of it counts), and a layer is drawn over the
 * group while a tab or a file is dragged: it shows the place and takes the events a frame under it would keep to itself.
 */
function DropLayer({ group, split, ws, target, dispatch, onDropFile, onDropOnTab, onDropFileOnTab }: { group: GroupId; split: boolean; ws: Workspace; /** The tab in front of this group. */ target: Tab | undefined; dispatch: (a: Action) => void; onDropFile: (file: DraggedFile, group: GroupId) => void; onDropOnTab: (dragged: string, target: string) => void; onDropFileOnTab: (file: DraggedFile, target: string) => void }) {
  const { t } = useI18n()
  const kind = dragging.use()
  const [side, setSide] = useState<'left' | 'right' | 'center' | null>(null)
  // Where the last dragover said the pointer was: at the drop the drag store has already been let go (it listens to `drop` before this does), so the zone is not worked out again.
  const lastZone = useRef<'left' | 'right' | 'center' | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const now = useRef({ group, split, ws, target, dispatch, onDropFile, onDropOnTab, onDropFileOnTab })
  now.current = { group, split, ws, target, dispatch, onDropFile, onDropOnTab, onDropFileOnTab }
  useEffect(() => {
    const ours = (e: DragEvent) => Boolean(e.dataTransfer && (e.dataTransfer.types.includes(TAB_DRAG) || e.dataTransfer.types.includes(FILE_DRAG)))
    /** Whether what is dragged and the file in front of this group are two texts that can be compared: the middle of the editor then asks what to do with the two. */
    const asks = (): boolean => {
      const { target: front, ws: all } = now.current
      if (!isTextTab(front)) return false
      const key = dragging.tab()
      if (key) return key !== front!.key && isTextTab(all.tabs.find((tab) => tab.key === key))
      const file = dragging.file()
      return file !== null && comparable(file.name, file.size) && !(file.rootId === front!.snapshotId && file.path === front!.path)
    }
    /** Which part of this group the pointer is over: the middle (to compare), or the side the dragged one lands on; null when it is not over it. */
    const zone = (e: DragEvent): 'left' | 'right' | 'center' | null => {
      const r = box.current?.getBoundingClientRect()
      if (!r || !ours(e) || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null
      const x = (e.clientX - r.left) / r.width
      if (x > 0.3 && x < 0.7 && asks()) return 'center'
      return !now.current.split && x > 0.5 ? 'right' : 'left'
    }
    const over = (e: DragEvent) => {
      const at = zone(e)
      lastZone.current = at
      setSide(at)
      if (!at) return
      e.preventDefault()
      // (Never `link`: Wayland has no such drag action, and a drop with it is refused by the desktop: the highlight shows, and releasing does nothing.)
      e.dataTransfer!.dropEffect = e.dataTransfer!.types.includes(TAB_DRAG) ? 'move' : 'copy'
    }
    const drop = (e: DragEvent) => {
      const at = lastZone.current ?? zone(e)
      lastZone.current = null
      setSide(null)
      if (!at || !ours(e)) return
      e.preventDefault()
      e.stopPropagation()
      const { group: mine, split: two, target: front, dispatch: send, onDropFile: open, onDropOnTab: askTabs, onDropFileOnTab: askFile } = now.current
      const key = e.dataTransfer!.getData(TAB_DRAG)
      const file = key ? null : draggedFile(e.dataTransfer!)
      if (at === 'center' && front) {
        if (key) return askTabs(key, front.key)
        if (file) return askFile(file, front.key)
      }
      const to: GroupId = two ? mine : at === 'right' ? 1 : 0
      if (key) return send({ type: 'move-to-group', key, group: to })
      if (file) open(file, to)
    }
    const leave = () => {
      lastZone.current = null
      setSide(null)
    }
    window.addEventListener('dragover', over, true)
    window.addEventListener('drop', drop, true)
    window.addEventListener('dragend', leave, true)
    return () => {
      window.removeEventListener('dragover', over, true)
      window.removeEventListener('drop', drop, true)
      window.removeEventListener('dragend', leave, true)
    }
  }, [])
  return (
    <div ref={box} data-drop-layer={group} className={`absolute inset-0 z-30 ${kind ? '' : 'pointer-events-none'}`}>
      {kind && side === 'center' ? (
        <div data-drop-zone="center" className="pointer-events-none absolute inset-y-0 right-[30%] left-[30%] flex items-center justify-center border-2 border-focus bg-list-active/25 p-4 text-center text-[13px] text-fg">
          {t('drop.compareHint')}
        </div>
      ) : kind && side ? (
        <div className={`pointer-events-none absolute inset-y-0 border-2 border-focus bg-list-active/25 ${split ? 'inset-x-0' : side === 'right' ? 'right-0 left-1/2' : 'left-0 right-1/2'}`} />
      ) : null}
    </div>
  )
}

/** A snapshot whose files are not what its manifest says is held back: the page is not shown until the user insists. */
function Invalid({ ws, id, dispatch }: { ws: Workspace; id: string; dispatch: (a: Action) => void }) {
  const { t } = useI18n()
  const problems = invalidProblems(ws, id)
  const signature = problems.find((p) => p.code === 'signature-invalid')
  const files = problems.filter((p) => p.code !== 'signature-invalid')
  const button = 'flex h-[26px] items-center gap-1.5 rounded-sm px-4 text-[13px]'
  return (
    <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 overflow-auto bg-editor p-8 text-editor-fg select-text">
      <Icon name="error" className="text-[48px] text-error" />
      <h2 className="m-0 text-[18px] font-normal">{t('invalid.title')}</h2>
      {files.length ? <p className="m-0 max-w-[560px] text-center text-fg-muted">{t(files.length === 1 ? 'invalid.bodyOne' : 'invalid.body', { count: files.length })}</p> : null}
      {signature ? <p className="m-0 max-w-[560px] text-center text-fg-muted">{describeIssue(t, signature)}</p> : null}
      <ul className="m-0 max-w-[560px] list-none p-0 text-[12px]">
        {files.map((p, i) => (
          <li key={i} className="break-all">
            {p.path}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => dispatch({ type: 'open-metadata', snapshotId: id })} className={`${button} bg-button text-button-fg hover:bg-button-hover`}>
          {t('tabs.showMetadata')}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'show-anyway', snapshotId: id })} className={`${button} hover:bg-toolbar-hover`}>
          {t('invalid.showAnyway')}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'close', key: snapshotKey(id) })} className={`${button} hover:bg-toolbar-hover`}>
          {t('invalid.close')}
        </button>
      </div>
    </div>
  )
}
