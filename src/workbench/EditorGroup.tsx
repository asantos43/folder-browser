import { useCallback, useMemo, useRef } from 'react'
import { createDomFindTarget } from '@/find/dom.ts'
import { FindBar } from '@/find/FindBar.tsx'
import { ConvertedBar } from './ConvertedBar.tsx'
import { createFrameFindTarget } from '@/find/frame.ts'
import { fileTarget, type FindTarget } from '@/find/types.ts'
import { useI18n } from '@/i18n/context.tsx'
import type { ZipEntryInfo } from '@core/api.ts'
import { trailOf } from '@core/vpath.ts'
import type { Notice } from '@/state/messages.ts'
import { describeIssue } from '@/state/messages.ts'
import { invalidProblems, isHeldBack, isSnapshotTab, snapshotKey, type Action, type Workspace } from '@/state/workspace.ts'
import { FileView } from '@/views/FileView.tsx'
import { MediaView } from '@/views/MediaView.tsx'
import { MetadataView } from '@/views/MetadataView.tsx'
import { SettingsView } from '@/views/SettingsView.tsx'
import type { ThemeSetting } from '@/theme/theme.ts'
import { Icon } from '@/components/Icon.tsx'
import { Breadcrumbs } from './Breadcrumbs.tsx'
import { shortcut } from './commands.ts'
import type { Signers } from './signature.ts'
import { tabZoomOf } from '@/state/tabZoom.ts'
import { describeTabs, kindOf, snapshotTitle, sourceTitle } from './tabInfo.ts'
import { TabStrip } from './TabStrip.tsx'

/**
 * The editor group: the tab strip, the breadcrumbs and the area of the active tab. Every open snapshot keeps its `<iframe sandbox>`
 * (hidden while another tab shows), so its scroll and state stay as they were; a file tab shows the file.
 */
export function EditorGroup({ zooms, onSaveConverted, onViewEntry, onNotify, find, onCloseFind, ws, dispatch, onSaveFile, onOpenWith, onReveal, onCopy, onOpenExternal, signers, onTrust, onForget, theme, setTheme }: { /** The zoom of each tab that has one. */ zooms: Readonly<Record<string, number>>; onSaveConverted: (snapshotId: string) => void; onViewEntry: (snapshotId: string, zipPath: string, entry: ZipEntryInfo) => void; onNotify: (notice: Notice) => void; find: { open: boolean; token: number }; onCloseFind: () => void; theme: ThemeSetting; setTheme: (theme: ThemeSetting) => void; signers: Signers; onTrust: (fingerprint: string, name?: string) => void; onForget: (fingerprint: string) => void; ws: Workspace; dispatch: (a: Action) => void; onSaveFile: (snapshotId: string, path: string) => void; onOpenWith: (snapshotId: string, path: string) => void; onReveal: (snapshotId: string, path?: string) => void; onCopy: (text: string) => void; onOpenExternal: (url: string) => void }) {
  const { t } = useI18n()
  const views = useMemo(() => describeTabs(ws, t), [ws, t])
  const active = ws.tabs.find((tab) => tab.key === ws.active)
  // The frames keep the order in which the snapshots were opened, whatever the order of the tabs: moving an iframe in the page reloads it.
  const frames = Object.keys(ws.snapshots).flatMap((id) => ws.tabs.filter((tab) => tab.snapshotId === id && isSnapshotTab(tab)))
  const trail = active ? (active.view === 'settings' ? [t('settings.title')] : [sourceTitle(ws, active.snapshotId), ...(active.view === 'metadata' ? [t('metadata.breadcrumb')] : active.path ? trailOf(active.path) : [])]) : []
  const fileTab = active?.path !== undefined ? active : undefined
  const metadataTab = active?.view === 'metadata' ? active : undefined
  const heldBack = active && isSnapshotTab(active) && isHeldBack(ws, active.snapshotId) ? active : undefined
  const info = fileTab ? kindOf(ws, fileTab) : undefined
  // A video or a sound keeps playing when another tab comes to the front: its player stays (hidden), as a snapshot's frame does.
  const players = ws.tabs.flatMap((tab) => {
    const { kind, file } = tab.path !== undefined ? kindOf(ws, tab) : { kind: undefined, file: undefined }
    return kind === 'media' ? [{ tab, size: file?.size ?? 0 }] : []
  })

  // What Find searches: the page of a snapshot (in its own frame, through the main process), the source editor or the PDF (they register
  // themselves), or the text of whatever else is shown (metadata, a ZIP's list, Settings).
  const area = useRef<HTMLDivElement>(null)
  const dom = useMemo(() => createDomFindTarget(() => area.current), [])
  const pageId = active && isSnapshotTab(active) && !heldBack ? active.snapshotId : null
  const frame = useMemo(() => (pageId && window.fb ? createFrameFindTarget(window.fb, pageId) : null), [pageId])
  const fileKind = fileTab ? info?.kind : undefined
  const getTarget = useCallback((): FindTarget | null => (frame ? frame : fileKind === 'text' || fileKind === 'pdf' ? fileTarget.get() : dom), [frame, fileKind, dom])

  return (
    <main aria-label="Editor" className="flex h-full min-w-0 flex-col bg-editor text-editor-fg">
      <TabStrip ws={ws} views={views} dispatch={dispatch} onReveal={onReveal} onCopy={onCopy} />
      {active ? <Breadcrumbs trail={trail} /> : null}
      <div ref={area} className="relative flex min-h-0 flex-1 flex-col">
        {active && isSnapshotTab(active) && !heldBack && ws.snapshots[active.snapshotId]?.converted ? <ConvertedBar info={ws.snapshots[active.snapshotId].converted!} onSave={() => onSaveConverted(active.snapshotId)} /> : null}
        {/* No key: Find closes when the tab changes, so there is no state to carry over (and a key on it kept it mounted once closed). */}
        {find.open && active ? <FindBar getTarget={getTarget} focusToken={find.token} onClose={onCloseFind} /> : null}
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
        {fileTab && info?.file && info.kind !== 'media' ? (
          <FileView key={fileTab.key} snapshotId={fileTab.snapshotId} path={fileTab.path!} kind={info.kind} mediaType={info.file.mediaType} size={info.file.size} onSave={() => onSaveFile(fileTab.snapshotId, fileTab.path!)} onViewEntry={(entry) => onViewEntry(fileTab.snapshotId, fileTab.path!, entry)} onNotify={onNotify} zoom={tabZoomOf(zooms, fileTab.key)} />
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
      </div>
    </main>
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
