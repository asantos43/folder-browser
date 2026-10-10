import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { DraftStore } from '../core/drafts.ts'
import { FavoriteFolders } from '../core/favorites.ts'
import { RecentFiles } from '../core/recent.ts'
import { SessionStore } from '../core/session-store.ts'
import { SignerStore } from '../core/signers.ts'
import { pathsToOpen, userArgs } from './argv.ts'
import { installMenu } from './menu.ts'
import { SnapshotHost } from './snapshot-host.ts'
import { flushBeforeQuit, SettingsHost } from './settings-host.ts'
import { KeysHost } from './keys-host.ts'
import { registerScheme } from './snapshot-view.ts'
import { createMainWindow } from './window.ts'
import type { PluginsHost } from './plugins-host.ts'

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
  let settingsHost: SettingsHost | undefined
  let keysHost: KeysHost | undefined
  // The shell and every core/plugins module stay in a separate lazy bundle.
  let pluginsHost: Promise<PluginsHost> | undefined
  const early: string[] = pathsToOpen(userArgs(process.argv, app.isPackaged, app.getAppPath(), process.cwd()), process.cwd())

  // macOS gives files through this event, also before the app is ready.
  app.on('open-file', (event, file) => {
    event.preventDefault()
    if (host) void host.openFromSystem(win, [file])
    else early.push(file)
  })
  app.on('second-instance', (_event, argv, cwd) => {
    void host?.openFromSystem(win, pathsToOpen(userArgs(argv, app.isPackaged, app.getAppPath(), cwd), cwd))
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.on('window-all-closed', () => {
    void settingsHost?.flush().catch(() => {})
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    keysHost?.dispose()
    host?.cleanup()
    void host?.registry.closeAll()
  })

  app.whenReady().then(async () => {
    // Changes not saved are kept here (a hot exit); the ones nobody came back to for three months go.
    const drafts = new DraftStore(path.join(app.getPath('userData'), 'drafts'))
    drafts.prune(90)
    const signers = new SignerStore(path.join(app.getPath('userData'), 'trusted-signers.json'))
    host = new SnapshotHost(new RecentFiles(path.join(app.getPath('userData'), 'recent-files.json')), signers, new SessionStore(path.join(app.getPath('userData'), 'session.json')), { recentFolders: new RecentFiles(path.join(app.getPath('userData'), 'recent-folders.json')), favorites: new FavoriteFolders(path.join(app.getPath('userData'), 'favorites.json')), drafts })
    host.configureRunner(app.getPath('userData'), () => settingsHost?.store.get('files.openWithCommands') ?? [])
    host.registerIpc(() => win)
    settingsHost = new SettingsHost(app.getPath('userData'), ipcMain, () => BrowserWindow.getAllWindows())
    settingsHost.register()
    for (const channel of ['list', 'set-enabled', 'remove', 'disable-all', 'open-folder', 'install', 'install-paths'] as const) {
      ipcMain.handle(`fb:plugins-${channel}`, async (event, ...args: unknown[]) => {
        const owner = BrowserWindow.getAllWindows().find(item => item.webContents === event.sender)
        if (!owner || event.senderFrame !== event.sender.mainFrame || !event.senderFrame?.url.startsWith('fb-ui://')) throw new Error('This page cannot manage plugins.')
        pluginsHost ??= import('./plugins-host.ts').then(({ PluginsHost, systemPluginDialogs, pluginTranslator }) => {
          const t = pluginTranslator(app.getLocale())
          return new PluginsHost({ userData: app.getPath('userData'), appVersion: app.getVersion(), registry: settingsHost!.registry, store: settingsHost!.store, signerStore: signers },
            ipcMain, () => BrowserWindow.getAllWindows(), systemPluginDialogs(t, !app.isPackaged && process.env.FB_PLUGIN_TEST === '1'), t)
        }).catch(error => { pluginsHost = undefined; throw error })
        return (await pluginsHost).handle(event, channel, args)
      })
    }
    flushBeforeQuit(app, settingsHost)
    keysHost = new KeysHost(app.getPath('userData'), ipcMain, () => BrowserWindow.getAllWindows(), process.platform === 'darwin', () => installMenu(command => win?.webContents.send('fb:command', command)))
    keysHost.register()
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
