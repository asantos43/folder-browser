import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppInfo, ExtractResult, IntegrityEvent, OpenResult, ListResult, OpenWithResult, PrintResult, SaveResult, FbApi, ZipList } from '../core/api.ts'

/** What the interface may ask of the main process: nothing else crosses the boundary (core/api.ts). */
const on = <T>(channel: string, listener: (value: T) => void) => {
  const handler = (_event: unknown, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => void ipcRenderer.removeListener(channel, handler)
}

const api: FbApi = {
  platform: process.platform,
  setTitleBar: (colors) => ipcRenderer.send('fb:title-bar', colors),
  onCommand: (listener) => on<string>('fb:command', listener),
  pathForFile: (file) => webUtils.getPathForFile(file),
  ready: () => ipcRenderer.invoke('fb:ready') as Promise<OpenResult[]>,
  openDialog: () => ipcRenderer.invoke('fb:open-dialog') as Promise<OpenResult[]>,
  openFolderDialog: () => ipcRenderer.invoke('fb:open-folder-dialog') as Promise<OpenResult[]>,
  openInRoot: (id, path) => ipcRenderer.invoke('fb:open-in-root', id, path) as Promise<OpenResult[]>,
  listDir: (id, path) => ipcRenderer.invoke('fb:list-dir', id, path) as Promise<ListResult>,
  openPaths: (paths) => ipcRenderer.invoke('fb:open-paths', paths) as Promise<OpenResult[]>,
  onOpened: (listener) => on<OpenResult[]>('fb:opened', listener),
  close: (id) => ipcRenderer.invoke('fb:close', id) as Promise<void>,
  readFile: (id, path) => ipcRenderer.invoke('fb:read-file', id, path),
  saveFileAs: (id, path) => ipcRenderer.invoke('fb:save-as', id, path),
  verify: (id) => ipcRenderer.invoke('fb:verify', id) as Promise<void>,
  onIntegrity: (listener) => on<IntegrityEvent>('fb:integrity', listener),
  onOpenFile: (listener) => on<{ snapshotId: string; path: string }>('fb:open-file', listener),
  onSaved: (listener) => on<{ name: string; result: SaveResult }>('fb:saved', listener),
  openExternal: (url) => ipcRenderer.invoke('fb:open-external', url) as Promise<void>,
  signers: {
    list: () => ipcRenderer.invoke('fb:signers-list') as Promise<Record<string, { name?: string }>>,
    trust: (fingerprint, name) => ipcRenderer.invoke('fb:signers-trust', fingerprint, name) as Promise<void>,
    forget: (fingerprint) => ipcRenderer.invoke('fb:signers-forget', fingerprint) as Promise<void>,
  },
  appInfo: () => ipcRenderer.invoke('fb:app-info') as Promise<AppInfo>,
  zipList: (id, path) => ipcRenderer.invoke('fb:zip-list', id, path) as Promise<ZipList>,
  zipExtract: (id, path, names, options) => ipcRenderer.invoke('fb:zip-extract', id, path, names, options) as Promise<ExtractResult>,
  copyFromPage: (id) => ipcRenderer.invoke('fb:page-copy', id) as Promise<boolean>,
  findInPage: (id, query, options) => ipcRenderer.invoke('fb:page-find', id, query, options) as Promise<{ found: boolean; count: number }>,
  selectAllInPage: (id) => ipcRenderer.invoke('fb:page-select-all', id) as Promise<void>,
  onPageContext: (listener) => on<{ snapshotId: string; x: number; y: number; hasSelection: boolean }>('fb:page-context', listener),
  clearFindInPage: (id) => ipcRenderer.invoke('fb:page-find-clear', id) as Promise<void>,
  print: (request) => ipcRenderer.invoke('fb:print', request) as Promise<PrintResult>,
  savePdf: (request) => ipcRenderer.invoke('fb:save-pdf', request) as Promise<SaveResult>,
  saveConverted: (id) => ipcRenderer.invoke('fb:save-converted', id) as Promise<SaveResult>,
  openWith: (id, path) => ipcRenderer.invoke('fb:open-with', id, path) as Promise<OpenWithResult>,
  openWithApp: (token, appId, always) => ipcRenderer.invoke('fb:open-with-app', token, appId, always) as Promise<OpenWithResult>,
  openWithCancel: (token) => ipcRenderer.invoke('fb:open-with-cancel', token) as Promise<void>,
  copyText: (text) => ipcRenderer.invoke('fb:copy', text) as Promise<void>,
  reveal: (id, path) => ipcRenderer.invoke('fb:reveal', id, path) as Promise<void>,
  session: { load: () => ipcRenderer.invoke('fb:session-load') as Promise<unknown>, save: (value) => ipcRenderer.invoke('fb:session-save', value) as Promise<void> },
  recent: { list: () => ipcRenderer.invoke('fb:recent-list') as Promise<string[]>, clear: () => ipcRenderer.invoke('fb:recent-clear') as Promise<void> },
}

contextBridge.exposeInMainWorld('fb', api)
