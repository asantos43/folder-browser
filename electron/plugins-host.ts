import path from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { PluginHost, PluginHostError, declaredTokensFromCss } from '../core/plugins/host.ts'
import type { PluginHostOptions } from '../core/plugins/host.ts'
import type { PluginSummary, InstallOutcome } from '../core/plugins/summary.ts'
import type { SettingsRegistry } from '../core/settings/registry.ts'
import type { SettingsStore } from '../core/settings/store.ts'
import { builtinKeyCommands } from '../core/commands/builtin.ts'
import { LANGUAGES, viewKind } from '../core/filekind.ts'
import fileKindsSource from '../core/filekind.ts?raw'
import tokensCss from '../src/theme/tokens.css?raw'
import { en } from '../src/i18n/en.ts'
import { translator, languageFor, type Translate, type MessageKey } from '../src/i18n/index.ts'

type Event = Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>
type Ipc = Pick<IpcMain, 'handle' | 'removeHandler'>
export const pluginChannels = ['list', 'set-enabled', 'remove', 'disable-all', 'open-folder', 'install', 'install-paths'] as const
export type PluginChannel = typeof pluginChannels[number]

// Bundled metadata, loaded with this lazy module: no source-file reads in an installed app.
// Candidates come from the existing classifier; only extensions it classifies as text survive.
const extensionCandidates = new Set([...fileKindsSource.matchAll(/'([a-z0-9]+)'|\b([a-z0-9]+):/g)].map(match => match[1] ?? match[2]))
export const defaultCompileIO: PluginHostOptions['compileIO'] = {
  knownCommands: new Set(builtinKeyCommands.map(command => command.id)), knownLanguages: new Set(LANGUAGES),
  builtinExtensions: new Set([...extensionCandidates].filter(extension => viewKind(undefined, `probe.${extension}`, 0) === 'text').map(extension => `.${extension}`)),
  declaredTokens: declaredTokensFromCss(tokensCss), knownLocaleKeys: new Set(Object.keys(en)),
}

export interface PluginsDialogs {
  open(win: BrowserWindow): Promise<string[] | undefined>
  confirm(win: BrowserWindow, summary: PluginSummary): Promise<boolean>
  openPath(file: string): Promise<string>
}
/** Test overrides affect only dialogs, never parsing, IPC, persistence or validation. */
export function systemPluginDialogs(t: Translate, testMode = false): PluginsDialogs {
  return {
    async open(win) {
      if (testMode && process.env.FB_TEST_PLUGIN_PATH) return [process.env.FB_TEST_PLUGIN_PATH]
      const { dialog } = await import('electron')
      // Linux/Windows cannot select files and directories in the same native picker.
      const choice = await dialog.showMessageBox(win, { type: 'question', title: t('plugins.install'), message: t('plugins.chooseSource'),
        buttons: [t('plugins.sourceFile'), t('plugins.sourceFolder'), t('confirm.cancel')], defaultId: 0, cancelId: 2 })
      if (choice.response === 2) return undefined
      const result = await dialog.showOpenDialog(win, { title: t('plugins.install'), properties: [choice.response === 1 ? 'openDirectory' : 'openFile'],
        ...(choice.response === 0 ? { filters: [{ name: 'Folder Browser Plugin', extensions: ['fbplugin'] }] } : {}) })
      return result.canceled ? undefined : result.filePaths
    },
    async confirm(win, summary) {
      if (testMode && process.env.FB_TEST_PLUGIN_CONFIRM) return process.env.FB_TEST_PLUGIN_CONFIRM === '1'
      const { dialog } = await import('electron')
      const contributes = Object.entries(summary.contributes).filter(([, count]) => count).map(([kind, count]) => `${t(`plugins.contributes.${kind}` as MessageKey, { count })}`).join(', ') || t('plugins.contributes.none')
      const result = await dialog.showMessageBox(win, { type: 'question', title: t('plugins.confirmTitle'),
        message: `${summary.name} ${summary.version}`, detail: `${t('plugins.publisher', { publisher: summary.publisher.name })}\n${t(`plugins.trust.${summary.trust}`)}\n${contributes}\n${t('plugins.installSize', { size: summary.sizeBytes })}`,
        buttons: [t('confirm.cancel'), t('plugins.confirmInstall')], defaultId: 0, cancelId: 0 })
      return result.response === 1
    },
    async openPath(file) { const { shell } = await import('electron'); return shell.openPath(file) },
  }
}

export class PluginsHost {
  private ipc: Ipc
  private windows: () => readonly BrowserWindow[]
  private dialogs: PluginsDialogs
  private options: { userData: string; appVersion: string; registry: SettingsRegistry; store: SettingsStore; signerStore?: PluginHostOptions['signerStore'] }
  private compileIO: PluginHostOptions['compileIO']
  private t: Translate
  private registered = false
  constructor(options: { userData: string; appVersion: string; registry: SettingsRegistry; store: SettingsStore; signerStore?: PluginHostOptions['signerStore'] }, ipc: Ipc,
    windows: () => readonly BrowserWindow[], dialogs?: PluginsDialogs, t: Translate = translator('en'), compileIO = defaultCompileIO) {
    this.options = options; this.ipc = ipc; this.windows = windows; this.t = t; this.compileIO = compileIO
    this.dialogs = dialogs ?? systemPluginDialogs(t)
  }
  private core?: PluginHost
  private owner?: BrowserWindow
  private operation = Promise.resolve()
  private host(): PluginHost {
    return this.core ??= new PluginHost({ root: path.join(this.options.userData, 'plugins'), appVersion: this.options.appVersion,
      registry: this.options.registry, store: this.options.store, signerStore: this.options.signerStore, compileIO: this.compileIO,
      confirm: summary => this.dialogs.confirm(this.owner!, summary), openPath: file => this.dialogs.openPath(file), changed: () => this.changed() })
  }
  private changed(): void {
    for (const win of this.windows()) if (!win.isDestroyed() && win.webContents.getURL().startsWith('fb-ui://')) win.webContents.send('fb:plugins-changed')
  }
  register(): void {
    this.registered = true
    for (const channel of pluginChannels) this.ipc.handle(`fb:plugins-${channel}`, (event, ...args: unknown[]) => this.handle(event, channel, args))
  }
  async handle(event: Event, channel: PluginChannel, args: unknown[]): Promise<unknown> {
    const win = this.windows().find(item => !item.isDestroyed() && item.webContents === event.sender)
    if (!win || event.senderFrame !== event.sender.mainFrame || !event.senderFrame?.url.startsWith('fb-ui://')) throw new Error(this.t('plugins.refused'))
    const counts: Record<PluginChannel, number> = { list: 0, 'set-enabled': 2, remove: 2, 'disable-all': 0, 'open-folder': 1, install: 0, 'install-paths': 1 }
    if (args.length !== counts[channel]) throw new Error(this.t('plugins.invalidArguments'))
    const action = async () => {
      this.owner = win
      try {
        const host = this.host()
        switch (channel) {
          case 'list': return await host.list()
          case 'set-enabled': return await host.setEnabled(args[0], args[1])
          case 'remove': return await host.remove(args[0], args[1])
          case 'disable-all': return await host.disableAll()
          case 'open-folder': return await host.openFolder(args[0])
          case 'install': {
            const paths = await this.dialogs.open(win)
            return paths ? this.outcome(await host.installPaths(paths)) : { cancelled: true }
          }
          case 'install-paths': return this.outcome(await host.installPaths(args[0]))
        }
      } catch (error) {
        if (error instanceof PluginHostError) throw new Error(this.message(error.code, error.message))
        throw new Error(this.t('plugins.operationFailed'))
      } finally { this.owner = undefined }
    }
    // Confirmations belong to the requesting window; serialize mutations across windows.
    // Warm lists have no dialog/owner and need not wait for an install.
    if (channel === 'list') return this.host().list()
    const next = this.operation.then(action, action)
    this.operation = next.then(() => {}, () => {})
    return next
  }
  private message(code: string, fallback: string): string {
    if (code === 'plugins.id.invalid' || code === 'plugins.missing') return this.t('plugins.invalidId')
    if (code === 'plugins.path.invalid' || code === 'plugins.paths.invalid') return this.t('plugins.invalidPath')
    if (code === 'plugins.arguments.invalid') return this.t('plugins.invalidArguments')
    if (code.startsWith('package.')) return this.t('plugins.invalidPackage')
    return fallback
  }
  private outcome(result: InstallOutcome): InstallOutcome {
    return 'ok' in result && !result.ok ? { ...result, message: this.message(result.code, result.message) } : result
  }
  dispose(): void { if (this.registered) for (const channel of pluginChannels) this.ipc.removeHandler(`fb:plugins-${channel}`) }
}

export const pluginTranslator = (locale: string) => translator(languageFor(locale))
