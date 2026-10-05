import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { RecentFiles } from '../core/recent.ts'
import { SessionStore } from '../core/session-store.ts'
import { SignerStore } from '../core/signers.ts'
import { pathsToOpen, userArgs } from './argv.ts'
import { installMenu } from './menu.ts'
import { SnapshotHost } from './snapshot-host.ts'
import { registerScheme } from './snapshot-view.ts'
import { createMainWindow } from './window.ts'

// Both the interface (fb-ui://) and the snapshots (wsnp://) are custom schemes: registered before the app is ready.
registerScheme()

if (process.argv.includes('--app-version')) {
  // For the packaging smoke test: the version of the application (Electron's own --version says Electron's).
  console.log(app.getVersion())
  app.exit(0)
} else if (!app.requestSingleInstanceLock()) {
  // A second launch (a double-click on another file) hands its files to the first and leaves.
  app.quit()
} else {
  let win: BrowserWindow | undefined
  let host: SnapshotHost | undefined
  const early: string[] = pathsToOpen(userArgs(process.argv, app.isPackaged), process.cwd())

  // macOS gives files through this event, also before the app is ready.
  app.on('open-file', (event, file) => {
    event.preventDefault()
    if (host) void host.openFromSystem(win, [file])
    else early.push(file)
  })
  app.on('second-instance', (_event, argv, cwd) => {
    void host?.openFromSystem(win, pathsToOpen(userArgs(argv, app.isPackaged), cwd))
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    host?.cleanup()
    void host?.registry.closeAll()
  })

  app.whenReady().then(async () => {
    host = new SnapshotHost(new RecentFiles(path.join(app.getPath('userData'), 'recent-files.json')), new SignerStore(path.join(app.getPath('userData'), 'trusted-signers.json')), new SessionStore(path.join(app.getPath('userData'), 'session.json')))
    host.registerIpc(() => win)
    void host.sweepOldCopies()
    win = createMainWindow(host)
    installMenu((command) => win?.webContents.send('fb:command', command))
    // What the command line named is opened now and handed to the interface when it says it is ready.
    host.startup = host.openFromSystem(win, early)
    await host.startup
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && host) win = createMainWindow(host)
    })
  })
}
