import type { Chooser, DirEntry, OpenResult, OpenWithResult, Place, PlacesData, RootInfo, SaveResult } from '@core/api.ts'
import { commandFor, type CommandName } from '@core/shortcuts.ts'
import { Allotment } from 'allotment'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { basename } from '@/lib/format.ts'
import { readStored, writeStored } from '@/lib/storage.ts'
import { refusalNotice } from '@/state/messages.ts'
import { useNotifications } from '@/state/notifications.ts'
import { empty, isHeldBack, isSnapshotTab, reduce, released } from '@/state/workspace.ts'
import { emptyHistory, step, visit, type History } from '@/state/history.ts'
import { isSession, keyOfEntry, sessionOf, type Session } from '@/state/session.ts'
import { reopenSession, showHidden, sortDescending, sortKey, svgView } from '@/state/setting.ts'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { shownSource } from '@/state/fileLanguage.ts'
import { LanguagePicker } from './LanguagePicker.tsx'
import { QuickOpen } from './QuickOpen.tsx'
import { forgetReads } from '@/views/FileView.tsx'
import { useTheme } from '@/theme/theme.ts'
import { readFrameMessage, wheelSteps } from '@core/frameScript.ts'
import { pruneZooms, stepTabZoom, tabZoomOf } from '@/state/tabZoom.ts'
import { viewZoom } from '@/state/viewZoom.ts'
import type { AppInfo } from '@core/api.ts'
import { innerPath } from '@core/vpath.ts'
import { fileTarget } from '@/find/types.ts'
import { shownText } from '@/state/shown.ts'
import { AboutDialog } from '@/components/AboutDialog.tsx'
import { OpenWithDialog } from '@/components/OpenWithDialog.tsx'
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx'
import { PropertiesDialog } from '@/components/PropertiesDialog.tsx'
import { locationOf } from './treeMenu.ts'
import { LinkTooltip, type LinkHover } from '@/components/LinkTooltip.tsx'
import { ActivityBar, type ViewId } from './ActivityBar.tsx'
import { EditorGroup } from './EditorGroup.tsx'
import { Notifications } from './Notifications.tsx'
import { SideBar } from './SideBar.tsx'
import { StatusBar } from './StatusBar.tsx'
import type { Signers } from './signature.ts'
import { TitleBar } from './TitleBar.tsx'
import { activeSnapshotId, activeTabOf, canFind, canPrint, canSaveWsnp, printRequestOf, zoomTargetOf } from './availability.ts'
import { shortcut } from './commands.ts'
import { isMac, platform, type Commands } from './commands.ts'

const SIDE_BAR_WIDTH = 300
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'

/** VS Code's layout: title bar, activity bar, side bar, editor group and status bar; and what ties them to the open snapshots. */
export function Workbench() {
  const { t } = useI18n()
  const { setting, setSetting } = useTheme()
  svgView.use()
  const hiddenShown = showHidden.use()
  const sortBy = sortKey.use()
  const sortBackwards = sortDescending.use()
  const { notifications, notify, dismiss } = useNotifications()
  const [ws, dispatch] = useReducer(reduce, empty)
  const [sideBarVisible, setSideBarVisible] = useState(() => readStored('sideBarVisible', true, isBoolean))
  const [sideBarWidth, setSideBarWidth] = useState(() => readStored('sideBarWidth', SIDE_BAR_WIDTH, isNumber))
  const [view, setView] = useState<ViewId>('snapshots')
  const [recent, setRecent] = useState<string[]>([])
  const [signers, setSigners] = useState<Signers>({})
  const [about, setAbout] = useState<{ info: AppInfo | null } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [find, setFind] = useState({ open: false, token: 0 })
  const [quick, setQuick] = useState<'files' | 'commands' | null>(null)
  const [pickingLanguage, setPickingLanguage] = useState(false)
  const shownFile = shownSource.use()
  const [history, setHistory] = useState<History>(emptyHistory)
  // The zoom of each tab (those that have one: a page of a snapshot, a text); a picture and a PDF keep their own.
  const [zooms, setZooms] = useState<Record<string, number>>({})
  const [chooser, setChooser] = useState<Chooser | null>(null)
  const [properties, setProperties] = useState<{ entry: DirEntry; location: string } | null>(null)
  const [placesData, setPlacesData] = useState<PlacesData | null>(null)
  const [treeVersion, setTreeVersion] = useState(0)
  const [emptying, setEmptying] = useState<string | null>(null)
  const [pageMenu, setPageMenu] = useState<ContextMenuState | null>(null)
  const [linkHover, setLinkHover] = useState<LinkHover | null>(null)
  // The session is written only once the last one has been read back.
  const sessionReady = useRef(false)
  const started = useRef(false)
  const api = window.fb

  const toggleSideBar = useCallback(() => setSideBarVisible((v) => !v), [])
  useEffect(() => writeStored('sideBarVisible', sideBarVisible), [sideBarVisible])
  useEffect(() => void (document.documentElement.dataset.platform = platform()), [])

  const reportSave = useCallback(
    (name: string, result: SaveResult) => {
      if (result.saved) notify({ level: 'info', text: t('file.saved', { name: basename(result.path) }) })
      else if (result.reason === 'error') notify({ level: 'error', text: t('file.saveFailed', { name: basename(name), message: result.message ?? '' }) })
    },
    [notify, t],
  )

  // ---- the signers the user trusts
  const refreshSigners = useCallback(() => void api?.signers.list().then(setSigners), [api])
  useEffect(refreshSigners, [refreshSigners])
  const trustSigner = useCallback((fingerprint: string, name?: string) => void api?.signers.trust(fingerprint, name).then(refreshSigners), [api, refreshSigners])
  const forgetSigner = useCallback((fingerprint: string) => void api?.signers.forget(fingerprint).then(refreshSigners), [api, refreshSigners])

  // ---- opening files: the picker, the recent list, a drop, and what the system asks for
  const refreshRecent = useCallback(() => void api?.recent.list().then(setRecent), [api])
  const refreshPlaces = useCallback(() => void api?.places.list().then(setPlacesData), [api])
  useEffect(refreshPlaces, [refreshPlaces])
  const handleResults = useCallback(
    (results: OpenResult[], options?: { preview?: boolean }) => {
      for (const result of results) {
        if (!result.ok) notify(refusalNotice(t, result))
        else if ('root' in result) {
          // A folder or a ZIP to browse; a file named on its own opens its folder, and the file in a tab.
          dispatch({ type: 'root-opened', root: result.root })
          if (result.open) dispatch({ type: 'open-file', snapshotId: result.root.id, path: result.open.path, keep: true, size: result.open.size })
        } else {
          // A snapshot opened by itself (File ▸ Open File, a drop, the command line) comes with its folder: it is a file of it, and its page is a tab.
          if (result.folder) dispatch({ type: 'root-opened', root: result.folder })
          dispatch({ type: 'snapshot-opened', snapshot: result.snapshot, ...(options?.preview ? { preview: true } : {}) })
          if (!result.already) void api?.verify(result.snapshot.id)
        }
      }
      if (results.length) {
        refreshRecent()
        refreshPlaces()
      }
    },
    [api, notify, refreshRecent, refreshPlaces, t],
  )
  /** Opens again the snapshots of a session, and the tabs in them in the order they had; a file that is gone is said, the rest still opens. */
  const restore = useCallback(
    async (session: Session | null) => {
      if (!api || !session || (!session.tabs.length && !session.roots?.length)) return
      const paths = [...new Set([...(session.roots ?? []), ...session.tabs.map((tab) => tab.snapshot)])]
      const results = await api.openPaths(paths)
      const byPath = new Map<string, Extract<OpenResult, { ok: true }>>()
      results.forEach((result, i) => (result.ok ? byPath.set(paths[i], result) : notify(refusalNotice(t, result))))
      const shown = new Set<string>()
      const show = (path: string, opened: Extract<OpenResult, { ok: true }>) => {
        if (shown.has(path)) return
        shown.add(path)
        if ('root' in opened) dispatch({ type: 'root-opened', root: opened.root })
        else {
          dispatch({ type: 'snapshot-opened', snapshot: opened.snapshot })
          if (!opened.already) void api.verify(opened.snapshot.id)
        }
      }
      for (const path of session.roots ?? []) {
        const opened = byPath.get(path)
        if (opened) show(path, opened)
      }
      let activeKey: string | undefined
      session.tabs.forEach((entry, i) => {
        const opened = byPath.get(entry.snapshot)
        if (!opened) return
        const id = 'root' in opened ? opened.root.id : opened.snapshot.id
        show(entry.snapshot, opened)
        if (entry.kind === 'file') dispatch({ type: 'open-file', snapshotId: id, path: entry.file!, keep: true, ...(entry.size === undefined ? {} : { size: entry.size }) })
        else if (entry.kind === 'metadata') dispatch({ type: 'open-metadata', snapshotId: id })
        if (i === session.active) activeKey = keyOfEntry(entry, id)
      })
      if (activeKey) dispatch({ type: 'activate', key: activeKey })
      refreshRecent()
    },
    [api, notify, refreshRecent, t],
  )

  useEffect(() => {
    if (!api) return
    const offOpened = api.onOpened(handleResults)
    const offIntegrity = api.onIntegrity((event) => dispatch({ type: 'integrity', event }))
    const offFile = api.onOpenFile(({ snapshotId, path }) => dispatch({ type: 'open-file', snapshotId, path, keep: false }))
    const offSaved = api.onSaved(({ name, result }) => reportSave(name, result))
    void api.ready().then(async (results) => {
      handleResults(results)
      // With no file asked for, the tabs of the last session come back (when the setting says so).
      // (Once: a change of language runs this effect again, and the session is not read twice.)
      if (!started.current) {
        started.current = true
        if (!reopenSession.get()) void api.session.save(null)
        else if (!results.length) await restore(await api.session.load().then((value) => (isSession(value) ? value : null)))
      }
      sessionReady.current = true
    })
    refreshRecent()
    return () => {
      offOpened()
      offIntegrity()
      offFile()
      offSaved()
    }
  }, [api, handleResults, refreshRecent, reportSave, restore])

  // The tabs are written as they change, so the next start (or the one after a crash) finds them; the setting off keeps nothing.
  useEffect(() => {
    if (!sessionReady.current) return
    void api?.session.save(reopenSession.get() ? sessionOf(ws) : null)
  }, [ws])

  // Closing the last tab of a snapshot lets the main process release its archive.
  const before = useRef(ws)
  useEffect(() => {
    for (const id of released(before.current, ws)) {
      void api?.close(id)
      forgetReads(id)
    }
    before.current = ws
  }, [ws, api])

  // ---- saving a file of a snapshot to disk
  const saveFile = useCallback(
    (snapshotId: string, path: string) => {
      void api?.saveFileAs(snapshotId, path).then((result) => reportSave(path, result))
    },
    [api, reportSave],
  )
  /** Says how an "Open with…" ended; nothing when it worked or the user cancelled. */
  const reportOpenWith = useCallback(
    (name: string, result: OpenWithResult) => {
      if ('choose' in result) return
      if (result.opened) {
        if (!result.chooser) notify({ level: 'info', text: t('openWith.noChooser', { name }) })
      } else if (result.reason === 'unsafe') notify({ level: 'info', text: t('openWith.unsafe', { name }) })
      else if (result.reason !== 'cancelled') notify({ level: 'error', text: t('openWith.failed', { name, message: result.message ?? '' }) })
    },
    [notify, t],
  )
  /** The system asks which application should open a file of the snapshot (on Linux the viewer shows the choice itself). */
  const openWith = useCallback(
    (snapshotId: string, path: string) => {
      void api?.openWith(snapshotId, path).then((result) => {
        if ('choose' in result) setChooser(result.choose)
        else reportOpenWith(basename(path), result)
      })
    },
    [api, reportOpenWith],
  )
  const copy = useCallback((text: string) => void api?.copyText(text), [api])
  const openExternal = useCallback((url: string) => void api?.openExternal(url), [api])

  // ---- copy, find and print: each acts on what the tab on screen shows
  const copySelection = useCallback(async () => {
    const tab = activeTabOf(wsNow.current)
    // The page of a snapshot is another process: it is asked for its own selection.
    if (tab && isSnapshotTab(tab) && !isHeldBack(wsNow.current, tab.snapshotId)) {
      await api?.copyFromPage(tab.snapshotId)
      return
    }
    const text = fileTarget.get()?.selectedText?.() || window.getSelection()?.toString() || ''
    if (text) await api?.copyText(text)
  }, [api])

  const printTab = useCallback(async () => {
    const request = printRequestOf(wsNow.current, () => shownText.get())
    if (!request || !api) return notify({ level: 'info', text: t('print.unsupported') })
    const result = await api.print(request)
    if (!result.printed && result.reason === 'error') notify({ level: 'error', text: t('print.failed', { message: result.message ?? '' }) })
    else if (!result.printed && result.reason === 'unsupported') notify({ level: 'info', text: t('print.unsupported') })
  }, [api, notify, t])

  const savePdfTab = useCallback(async () => {
    const request = printRequestOf(wsNow.current, () => shownText.get())
    if (!request || !api) return notify({ level: 'info', text: t('print.unsupported') })
    const result = await api.savePdf(request)
    if (result.saved) notify({ level: 'info', text: t('file.saved', { name: basename(result.path) }) })
    else if (result.reason === 'error') notify({ level: 'error', text: t('pdf.failed', { message: result.message ?? '' }) })
  }, [api, notify, t])

  /** A snapshot made from a ZIP saved by PageKeep, as a `.wsnp` file of its own. */
  const saveConverted = useCallback(
    async (snapshotId: string) => {
      const result = await api?.saveConverted(snapshotId)
      if (!result) return
      if (result.saved) notify({ level: 'info', text: t('file.saved', { name: basename(result.path) }) })
      else if (result.reason === 'error') notify({ level: 'error', text: t('converted.saveFailed', { message: result.message ?? '' }) })
    },
    [api, notify, t],
  )

  // ---- Go Back and Go Forward walk through the tabs visited
  const historyNow = useRef(history)
  historyNow.current = history
  const navigating = useRef(false)
  useEffect(() => {
    if (!ws.active) return
    if (navigating.current) {
      navigating.current = false
      return
    }
    setHistory((h) => visit(h, ws.active!))
  }, [ws.active])
  const go = useCallback((direction: 1 | -1) => {
    const current = wsNow.current
    const to = step(historyNow.current, direction, new Set(current.tabs.map((tab) => tab.key)), current.active)
    if (to === null) return
    navigating.current = true
    setHistory({ ...historyNow.current, at: to })
    dispatch({ type: 'activate', key: historyNow.current.list[to] })
  }, [])

  // ---- a right click in the page of a snapshot: the menu is the interface's, drawn where the click was
  useEffect(() => {
    if (!api) return
    return api.onPageContext(({ snapshotId, x, y, hasSelection }) => {
      const current = wsNow.current
      const tab = activeTabOf(current)
      if (!tab || !isSnapshotTab(tab) || tab.snapshotId !== snapshotId || isHeldBack(current, snapshotId)) return
      setPageMenu({
        x,
        y,
        label: t('menu.edit'),
        entries: [
          { id: 'selectAll', label: t('context.selectAll'), shortcut: shortcut('Ctrl+A'), run: () => void api.selectAllInPage(snapshotId) },
          { id: 'copy', label: t('menu.copy'), shortcut: shortcut('Ctrl+C'), disabled: !hasSelection, run: () => void api.copyFromPage(snapshotId) },
          { separator: true },
          { id: 'print', label: t('menu.print'), shortcut: shortcut('Ctrl+P'), run: () => void printTab() },
          { id: 'savePdf', label: t('menu.savePdf'), run: () => void savePdfTab() },
        ],
      })
    })
  }, [api, t, printTab, savePdfTab])

  // Find closes when another tab comes to the front: each tab has its own text to search.
  // (Only from one tab to another: the first tab coming up must not close a search just begun, which a fast key press can beat the effect to.)
  const lastActive = useRef<string | null>(null)
  useEffect(() => {
    if (lastActive.current !== null && lastActive.current !== ws.active) setFind((f) => (f.open ? { ...f, open: false } : f))
    lastActive.current = ws.active
  }, [ws.active])

  // ---- the zoom of the tab on screen: Ctrl+=, Ctrl+-, Ctrl+0 and Ctrl+wheel. The interface itself is never zoomed.
  const zoomTab = useCallback((direction: 1 | -1 | 0) => {
    const current = wsNow.current
    const target = zoomTargetOf(current)
    if (target === 'view') return direction === 0 ? viewZoom.get()?.reset() : viewZoom.get()?.step(direction)
    const key = current.active
    if (!target || !key) return
    setZooms((all) => {
      const next = direction === 0 ? 1 : stepTabZoom(tabZoomOf(all, key), direction)
      return next === tabZoomOf(all, key) ? all : { ...all, [key]: next }
    })
  }, [])
  useEffect(() => {
    setZooms((all) => pruneZooms(all, new Set(ws.tabs.map((tab) => tab.key))))
  }, [ws.tabs])
  // The wheel with Control held, and what a page of a snapshot (another process) posts of its own wheel and keys (core/frameScript.ts). Chromium's own zoom of
  // the window stays off. A picture and a PDF zoom around the pointer by themselves; a page that is not the one on screen is not heard.
  const wheelCarry = useRef(0)
  const zoomsNow = useRef(zooms)
  zoomsNow.current = zooms
  const zoomWheel = useCallback(
    (deltaY: number) => {
      const { steps, rest } = wheelSteps(wheelCarry.current, deltaY)
      wheelCarry.current = rest
      for (let i = 0; i < Math.abs(steps); i++) zoomTab(steps > 0 ? 1 : -1)
    },
    [zoomTab],
  )
  // A tooltip belongs to the page it came from: another tab, or a menu over the page, takes it away.
  useEffect(() => {
    setLinkHover(null)
  }, [ws.active, pageMenu])
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.deltaY) return
      event.preventDefault()
      if (zoomTargetOf(wsNow.current) !== 'view') zoomWheel(event.deltaY)
    }
    const onMessage = (event: MessageEvent) => {
      const message = readFrameMessage(event.data)
      const tab = activeTabOf(wsNow.current)
      if (!message || !tab || !isSnapshotTab(tab)) return
      const frame = document.getElementById(`frame-${tab.snapshotId}`) as HTMLIFrameElement | null
      if (!event.source || !frame || event.source !== frame.contentWindow) return
      if ('link' in message) {
        // The pointer is in the page's own pixels: the frame is scaled by the zoom of the tab, so its box on screen gives the way back to the window's.
        const box = frame.getBoundingClientRect()
        const zoom = tabZoomOf(zoomsNow.current, tab.key)
        setLinkHover(message.link === null ? null : { link: message.link, x: box.left + message.x * zoom, y: box.top + message.y * zoom })
      } else if ('wheel' in message) zoomWheel(message.wheel)
      else zoomTab(message.direction === 'in' ? 1 : message.direction === 'out' ? -1 : 0)
    }
    // The pointer over anything of the interface (not the frame, which does not tell the window of events in it) has left the link.
    const onOver = () => setLinkHover(null)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('message', onMessage)
    window.addEventListener('mouseover', onOver)
    return () => {
      window.removeEventListener('mouseover', onOver)
      window.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('message', onMessage)
    }
  }, [zoomTab, zoomWheel])

  // ---- commands: from the menu, from the keyboard, and from the native menu of macOS
  const cycle = useRef<{ list: string[]; at: number } | null>(null)
  const wsNow = useRef(ws)
  wsNow.current = ws
  const run = useCallback(
    (command: CommandName | 'cycleEnd' | 'showAbout' | 'copy' | 'savePdf' | 'saveAsWsnp') => {
      const current = wsNow.current
      if (command === 'toggleSideBar') return toggleSideBar()
      if (command === 'openSettings') return dispatch({ type: 'open-settings' })
      if (command === 'showAbout') return void (api?.appInfo().then((info) => setAbout({ info })) ?? setAbout({ info: null }))
      if (command === 'zoomIn' || command === 'zoomOut' || command === 'zoomReset') return zoomTab(command === 'zoomIn' ? 1 : command === 'zoomOut' ? -1 : 0)
      if (command === 'openFile') return void api?.openDialog().then(handleResults)
      if (command === 'openFolder') return void api?.openFolderDialog().then(handleResults)
      if (command === 'toggleHidden') return showHidden.set(!showHidden.get())
      if (command === 'copy') return void copySelection()
      if (command === 'print') return void printTab()
      if (command === 'savePdf') return void savePdfTab()
      if (command === 'saveAsWsnp') return void (current.active && canSaveWsnp(current) ? saveConverted(activeTabOf(current)!.snapshotId) : undefined)
      if (command === 'quickOpen') return current.snapshots && Object.keys(current.snapshots).length ? setQuick('files') : undefined
      if (command === 'commandPalette') return setQuick('commands')
      if (command === 'goBack') return go(-1)
      if (command === 'goForward') return go(1)
      if (command === 'find') return canFind(current) ? setFind((f) => ({ open: true, token: f.token + 1 })) : undefined
      if (command === 'closeEditor') return current.active ? dispatch({ type: 'close', key: current.active }) : undefined
      if (command === 'nextEditor') return dispatch({ type: 'step', direction: 1 })
      if (command === 'previousEditor') return dispatch({ type: 'step', direction: -1 })
      if (command === 'cycleEnd') {
        if (cycle.current) dispatch({ type: 'touch' })
        cycle.current = null
        return
      }
      if (command === 'cycleRecent' || command === 'cycleRecentBack') {
        const direction = command === 'cycleRecent' ? 1 : -1
        cycle.current ??= { list: current.recent.length ? current.recent : current.tabs.map((tab) => tab.key), at: 0 }
        const { list } = cycle.current
        if (list.length < 2) return
        cycle.current.at = (cycle.current.at + direction + list.length) % list.length
        return dispatch({ type: 'activate', key: list[cycle.current.at], transient: true })
      }
      const n = /^goToTab(\d)$/.exec(command)?.[1]
      if (n) {
        const tab = Number(n) === 9 ? current.tabs.at(-1) : current.tabs[Number(n) - 1]
        if (tab) dispatch({ type: 'activate', key: tab.key })
      }
    },
    [api, handleResults, toggleSideBar, copySelection, printTab, savePdfTab, saveConverted, go, zoomTab],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = commandFor({ key: event.key, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey }, isMac())
      if (!command) return
      event.preventDefault()
      run(command)
    }
    // Ctrl+Tab ends when Control is let go, or when the window loses the focus.
    const onKeyUp = (event: KeyboardEvent) => (event.key === 'Control' || event.key === 'Meta') && run('cycleEnd')
    const onBlur = () => run('cycleEnd')
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    const off = api?.onCommand((command) => run(command as CommandName | 'cycleEnd' | 'showAbout' | 'copy' | 'savePdf' | 'saveAsWsnp'))
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      off?.()
    }
  }, [api, run])

  // ---- dropping files on the window opens them; the window itself never navigates to them
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const enter = (e: DragEvent) => hasFiles(e) && (depth++, setDragging(true))
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const leave = (e: DragEvent) => hasFiles(e) && ((depth = Math.max(0, depth - 1)) === 0 ? setDragging(false) : undefined)
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => api?.pathForFile(f) ?? '').filter(Boolean)
      if (paths.length) void api?.openPaths(paths).then(handleResults)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [api, handleResults])

  const commands: Commands = useMemo(
    () => ({
      toggleSideBar,
      setTheme: setSetting,
      openFile: () => run('openFile'),
      openFolder: () => run('openFolder'),
      toggleHidden: () => run('toggleHidden'),
      showHidden: hiddenShown,
      sortKey: sortBy,
      sortDescending: sortBackwards,
      setSortKey: (key) => sortKey.set(key),
      setSortDescending: (descending) => sortDescending.set(descending),
      print: () => run('print'),
      savePdf: () => run('savePdf'),
      saveAsWsnp: () => run('saveAsWsnp'),
      quickOpen: () => run('quickOpen'),
      commandPalette: () => run('commandPalette'),
      goBack: () => go(-1),
      goForward: () => go(1),
      copy: () => run('copy'),
      find: () => run('find'),
      openRecent: (path) => void api?.openPaths([path]).then(handleResults),
      clearRecent: () => void api?.recent.clear().then(refreshRecent),
      closeEditor: () => run('closeEditor'),
      closeAll: () => dispatch({ type: 'close-all' }),
      nextEditor: () => run('nextEditor'),
      previousEditor: () => run('previousEditor'),
      openSettings: () => run('openSettings'),
      showAbout: () => run('showAbout'),
      zoomIn: () => run('zoomIn'),
      zoomOut: () => run('zoomOut'),
      zoomReset: () => run('zoomReset'),
      canZoom: zoomTargetOf(ws) !== null,
      showMetadata: () => {
        const id = activeSnapshotId(wsNow.current)
        if (id) dispatch({ type: 'open-metadata', snapshotId: id })
      },
      hasEditor: ws.tabs.length > 0,
      canFind: canFind(ws),
      canPrint: canPrint(ws),
      canSaveWsnp: canSaveWsnp(ws),
      hasSnapshots: Object.keys(ws.snapshots).length > 0,
      canGoBack: step(history, -1, new Set(ws.tabs.map((tab) => tab.key)), ws.active) !== null,
      canGoForward: step(history, 1, new Set(ws.tabs.map((tab) => tab.key)), ws.active) !== null,
      recent,
    }),
    [toggleSideBar, setSetting, run, api, handleResults, refreshRecent, ws, recent, savePdfTab, saveConverted, go, history, hiddenShown, sortBy, sortBackwards],
  )

  const sideBarActions = useMemo(
    () => ({
      openFolder: () => run('openFolder'),
      listDir: (id: string, path: string) => api!.listDir(id, path),
      openRootFile: (id: string, entry: { path: string; size: number }, keep: boolean) => dispatch({ type: 'open-file', snapshotId: id, path: entry.path, keep, size: entry.size }),
      reveal: (id: string, path: string) => void api?.reveal(id, path),
      closeRoot: (id: string) => dispatch({ type: 'root-closed', id }),
      openDefault: (id: string, path: string) => void api?.openDefault(id, path).then((result) => reportOpenWith(basename(path), result)),
      properties: (root: RootInfo, entry: DirEntry) => setProperties({ entry, location: locationOf(root, entry.path, platform() === 'win32' ? '\\' : '/') }),
      openPlace: (place: Place) => void (place.kind === 'trash' ? api?.places.openTrash() : api?.openPaths([place.path]))?.then(handleResults),
      removeFavorite: (folder: string) => void api?.places.removeFavorite(folder).then(refreshPlaces),
      moveFavorite: (folder: string, to: number) => void api?.places.moveFavorite(folder, to).then(refreshPlaces),
      clearRecentFolders: () => void api?.places.clearRecentFolders().then(refreshPlaces),
      pinFolder: (id: string, path: string) =>
        void api?.places.addFavorite(id, path).then((ok) => {
          if (ok) refreshPlaces()
          else notify({ level: 'info', text: t('places.pinFailed') })
        }),
      restoreTrash: (id: string, path: string) =>
        void api?.trash.restore(id, path).then((result) => {
          if ('restored' in result) notify({ level: 'info', text: t('trash.restored', { path: result.restored }) })
          else if (result.error === 'exists') notify({ level: 'error', text: t('trash.errorExists', { name: path }) })
          else if (result.error === 'unknown-origin') notify({ level: 'error', text: t('trash.errorOrigin', { name: path }) })
          else notify({ level: 'error', text: t('trash.errorFailed', { name: path, message: result.message ?? result.error }) })
          setTreeVersion((n) => n + 1)
        }),
      emptyTrash: (id: string) => setEmptying(id),
      // A `.wsnp` of a folder is a file like the others: a click shows its page in a preview tab, as a picture is, and a double click keeps it in a tab of its own.
      openSnapshot: (id: string, path: string, keep: boolean) => void api?.openInRoot(id, path).then((results) => handleResults(results, { preview: !keep })),
      saveFile,
      openWith,
      copy,
    }),
    [run, api, saveFile, openWith, copy, handleResults, reportOpenWith, refreshPlaces, notify, t],
  )

  return (
    <div className="flex h-full flex-col">
      <TitleBar commands={commands} sideBarVisible={sideBarVisible} />
      <div className="flex min-h-0 flex-1">
        <ActivityBar
          active={view}
          sideBarVisible={sideBarVisible}
          onSelect={(next) => (next === view ? toggleSideBar() : (setView(next), setSideBarVisible(true)))}
          theme={setting}
          setTheme={setSetting}
          onOpenSettings={() => run('openSettings')}
          onOpenFolder={() => run('openFolder')}
          onPrint={() => run('print')}
          canPrint={canPrint(ws)}
        />
        <div className="min-w-0 flex-1">
          <Allotment onChange={(sizes) => sizes[0] && sideBarVisible && (setSideBarWidth(sizes[0]), writeStored('sideBarWidth', Math.round(sizes[0])))}>
            <Allotment.Pane preferredSize={sideBarWidth} minSize={170} maxSize={640} visible={sideBarVisible} snap>
              <SideBar ws={ws} dispatch={dispatch} actions={sideBarActions} places={placesData} treeVersion={treeVersion} />
            </Allotment.Pane>
            <Allotment.Pane minSize={200}>
              <EditorGroup zooms={zooms} onSaveConverted={(id) => void saveConverted(id)} onNotify={notify} onViewEntry={(snapshotId, zipPath, entry) => dispatch({ type: 'open-file', snapshotId, path: innerPath(zipPath, entry.name), keep: true, size: entry.size })} find={find} onCloseFind={() => setFind((f) => ({ ...f, open: false }))} ws={ws} dispatch={dispatch} onSaveFile={saveFile} onOpenWith={openWith} onReveal={(id, path) => void api?.reveal(id, path)} onCopy={copy} onOpenExternal={openExternal} signers={signers} onTrust={trustSigner} onForget={forgetSigner} theme={setting} setTheme={setSetting} />
            </Allotment.Pane>
          </Allotment>
        </div>
      </div>
      <StatusBar
        zoom={tabZoomOf(zooms, ws.active)}
        showZoom={zoomTargetOf(ws) === 'page' || zoomTargetOf(ws) === 'text'}
        onResetZoom={() => zoomTab(0)}
        onZoom={zoomTab}
        ws={ws}
        signers={signers}
        onOpenSettings={() => run('openSettings')}
        onShowMetadata={() => commands.showMetadata()}
        onOpenExternal={openExternal}
        onSelectLanguage={() => setPickingLanguage(true)}
        onShowIntegrity={() => commands.showMetadata()}
      />
      {emptying ? (
        <ConfirmDialog
          title={t('trash.emptyTitle')}
          message={t('trash.emptyMessage')}
          confirmLabel={t('tree.emptyTrash')}
          danger
          onCancel={() => setEmptying(null)}
          onConfirm={() => {
            const id = emptying
            setEmptying(null)
            void api?.trash.empty(id).then((count) => {
              notify({ level: 'info', text: t('trash.emptied', { count }) })
              setTreeVersion((n) => n + 1)
            })
          }}
        />
      ) : null}
      {properties ? <PropertiesDialog entry={properties.entry} location={properties.location} onClose={() => setProperties(null)} /> : null}
      {about ? <AboutDialog info={about.info} onClose={() => setAbout(null)} onOpenExternal={openExternal} onCopy={copy} /> : null}
      {pickingLanguage && shownFile ? <LanguagePicker file={shownFile} onClose={() => setPickingLanguage(false)} /> : null}
      {quick ? (
        <QuickOpen
          start={quick}
          ws={ws}
          commands={commands}
          onClose={() => setQuick(null)}
          onOpen={(snapshotId, path) => {
            if (path === undefined) dispatch({ type: 'snapshot-opened', snapshot: ws.snapshots[snapshotId] })
            else dispatch({ type: 'open-file', snapshotId, path, keep: true })
          }}
        />
      ) : null}
      {chooser ? (
        <OpenWithDialog
          chooser={chooser}
          onCancel={() => {
            setChooser(null)
            void api?.openWithCancel(chooser.token)
          }}
          onChoose={(appId, always) => {
            setChooser(null)
            void api?.openWithApp(chooser.token, appId, always).then((result) => reportOpenWith(chooser.name, result))
          }}
        />
      ) : null}
      <ContextMenu menu={pageMenu} onClose={() => setPageMenu(null)} />
      <LinkTooltip hover={linkHover} />
      <Notifications notifications={notifications} onDismiss={dismiss} />
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed border-focus bg-editor/80 text-[16px] text-fg">{t('dropzone.text')}</div>
      ) : null}
    </div>
  )
}

