import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppInfo, DocOpen, EditBytesOpen, EditOpen, EditSave, OpResult, ExtractResult, IntegrityEvent, OpenResult, ListResult, FileListResult, MediaOpen, OpenWithResult, PlacesData, PrintResult, RestoreResult, SaveResult, FbApi, ZipList } from '../core/api.ts'

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
  openZipDialog: () => ipcRenderer.invoke('fb:open-zip-dialog') as Promise<OpenResult[]>,
  openAsRoot: (id, path) => ipcRenderer.invoke('fb:open-as-root', id, path) as Promise<OpenResult[]>,
  media: {
    open: (id, path) => ipcRenderer.invoke('fb:media-open', id, path) as Promise<MediaOpen>,
    release: (token) => ipcRenderer.invoke('fb:media-release', token) as Promise<void>,
  },
  fs: {
    create: (id, parent, name, kind) => ipcRenderer.invoke('fb:fs-create', id, parent, name, kind) as Promise<OpResult>,
    rename: (id, path, name) => ipcRenderer.invoke('fb:fs-rename', id, path, name) as Promise<OpResult>,
    move: (id, path, toFolder) => ipcRenderer.invoke('fb:fs-move', id, path, toFolder) as Promise<OpResult>,
    copy: (id, path, toFolder) => ipcRenderer.invoke('fb:fs-copy', id, path, toFolder) as Promise<OpResult>,
    remove: (id, path, how) => ipcRenderer.invoke('fb:fs-remove', id, path, how) as Promise<OpResult>,
  },
  edit: {
    open: (id, path) => ipcRenderer.invoke('fb:edit-open', id, path) as Promise<EditOpen>,
    save: (id, path, text, base, options) => ipcRenderer.invoke('fb:edit-save', id, path, text, base, options) as Promise<EditSave>,
    openBytes: (id, path) => ipcRenderer.invoke('fb:edit-open-bytes', id, path) as Promise<EditBytesOpen>,
    saveBytes: (id, path, bytes, base, options) => ipcRenderer.invoke('fb:edit-save-bytes', id, path, bytes, base, options) as Promise<EditSave>,
    saveBytesAs: (name, bytes) => ipcRenderer.invoke('fb:edit-save-bytes-as', name, bytes),
    saveAs: (name, text, options) => ipcRenderer.invoke('fb:edit-save-as', name, text, options),
  },
  drafts: {
    put: (id, path, draft) => ipcRenderer.invoke('fb:draft-put', id, path, draft) as Promise<boolean>,
    get: (id, path) => ipcRenderer.invoke('fb:draft-get', id, path),
    delete: (id, path) => ipcRenderer.invoke('fb:draft-delete', id, path) as Promise<void>,
    list: () => ipcRenderer.invoke('fb:draft-list'),
    clear: () => ipcRenderer.invoke('fb:draft-clear') as Promise<void>,
  },
  setUnsaved: (count) => ipcRenderer.send('fb:unsaved', count),
  leave: () => ipcRenderer.send('fb:leave'),
  onCloseRequested: (listener) => on<undefined>('fb:close-requested', () => listener()),
  docs: {
    open: (id, path) => ipcRenderer.invoke('fb:doc-open', id, path) as Promise<DocOpen>,
    release: (token) => ipcRenderer.invoke('fb:doc-release', token) as Promise<void>,
  },
  openInRoot: (id, path) => ipcRenderer.invoke('fb:open-in-root', id, path) as Promise<OpenResult[]>,
  listDir: (id, path) => ipcRenderer.invoke('fb:list-dir', id, path) as Promise<ListResult>,
  listFiles: (id, hidden) => ipcRenderer.invoke('fb:list-files', id, hidden) as Promise<FileListResult>,
  openPaths: (paths) => ipcRenderer.invoke('fb:open-paths', paths) as Promise<OpenResult[]>,
  onOpened: (listener) => on<OpenResult[]>('fb:opened', listener),
  close: (id) => ipcRenderer.invoke('fb:close', id) as Promise<void>,
  readFile: (id, path) => ipcRenderer.invoke('fb:read-file', id, path),
  readRange: (id, path, offset, length) => ipcRenderer.invoke('fb:read-range', id, path, offset, length),
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
  openDefault: (id, path) => ipcRenderer.invoke('fb:open-default', id, path) as Promise<OpenWithResult>,
  openWithApp: (token, appId, always) => ipcRenderer.invoke('fb:open-with-app', token, appId, always) as Promise<OpenWithResult>,
  openWithCancel: (token) => ipcRenderer.invoke('fb:open-with-cancel', token) as Promise<void>,
  copyText: (text) => ipcRenderer.invoke('fb:copy', text) as Promise<void>,
  reveal: (id, path) => ipcRenderer.invoke('fb:reveal', id, path) as Promise<void>,
  session: { load: () => ipcRenderer.invoke('fb:session-load') as Promise<unknown>, save: (value) => ipcRenderer.invoke('fb:session-save', value) as Promise<void> },
  places: {
    list: () => ipcRenderer.invoke('fb:places-list') as Promise<PlacesData>,
    openTrash: () => ipcRenderer.invoke('fb:places-open-trash') as Promise<OpenResult[]>,
    addFavorite: (rootId, path) => ipcRenderer.invoke('fb:favorites-add', rootId, path) as Promise<boolean>,
    removeFavorite: (folder) => ipcRenderer.invoke('fb:favorites-remove', folder) as Promise<void>,
    moveFavorite: (folder, to) => ipcRenderer.invoke('fb:favorites-move', folder, to) as Promise<void>,
    clearRecentFolders: () => ipcRenderer.invoke('fb:recent-folders-clear') as Promise<void>,
  },
  trash: {
    restore: (rootId, name) => ipcRenderer.invoke('fb:trash-restore', rootId, name) as Promise<RestoreResult>,
    empty: (rootId) => ipcRenderer.invoke('fb:trash-empty', rootId) as Promise<number>,
  },
  recent: { list: () => ipcRenderer.invoke('fb:recent-list') as Promise<string[]>, clear: () => ipcRenderer.invoke('fb:recent-clear') as Promise<void> },
}

contextBridge.exposeInMainWorld('fb', api)
