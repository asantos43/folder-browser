import path from 'node:path'
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { UI_SCHEME } from './snapshot-view.ts'
import type { SnapshotHost } from './snapshot-host.ts'
import { installShortcuts } from './shortcuts.ts'
import { serveUi, UI_ORIGIN } from './ui-protocol.ts'

export const PARTITION = 'persist:ui'
const TITLE_BAR_HEIGHT = 30
const bound = new WeakSet<Electron.Session>()
const COLOR = /^#[0-9a-f]{6}$/i

/** Dark+ colours, used until the interface tells the window which theme it is in. */
const FIRST_COLORS = { color: '#3C3C3C', symbolColor: '#CCCCCC', background: '#1E1E1E' }

/** The colours of the window buttons follow the theme. Only the sender's own window is touched. */
function handleTitleBarColors(): void {
  ipcMain.on('fb:title-bar', (event, colors: unknown) => {
    const c = colors as { color?: unknown; symbolColor?: unknown } | null
    if (typeof c?.color !== 'string' || typeof c.symbolColor !== 'string' || !COLOR.test(c.color) || !COLOR.test(c.symbolColor)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || process.platform === 'darwin') return
    win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: TITLE_BAR_HEIGHT })
    win.setBackgroundColor(c.color)
  })
}

/** What a message from the interface needs of its window: that it is still there (a message can arrive as the window goes, and `win.webContents` of a destroyed window throws "Object has been destroyed"), and that it came from the main frame. */
type Window = { isDestroyed(): boolean; readonly webContents: { readonly mainFrame: unknown } }

/** The number of tabs with changes that the interface says, or null when the message is not to be believed. */
export function unsavedFrom(win: Window, frame: unknown, count: unknown): number | null {
  if (win.isDestroyed() || frame !== win.webContents.mainFrame) return null
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 && count < 10_000 ? count : null
}

/** Whether the interface may ask the window to close (`fb:leave`, after it asked the user). */
export function mayLeave(win: Window, frame: unknown): boolean {
  return !win.isDestroyed() && frame === win.webContents.mainFrame
}

export function createMainWindow(host: SnapshotHost): BrowserWindow {
  const root = path.join(app.getAppPath(), 'dist')
  const ses = session.fromPartition(PARTITION)
  // The handlers belong to the session, which outlives a window (macOS opens a new one on activate): bind them once.
  if (!bound.has(ses)) {
    bound.add(ses)
    ses.protocol.handle(UI_SCHEME, (request) => serveUi(root, request.url))
    host.bindSession(ses)
    handleTitleBarColors()
  }

  const mac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: 'Folder Browser',
    backgroundColor: FIRST_COLORS.background,
    ...(mac ? {} : { icon: path.join(app.getAppPath(), 'build', 'icon.png') }),
    titleBarStyle: 'hidden',
    ...(mac
      ? { trafficLightPosition: { x: 12, y: 8 } }
      : { titleBarOverlay: { color: FIRST_COLORS.color, symbolColor: FIRST_COLORS.symbolColor, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  win.setMenuBarVisibility(false)
  // The interface itself is never zoomed (each tab has its own zoom): a level kept from an earlier version is cleared, and Chromium's own zoom is off.
  win.webContents.on('dom-ready', () => {
    win.webContents.setZoomLevel(0)
    void win.webContents.setVisualZoomLevelLimits(1, 1)
  })
  host.guardNavigation(win)
  // A window with tabs that have unsaved changes is not closed until the interface has asked the user (its own dialog): it says how many there are, and when to go.
  let unsaved = 0
  let leaving = false
  win.webContents.ipc.on('fb:unsaved', (event, count: unknown) => {
    const next = unsavedFrom(win, event.senderFrame, count)
    if (next !== null) unsaved = next
  })
  win.webContents.ipc.on('fb:leave', (event) => {
    if (!mayLeave(win, event.senderFrame)) return
    leaving = true
    win.close()
  })
  win.on('close', (event) => {
    if (unsaved === 0 || leaving || win.webContents.isDestroyed()) return
    event.preventDefault()
    win.webContents.send('fb:close-requested')
  })
  installShortcuts(win)
  win.once('ready-to-show', () => win.show())
  void win.loadURL(`${UI_ORIGIN}/index.html`)
  return win
}
