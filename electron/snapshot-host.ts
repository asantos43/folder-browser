import crypto from 'node:crypto'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell, webFrameMain, type IpcMainInvokeEvent, type Session, type WebContents, type WebFrameMain } from 'electron'
import type { AppInfo, DocOpen, OpResult, IntegrityEvent, ListResult, MediaOpen, OpenResult, OpenWithResult, PrintRequest, PrintResult, RangeResult, ReadResult, SaveResult, ZipList } from '../core/api.ts'
import { extractSelection, type ExtractResult } from '../core/extract.ts'
import { FRAME_SCRIPT } from '../core/frameScript.ts'
import { BINARY_LIMIT, DOCUMENT_LIMIT, effectiveType, mediaKind, viewKind } from '../core/filekind.ts'
import { DocFiles, documentFlavour } from '../core/docs.ts'
import { imageDocument, textDocument } from '../core/printHtml.ts'
import type { FavoriteFolders } from '../core/favorites.ts'
import { DRAFT_LIMIT, type DraftStore } from '../core/drafts.ts'
import { isPageKeepZip } from '../core/convert/pagekeep.ts'
import type { RecentFiles } from '../core/recent.ts'
import { MediaFiles, serveFile } from '../core/media.ts'
import { RootRegistry } from '../core/roots.ts'
import type { SessionStore } from '../core/session-store.ts'
import type { SignerStore } from '../core/signers.ts'
import { Sources } from '../core/sources.ts'
import { infoOf, SnapshotRegistry, type OpenOutcome } from '../core/snapshots.ts'
import { verifyContents } from '../core/validate/index.ts'
import { launchWith, linuxChoices, makeDefault, openWithDefault, openWithSystem } from './open-with.ts'
import { pdfOf, printContents, usingHtml } from './print.ts'
import { removeStaged, removeStagedSync, stageFile, sweepStaged } from '../core/stage.ts'
import { serveDoc } from './doc-protocol.ts'
import { DOC_SCHEME, MEDIA_SCHEME, SCHEME, SnapshotView } from './snapshot-view.ts'
import { registerPlacesIpc } from './places-ipc.ts'
import { UI_ORIGIN } from './ui-protocol.ts'

const WEB_LINK = /^(https?|mailto):/i
/** The most text the interface may put on the clipboard at once. */
const MAX_COPY = 16 * 2 ** 20
/** The most characters of a text the interface may hand over to be saved (a file is written up to 64 MiB). */
const SAVE_CHARS = 64 * 2 ** 20
/** The most bytes the hex view asks for at once. */
const MAX_RANGE = 2 ** 20

/**
 * The snapshot host of the interface: every open snapshot is an `<iframe sandbox>` of the window, loading `wsnp://<id>/`
 * from one shared session (docs/ARCHITECTURE.md, "Phase 1 spike results"). It answers for the snapshots' files, cancels
 * every request that is not the interface's own or a snapshot asking for itself, hands a clicked web link to the default
 * browser, and offers the interface what it may ask of the main process, over IPC that only the interface's own frame can use.
 */
export class SnapshotHost {
  readonly registry = new SnapshotRegistry({ generator: { name: 'Folder Browser', version: app.getVersion() } })
  /** The folders and ZIP files opened to browse. */
  readonly roots = new RootRegistry()
  /** The videos and sounds being played. */
  private readonly media = new MediaFiles()
  /** The office documents being drawn. */
  private readonly docs = new DocFiles()
  /** The scripts that draw them (the build made them). */
  private readonly docScripts = path.join(app.getAppPath(), 'dist', 'docs')
  /** Both, behind one set of calls: a snapshot's id and a root's are told apart here. */
  readonly sources = new Sources(this.registry, this.roots)
  /** Requests cancelled below the page, for the tests and the log. */
  readonly blocked: string[] = []
  private readonly integrity = new Map<string, AbortController>()
  /** The folders of the copies handed to other applications, removed at quit. */
  private readonly staged = new Set<string>()
  /** The choices the interface is showing (Linux): the copy made for each, its type, and the desktop file of every application listed. */
  private readonly choosing = new Map<string, { dir: string; file: string; mime: string; apps: Map<string, string> }>()
  private pending: OpenResult[] = []
  private listening = false

  private readonly recent: RecentFiles
  private readonly recentFolders: RecentFiles
  private readonly favorites: FavoriteFolders
  private readonly drafts: DraftStore
  private readonly signers: SignerStore
  private readonly openExternal: (url: string) => void

  /** What the command line named is being opened: the interface is told what there is only when that is done. */
  startup: Promise<unknown> = Promise.resolve()
  private readonly session: SessionStore

  constructor(recent: RecentFiles, signers: SignerStore, session: SessionStore, places: { recentFolders: RecentFiles; favorites: FavoriteFolders; drafts: DraftStore }, openExternal: (url: string) => void = (url) => void shell.openExternal(url)) {
    this.recent = recent
    this.recentFolders = places.recentFolders
    this.favorites = places.favorites
    this.drafts = places.drafts
    this.signers = signers
    this.session = session
    this.openExternal = openExternal
  }

  /** Serves `wsnp://<id>/…` from the session and cancels what must not leave. */
  bindSession(ses: Session): void {
    ses.protocol.handle(SCHEME, async (request) => {
      const url = new URL(request.url)
      const res = await this.registry.serve(url.hostname, url.pathname, request.headers.get('range'))
      const body: BodyInit | null = res.body instanceof Readable ? (Readable.toWeb(res.body) as ReadableStream) : res.body ? new Uint8Array(res.body) : null
      return new Response(body, { status: res.status, headers: res.headers })
    })
    ses.protocol.handle(MEDIA_SCHEME, (request) => {
      const media = this.media.get(new URL(request.url).hostname)
      if (!media) return new Response(null, { status: 404 })
      const res = serveFile(media, request.headers.get('range'), request.method)
      return new Response(res.body ? (Readable.toWeb(res.body) as ReadableStream) : null, { status: res.status, headers: res.headers })
    })
    // The page of a document, its file and its script: from the folder the build made.
    ses.protocol.handle(DOC_SCHEME, (request) => serveDoc(this.docs, this.docScripts, request.url))
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (details.url.startsWith(`${UI_ORIGIN}/`) || /^(data|blob|devtools):/.test(details.url)) return callback({})
      // A media element of the interface (never of a snapshot's page) plays what it was given a token for.
      const token = /^fb-media:\/\/([^/]+)\//.exec(details.url)?.[1]
      if (token && this.media.has(token) && details.resourceType === 'media' && (details.frame?.url ?? details.referrer ?? '').startsWith(`${UI_ORIGIN}/`)) return callback({})
      // A document's frame is the interface's to make, and what the frame asks of its own address (its file, its script) is its own.
      const doc = /^fb-doc:\/\/([^/]+)\//.exec(details.url)?.[1]
      if (doc && this.docs.has(doc)) {
        const asking = (details.resourceType === 'subFrame' ? details.frame?.parent?.url : details.frame?.url) ?? ''
        if ((details.resourceType === 'subFrame' && asking.startsWith(`${UI_ORIGIN}/`)) || asking.startsWith(`${DOC_SCHEME}://${doc}/`)) return callback({})
      }
      const wanted = /^wsnp:\/\/([^/]+)\//.exec(details.url)?.[1]
      if (wanted && this.registry.has(wanted)) {
        // For a frame's own navigation the requesting frame is the new frame (no address yet): its parent asked.
        const asking = (details.resourceType === 'subFrame' ? details.frame?.parent?.url : details.frame?.url) ?? ''
        const fromInterface = details.resourceType === 'subFrame' && asking.startsWith(`${UI_ORIGIN}/`)
        const fromItself = asking.startsWith(`${SCHEME}://${wanted}/`)
        if (fromInterface || fromItself) return callback({})
      }
      this.blocked.push(`${details.resourceType} ${details.url}`)
      callback({ cancel: true })
    })
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
  }

  /**
   * Links. The window never leaves the interface, and a snapshot's frame never leaves its snapshot: a click on a web link
   * goes to the default browser, anything else the page does on its own is dropped. The click is recognised by the frame's
   * transient user activation (the `input-event` of a click inside an out-of-process frame does not reach the window).
   */
  guardNavigation(win: BrowserWindow): void {
    const wc = win.webContents
    const clicked = (frame: WebFrameMain | null | undefined): Promise<boolean> => (frame ? frame.executeJavaScript('navigator.userActivation.isActive').then(Boolean, () => false) : Promise.resolve(false))
    const handle = (url: string, event: Electron.Event | undefined, frame: WebFrameMain | null | undefined, isMainFrame: boolean) => {
      if (url.startsWith(`${UI_ORIGIN}/`) || (url.startsWith(`${DOC_SCHEME}://`) && this.docs.has(new URL(url).hostname))) return
      if (url.startsWith(`${SCHEME}://`)) return this.handleFileLink(win, url, event, frame, clicked)
      event?.preventDefault()
      void (!isMainFrame && WEB_LINK.test(url) ? clicked(frame) : Promise.resolve(false)).then((yes) => {
        if (yes) this.openExternal(url)
        else this.blocked.push(`navigation ${url}`)
      })
    }
    // The zoom keys and the wheel with Control held, in the page of a snapshot (another process): a small script posts them to the interface (core/frameScript.ts).
    wc.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) => {
      if (isMainFrame) return
      const frame = webFrameMain.fromId(processId, routingId)
      if (frame?.url.startsWith(`${SCHEME}://`) && this.registry.has(new URL(frame.url).hostname)) void frame.executeJavaScript(FRAME_SCRIPT).catch(() => undefined)
    })
    // A right click in a snapshot's page is another process's event: the interface draws the menu, at the place the main process says.
    wc.on('context-menu', (_event, params) => {
      const id = /^wsnp:\/\/([^/]+)\//.exec(params.frame?.url ?? params.frameURL ?? '')?.[1]
      if (!id || !this.registry.has(id)) return
      const zoom = wc.getZoomFactor() || 1
      win.webContents.send('fb:page-context', { snapshotId: id, x: Math.round(params.x / zoom), y: Math.round(params.y / zoom), hasSelection: params.selectionText.length > 0 })
    })
    wc.on('will-frame-navigate', (event) => handle(event.url, event, event.frame, event.isMainFrame))
    wc.on('will-redirect', (event) => handle(event.url, event, event.frame, event.isMainFrame))
    wc.setWindowOpenHandler(({ url }) => {
      handle(url, undefined, null, false)
      return { action: 'deny' }
    })
  }

  /**
   * A link inside a snapshot to another of its files. A page stays in its frame; anything else (a PDF, a ZIP, a picture, a
   * text) is not shown in the frame: what a tab can show opens in one, and the rest is offered with Save As, as the guidelines ask.
   */
  private handleFileLink(win: BrowserWindow, url: string, event: Electron.Event | undefined, frame: WebFrameMain | null | undefined, clicked: (f: WebFrameMain | null | undefined) => Promise<boolean>): void {
    const target = new URL(url)
    const snapshot = this.registry.get(target.hostname)
    if (!snapshot) return
    let name: string
    try {
      name = decodeURIComponent(target.pathname).replace(/^\/+/, '')
    } catch {
      return
    }
    const type = snapshot.types.get(name)
    if (!name || name === snapshot.manifest.pages[0].entry || !snapshot.archive.get(name) || /^(text\/html|application\/xhtml\+xml)\b/.test(type ?? '')) return
    event?.preventDefault()
    void clicked(frame).then(async (yes) => {
      if (!yes || win.isDestroyed()) return
      const kind = mediaKind(type, name) ? 'media' : viewKind(type, name, snapshot.archive.get(name)!.size)
      if (kind === 'other') win.webContents.send('fb:saved', { name, result: await this.save(win, snapshot.id, name) })
      else win.webContents.send('fb:open-file', { snapshotId: snapshot.id, path: name })
    })
  }

  /**
   * Opens what is named and reports each outcome; what is open already is not opened again. A `.wsnp` (or a ZIP saved by PageKeep) is a snapshot; a folder, or any
   * other ZIP, is a root to browse; any other file opens its folder, and the file in it.
   */
  async openPaths(paths: string[], options: { withFolder?: boolean } = {}): Promise<OpenResult[]> {
    const results: OpenResult[] = []
    for (const file of paths) results.push(await this.openOne(file, options.withFolder !== false))
    return results
  }

  /** `withFolder`: a `.wsnp` (or a PageKeep ZIP) comes with the folder it is in, opened to browse: it is a file of that folder. (Not from the tree of that folder, which is open.) */
  private async openOne(file: string, withFolder: boolean): Promise<OpenResult> {
    const stat = await fs.promises.stat(file).catch(() => undefined)
    const kind = !stat ? 'missing' : stat.isDirectory() ? 'folder' : /\.wsnp$/i.test(file) ? 'snapshot' : /\.zip$/i.test(file) ? ((await isPageKeepZip(file)) ? 'snapshot' : 'zip') : 'file'
    if (kind === 'folder' || kind === 'zip') return this.openRoot(file)
    if (kind === 'file' && stat) {
      const opened = await this.openRoot(path.dirname(file))
      return 'root' in opened ? { ...opened, open: { path: path.basename(file), size: stat.size } } : opened
    }
    const outcome: OpenOutcome = await this.registry.openPath(file).catch((err: Error) => ({ ok: false as const, path: file, issues: [{ code: 'read-error' as const, path: path.basename(file), detail: err.message }], omitted: 0 }))
    if (outcome.ok) {
      this.recent.add(outcome.snapshot.path)
      const folder = withFolder ? await this.openRoot(path.dirname(file)) : undefined
      return { ok: true, snapshot: infoOf(outcome.snapshot), already: outcome.already, ...(folder && 'root' in folder ? { folder: folder.root } : {}) }
    }
    return outcome
  }

  private async openRoot(target: string, options: { trash?: boolean } = {}): Promise<OpenResult> {
    const opened = await this.roots.openPath(target, options)
    if ('error' in opened) {
      const why = { 'not-found': 'It is not there.', 'not-supported': 'It is neither a folder nor a ZIP file.', 'too-large': 'The ZIP is too large to browse here.', 'not-zip': 'It is not a ZIP file.', denied: 'It cannot be read: the permission is missing.' }[opened.error]
      return { ok: false, path: target, issues: [{ code: 'read-error', path: path.basename(target) || target, detail: why }], omitted: 0 }
    }
    this.recent.add(opened.root.path)
    if (!options.trash) this.recentFolders.add(opened.root.path)
    return { ok: true, root: opened.root, already: opened.already }
  }

  /** Files the system asked for: shown at once when the interface is listening, kept for it otherwise. */
  async openFromSystem(win: BrowserWindow | undefined, paths: string[]): Promise<void> {
    if (!paths.length) return
    const results = await this.openPaths(paths)
    if (this.listening && win && !win.isDestroyed()) {
      win.webContents.send('fb:opened', results)
      if (win.isMinimized()) win.restore()
      win.focus()
    } else this.pending.push(...results)
  }

  async save(win: BrowserWindow, id: string, name: string): Promise<SaveResult> {
    const stream = await this.sources.stream(id, name)
    if (!stream) return { saved: false, reason: 'error', message: 'The file is not there.' }
    const picked = await dialog.showSaveDialog(win, { defaultPath: path.basename(name) })
    if (picked.canceled || !picked.filePath) {
      stream.destroy()
      return { saved: false, reason: 'cancelled' }
    }
    try {
      await pipeline(stream, fs.createWriteStream(picked.filePath))
      return { saved: true, path: picked.filePath }
    } catch (err) {
      return { saved: false, reason: 'error', message: (err as Error).message }
    }
  }

  /**
   * The top frame of a snapshot's page in the window (a frame of the page itself is not it), or the frame that holds the drawing of a document: its page, or, for an
   * OpenDocument file (which is drawn in a frame of the page), that frame.
   */
  private pageFrame(win: BrowserWindow, id: string): WebFrameMain | undefined {
    const top = win.webContents.mainFrame
    const snapshot = top.frames.find((f) => f.url.startsWith(`${SCHEME}://${id}/`))
    if (snapshot) return snapshot
    const doc = top.frames.find((f) => f.url.startsWith(`${DOC_SCHEME}://${id}/`))
    return doc?.frames.find((f) => f.url === 'about:srcdoc') ?? doc
  }

  /** What the page has selected, to the clipboard. The page itself is asked: the frame is another process, and the menu has the focus. */
  private async copyFromPage(win: BrowserWindow, id: string): Promise<boolean> {
    const text = await this.pageFrame(win, id)?.executeJavaScript('String(getSelection())').catch(() => '')
    if (typeof text !== 'string' || !text) return false
    clipboard.writeText(text.slice(0, MAX_COPY))
    return true
  }

  /** Text search inside the page: the browser's own `find`, run in the page's frame, which selects the match and scrolls to it. */
  private async findInPage(win: BrowserWindow, id: string, query: string, options: { caseSensitive: boolean; backwards: boolean; reset: boolean; count: boolean }): Promise<{ found: boolean; count: number }> {
    const frame = this.pageFrame(win, id)
    if (!frame || !query) {
      await frame?.executeJavaScript('getSelection()?.removeAllRanges()').catch(() => undefined)
      return { found: false, count: 0 }
    }
    const args = JSON.stringify({ q: query, cs: options.caseSensitive, back: options.backwards, reset: options.reset, count: options.count })
    const script = `((a) => {
      if (a.reset) getSelection()?.removeAllRanges()
      const found = window.find(a.q, a.cs, a.back, true, false, false, false)
      let count = 0
      if (a.count) {
        const text = document.body?.innerText ?? ''
        const hay = a.cs ? text : text.toLowerCase()
        const needle = a.cs ? a.q : a.q.toLowerCase()
        for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) count++
      }
      return { found, count }
    })(${args})`
    const result: unknown = await frame.executeJavaScript(script).catch(() => undefined)
    const r = result as { found?: unknown; count?: unknown } | undefined
    return { found: r?.found === true, count: typeof r?.count === 'number' ? r.count : 0 }
  }

  /**
   * Shows what a tab shows to `use` (the system's print, or a PDF), in a view that is never the interface and never shown: a page, or an
   * HTML file of the snapshot, is loaded from a view of its own with the same isolation and no network as a tab; a text or a picture is a
   * static page in a window with no script.
   */
  private async render<T>(win: BrowserWindow, request: PrintRequest, use: (wc: WebContents) => Promise<T>): Promise<{ value: T } | { failed: PrintResult }> {
    try {
      if (request.kind === 'document') return await this.renderDocument(request, use)
      if (request.kind === 'text') return { value: await usingHtml(textDocument((request.name ?? request.title).slice(0, 300), request.text), use) }
      if (this.roots.has(request.id)) {
        // A picture of a folder or a ZIP is printed as it is; the page of a snapshot and an HTML file as a page are the snapshots'.
        if (request.kind !== 'image') return { failed: { printed: false, reason: 'unsupported' } }
        const type = effectiveType(undefined, request.path)
        if (!/^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(type)) return { failed: { printed: false, reason: 'unsupported' } }
        const read = await this.sources.read(request.id, request.path, BINARY_LIMIT)
        if (!('bytes' in read)) return { failed: { printed: false, reason: 'error', message: read.error } }
        return { value: await usingHtml(imageDocument(path.basename(request.path), type, read.bytes), use) }
      }
      const snapshot = this.registry.get(request.id)
      if (!snapshot) return { failed: { printed: false, reason: 'error', message: 'The snapshot is closed.' } }
      if (request.kind === 'image') {
        const type = effectiveType(snapshot.types.get(request.path), request.path)
        if (!/^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(type)) return { failed: { printed: false, reason: 'unsupported' } }
        const read = await this.registry.read(snapshot.id, request.path, BINARY_LIMIT)
        if (!('bytes' in read)) return { failed: { printed: false, reason: 'error', message: read.error } }
        return { value: await usingHtml(imageDocument(path.basename(request.path), type, read.bytes), use) }
      }
      // An HTML file is shown as the page it is, from the archive; one inside a ZIP of the snapshot is not in it.
      if (request.kind === 'html' && (!snapshot.archive.get(request.path) || !/^(text\/html|application\/xhtml\+xml)\b/.test(effectiveType(snapshot.types.get(request.path), request.path)))) return { failed: { printed: false, reason: 'unsupported' } }
      const view = await SnapshotView.open(snapshot.file, { sandbox: true, openExternal: () => undefined, show: false, ...(request.kind === 'html' ? { entry: request.path } : {}) })
      try {
        return { value: await use(view.webContents) }
      } finally {
        await view.close().catch(() => undefined)
        if (!win.isDestroyed()) win.focus()
      }
    } catch (err) {
      return { failed: { printed: false, reason: 'error', message: (err as Error).message } }
    }
  }

  /**
   * A document, drawn by its own page in a window that is never shown (a session of its own that can load only that page, its file and its script), handed to `use` once it is
   * drawn: the whole of it, every sheet and every slide, as the page makes it for printing.
   */
  private async renderDocument<T>(request: Extract<PrintRequest, { kind: 'document' }>, use: (wc: WebContents) => Promise<T>): Promise<{ value: T } | { failed: PrintResult }> {
    const flavour = documentFlavour(this.registry.get(request.id)?.types.get(request.path), request.path)
    if (!flavour || !this.sources.has(request.id)) return { failed: { printed: false, reason: 'unsupported' } }
    const read = await this.sources.read(request.id, request.path, DOCUMENT_LIMIT)
    if ('error' in read) return { failed: { printed: false, reason: 'error', message: read.error } }
    const token = this.docs.add({ bytes: new Uint8Array(read.bytes), name: request.path.split(/[!/\\]+/).pop() ?? request.path, flavour })
    const partition = `doc-print-${crypto.randomBytes(6).toString('hex')}`
    const ses = session.fromPartition(partition)
    ses.protocol.handle(DOC_SCHEME, (req) => serveDoc(this.docs, this.docScripts, req.url))
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !(details.url.startsWith(`${DOC_SCHEME}://${token}/`) || /^(data|blob):/.test(details.url)) }))
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    const window = new BrowserWindow({ show: false, webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } })
    try {
      await window.loadURL(`${DOC_SCHEME}://${token}/?print=1`)
      // Drawn when the page says so (it sets its state); a document that never is, is given up on.
      const waited = Date.now()
      for (;;) {
        const state: unknown = await window.webContents.executeJavaScript('window.__fbDocState').catch(() => undefined)
        if (state === 'ready') break
        if (state === 'error') return { failed: { printed: false, reason: 'error', message: String(await window.webContents.executeJavaScript('window.__fbDocMessage').catch(() => '')) } }
        if (Date.now() - waited > 45_000) return { failed: { printed: false, reason: 'error', message: 'The document took too long to draw.' } }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      await window.webContents.executeJavaScript('document.fonts?.ready').catch(() => undefined)
      return { value: await use(window.webContents) }
    } finally {
      if (!window.isDestroyed()) window.destroy()
      this.docs.release(token)
    }
  }

  private async print(win: BrowserWindow, request: PrintRequest): Promise<PrintResult> {
    const done = await this.render(win, request, printContents)
    return 'value' in done ? done.value : done.failed
  }

  /** The name a PDF is offered under: the title of the page, or the name of the file. */
  private pdfName(request: PrintRequest): string {
    const snapshot = 'id' in request ? this.registry.get(request.id) : undefined
    const base = request.kind === 'snapshot' ? (snapshot?.manifest.title ?? '') || path.basename(snapshot?.path ?? '', path.extname(snapshot?.path ?? '')) : request.kind === 'text' ? (request.name ?? request.title) : path.basename(request.path)
    const clean = [...base.replace(/\.[A-Za-z0-9]{1,5}$/, '')].map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? ' ' : ch)).join('').replace(/ +/g, ' ').trim().slice(0, 120)
    return `${clean || 'snapshot'}.pdf`
  }

  /** Asks where, then writes the PDF of what `print` would print. */
  private async savePdf(win: BrowserWindow, request: PrintRequest): Promise<SaveResult> {
    const picked = await dialog.showSaveDialog(win, { defaultPath: this.pdfName(request), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (picked.canceled || !picked.filePath) return { saved: false, reason: 'cancelled' }
    const target = /\.pdf$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.pdf`
    const done = await this.render(win, request, pdfOf)
    if ('failed' in done) return { saved: false, reason: 'error', message: done.failed.printed ? undefined : (done.failed.message ?? done.failed.reason) }
    try {
      await fs.promises.writeFile(target, done.value)
      return { saved: true, path: target }
    } catch (err) {
      return { saved: false, reason: 'error', message: (err as Error).message }
    }
  }

  /** The `.wsnp` made from a PageKeep ZIP, once it has passed the checks of the format: only then is it offered to be saved. */
  private async saveConverted(win: BrowserWindow, id: string): Promise<SaveResult> {
    const snapshot = this.registry.get(id)
    const checked = await this.registry.checkedConversion(id)
    if ('error' in checked || !snapshot) return { saved: false, reason: 'error', message: 'This snapshot was not converted from a ZIP.' }
    if ('problems' in checked) return { saved: false, reason: 'error', message: `The converted file did not pass the checks of the format (${checked.problems.map((p) => `${p.code}${p.path ? ` ${p.path}` : ''}`).join(', ')}), so it is not saved.` }
    const base = path.basename(snapshot.path, path.extname(snapshot.path))
    const picked = await dialog.showSaveDialog(win, { defaultPath: path.join(path.dirname(snapshot.path), `${base}.wsnp`), filters: [{ name: 'WSNP snapshot', extensions: ['wsnp'] }] })
    if (picked.canceled || !picked.filePath) return { saved: false, reason: 'cancelled' }
    const target = /\.wsnp$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.wsnp`
    try {
      // To a temporary name beside the target and then into place, so a failed write never leaves half a file where a snapshot was.
      const partial = `${target}.${process.pid}.part`
      await fs.promises.copyFile(checked.file, partial)
      await fs.promises.rename(partial, target)
      return { saved: true, path: target }
    } catch (err) {
      return { saved: false, reason: 'error', message: (err as Error).message }
    }
  }

  /**
   * Hands a read-only copy of a file to an application the user picks. On Windows and macOS that is the system's own dialog. On Linux the viewer shows
   * the choice itself (`linuxChoices`: the desktop's chooser would open behind the window on Wayland) and waits for `openWithApp` or `openWithCancel`.
   */
  private async openWith(id: string, name: string): Promise<OpenWithResult> {
    const staged = await stageFile(this.sources, id, name, os.tmpdir()).catch((err: Error) => ({ error: 'error' as const, message: err.message }))
    if ('error' in staged) return { opened: false, reason: staged.error === 'risky' ? 'unsafe' : staged.error === 'no-file' ? 'no-file' : 'error', ...('message' in staged ? { message: staged.message } : {}) }
    this.staged.add(staged.dir)
    const discard = async () => {
      this.staged.delete(staged.dir)
      await removeStaged(staged.dir)
    }
    if (process.platform === 'linux' && !process.env.WSNP_OPEN_WITH_LOG) {
      const choices = await linuxChoices(staged.file)
      if (!choices || !choices.apps.length) {
        const outcome = await openWithDefault(staged.file)
        if (!outcome.opened) await discard()
        return outcome
      }
      const token = crypto.randomBytes(12).toString('hex')
      this.choosing.set(token, { dir: staged.dir, file: staged.file, mime: choices.mime, apps: new Map(choices.apps.map((a) => [a.id, a.file])) })
      return { choose: { token, name: path.basename(staged.file), mime: choices.mime, mimeLabel: choices.mimeLabel, apps: choices.apps.map((a) => ({ id: a.id, name: a.name, recommended: a.recommended, ...(a.iconUrl ? { iconUrl: a.iconUrl } : {}) })) } }
    }
    const outcome = await openWithSystem(staged.file)
    // A copy nobody opened is not kept.
    if (!outcome.opened) await discard()
    return outcome
  }

  /** Opens a copy of a file in the application the system has for its type, with no choice. */
  private async openDefault(id: string, name: string): Promise<OpenWithResult> {
    const staged = await stageFile(this.sources, id, name, os.tmpdir()).catch((err: Error) => ({ error: 'error' as const, message: err.message }))
    if ('error' in staged) return { opened: false, reason: staged.error === 'risky' ? 'unsafe' : staged.error === 'no-file' ? 'no-file' : 'error', ...('message' in staged ? { message: staged.message } : {}) }
    this.staged.add(staged.dir)
    if (process.env.WSNP_OPEN_WITH_LOG) {
      fs.appendFileSync(process.env.WSNP_OPEN_WITH_LOG, `${staged.file}\n`)
      return { opened: true, chooser: false }
    }
    const outcome = await openWithDefault(staged.file)
    // A copy nobody opened is not kept.
    if (!outcome.opened) {
      this.staged.delete(staged.dir)
      await removeStaged(staged.dir)
    }
    return outcome
  }

  /**
   * Makes a video or a sound of a root playable: a file of a folder is served as it is, an entry of a ZIP (which has no cheap seek) from a copy in a folder of its own.
   * The interface gets a token (an address), never a path.
   */
  private async openMedia(id: string, name: string): Promise<MediaOpen> {
    const snapshot = this.registry.get(id)
    // A file of a snapshot is played by the type its manifest declares; a root's by its name.
    const declared = snapshot?.types.get(name)
    const kind = mediaKind(declared, name)
    if (!kind || !(snapshot || this.roots.has(id))) return { error: 'unsupported' }
    let file = this.roots.has(id) ? await this.roots.diskFile(id, name) : null
    let scratch: string | undefined
    if (!file) {
      const staged = await stageFile(this.sources, id, name, os.tmpdir(), { maxBytes: 2 * 2 ** 30, prefix: 'fb-media-' }).catch(() => ({ error: 'no-file' as const }))
      if ('error' in staged) return { error: staged.error === 'too-large' ? 'too-large' : 'no-file' }
      file = staged.file
      scratch = staged.dir
      this.staged.add(staged.dir)
    }
    const stat = await fs.promises.stat(file).catch(() => undefined)
    if (!stat?.isFile()) return { error: 'no-file' }
    const mime = effectiveType(declared, name)
    const token = this.media.add({ file, mime, size: stat.size, ...(scratch ? { scratch } : {}) })
    return { token, url: `${MEDIA_SCHEME}://${token}/`, kind, mime, size: stat.size }
  }

  /** An office document of a root or a snapshot, read whole (up to the limit) and given a page of its own: what draws it runs in a frame that reaches nothing. */
  private async openDoc(id: string, name: string): Promise<DocOpen> {
    const declared = this.registry.get(id)?.types.get(name)
    const flavour = documentFlavour(declared, name)
    if (!flavour || !this.sources.has(id)) return { error: 'unsupported' }
    const read = await this.sources.read(id, name, DOCUMENT_LIMIT)
    if ('error' in read) return { error: read.error === 'too-large' ? 'too-large' : 'no-file' }
    const token = this.docs.add({ bytes: new Uint8Array(read.bytes), name: name.split(/[!/\\]+/).pop() ?? name, flavour })
    return { token, url: `${DOC_SCHEME}://${token}/`, flavour }
  }

  private async releaseMedia(token: string): Promise<void> {
    const media = this.media.release(token)
    if (media?.scratch) {
      this.staged.delete(media.scratch)
      await removeStaged(media.scratch)
    }
  }

  /** The application picked in the viewer's own chooser: only one the chooser listed, and only for the copy made for it. */
  private async openWithApp(token: string, appId: string, always: boolean): Promise<OpenWithResult> {
    const choice = this.choosing.get(token)
    const desktopFile = choice?.apps.get(appId)
    if (!choice || !desktopFile) return { opened: false, reason: 'no-file' }
    this.choosing.delete(token)
    const outcome = await launchWith(desktopFile, choice.file)
    if (outcome.opened && always) await makeDefault(choice.mime, appId)
    if (!outcome.opened) {
      this.staged.delete(choice.dir)
      await removeStaged(choice.dir)
    }
    return outcome
  }

  private async openWithCancel(token: string): Promise<void> {
    const choice = this.choosing.get(token)
    if (!choice) return
    this.choosing.delete(token)
    this.staged.delete(choice.dir)
    await removeStaged(choice.dir)
  }

  /** At quit (synchronously: the application does not wait): the copies handed to other applications go. */
  cleanup(): void {
    for (const dir of this.staged) removeStagedSync(dir)
    this.staged.clear()
    this.media.releaseAll()
    this.docs.releaseAll()
  }

  /** At start: the copies an earlier session left (a crash), a day old or more. */
  sweepOldCopies(): Promise<number> {
    return sweepStaged(os.tmpdir(), 24 * 3_600_000)
  }

  private async verify(win: BrowserWindow, id: string): Promise<void> {
    const snapshot = this.registry.get(id)
    if (!snapshot) return
    this.integrity.get(id)?.abort()
    const controller = new AbortController()
    this.integrity.set(id, controller)
    const send = (event: IntegrityEvent) => !win.isDestroyed() && win.webContents.send('fb:integrity', event)
    let last = 0
    const report = await verifyContents(snapshot.archive, snapshot.manifest, {
      signal: controller.signal,
      onProgress: (done, total) => {
        const now = Date.now()
        if (now - last > 100) {
          last = now
          send({ id, state: 'running', done, total })
        }
      },
    })
    if (this.integrity.get(id) === controller) this.integrity.delete(id)
    if (!report.aborted) send({ id, state: 'done', report })
  }

  /** IPC for the interface. Only the window's own top frame may call: a snapshot's frame has no preload, and is refused anyway. */
  registerIpc(getWindow: () => BrowserWindow | undefined): void {
    const fromInterface = (event: IpcMainInvokeEvent) => {
      const win = getWindow()
      if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith(`${UI_ORIGIN}/`)) throw new Error('refused')
      return win
    }
    const handle = <A extends unknown[], R>(channel: string, fn: (win: BrowserWindow, ...args: A) => R | Promise<R>) =>
      ipcMain.handle(channel, (event, ...args) => fn(fromInterface(event), ...(args as A)))
    const isPaths = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every((p) => typeof p === 'string' && p.length < 4096)

    handle('fb:ready', async () => {
      // The files of the command line first: an interface that asks before they are open would take the list for empty and reopen the last session.
      await this.startup
      this.listening = true
      const results = this.pending
      this.pending = []
      return results
    })
    handle('fb:open-dialog', async (win) => {
      const picked = await dialog.showOpenDialog(win, {
        properties: ['openFile', 'multiSelections'],
        // A .wsnp, or an older ZIP saved by PageKeep (opened converted); the first filter is what is shown first.
        filters: [{ name: 'WSNP snapshots and PageKeep ZIP files', extensions: ['wsnp', 'zip'] }, { name: 'WSNP snapshot', extensions: ['wsnp'] }, { name: 'PageKeep ZIP', extensions: ['zip'] }, { name: 'All files', extensions: ['*'] }],
      })
      return picked.canceled ? [] : this.openPaths(picked.filePaths)
    })
    handle('fb:open-folder-dialog', async (win) => {
      // (macOS can choose a folder or a file in one dialog; Linux and Windows cannot, which is why Open ZIP File… is its own command.)
      const picked = await dialog.showOpenDialog(win, { properties: process.platform === 'darwin' ? ['openDirectory', 'openFile', 'multiSelections'] : ['openDirectory', 'multiSelections'] })
      return picked.canceled ? [] : this.openPaths(picked.filePaths)
    })
    // A ZIP file chosen to be browsed as a folder (a PageKeep ZIP too: that is what the user asked for here).
    handle('fb:open-zip-dialog', async (win) => {
      const picked = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'ZIP files', extensions: ['zip'] }, { name: 'All files', extensions: ['*'] }] })
      if (picked.canceled) return []
      const results: OpenResult[] = []
      for (const file of picked.filePaths) results.push(await this.openRoot(file))
      return results
    })
    handle('fb:open-in-root', async (_win, id: unknown, name: unknown): Promise<OpenResult[]> => {
      // Only a `.wsnp` of a folder, by its path in the root: the interface never names a path of the disk.
      const file = typeof id === 'string' && typeof name === 'string' && /\.wsnp$/i.test(name) ? await this.roots.diskFile(id, name) : null
      return file ? this.openPaths([file], { withFolder: false }) : []
    })
    handle('fb:list-dir', async (_win, id: unknown, dir: unknown): Promise<ListResult> => (typeof id === 'string' && typeof dir === 'string' && dir.length < 4096 ? this.roots.list(id, dir) : { error: 'no-root' }))
    handle('fb:open-paths', (_win, paths: unknown) => (isPaths(paths) ? this.openPaths(paths) : []))
    handle('fb:close', async (_win, id: unknown) => {
      if (typeof id !== 'string') return
      this.integrity.get(id)?.abort()
      this.integrity.delete(id)
      await this.sources.close(id)
    })
    handle('fb:read-file', async (_win, id: unknown, name: unknown): Promise<ReadResult> => {
      if (typeof id !== 'string' || typeof name !== 'string') return { error: 'no-file' }
      const read = await this.sources.read(id, name, BINARY_LIMIT)
      return 'bytes' in read ? { bytes: new Uint8Array(read.bytes) } : read
    })
    handle('fb:read-range', async (_win, id: unknown, name: unknown, offset: unknown, length: unknown): Promise<RangeResult> => {
      if (typeof id !== 'string' || typeof name !== 'string' || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || (offset as number) < 0 || (length as number) < 0) return { error: 'no-file' }
      const read = await this.sources.roots.range(id, name, offset as number, Math.min(length as number, MAX_RANGE))
      return 'bytes' in read ? { bytes: new Uint8Array(read.bytes), size: read.size } : read
    })
    handle('fb:save-as', (win, id: unknown, name: unknown): Promise<SaveResult> | SaveResult =>
      typeof id === 'string' && typeof name === 'string' ? this.save(win, id, name) : { saved: false, reason: 'error' })
    handle('fb:verify', (win, id: unknown) => (typeof id === 'string' ? this.verify(win, id) : undefined))
    handle('fb:open-external', (_win, url: unknown) => {
      if (typeof url === 'string' && WEB_LINK.test(url)) this.openExternal(url)
    })
    handle('fb:copy', (_win, text: unknown) => {
      if (typeof text === 'string' && text.length <= MAX_COPY) clipboard.writeText(text)
    })
    handle('fb:zip-list', async (_win, id: unknown, zipPath: unknown): Promise<ZipList> => {
      if (typeof id !== 'string' || typeof zipPath !== 'string') return { error: 'no-file' }
      const zip = await this.sources.zipAt(id, zipPath)
      return 'error' in zip ? zip : { entries: [...zip.entries], truncated: zip.truncated }
    })
    handle('fb:zip-extract', async (win, id: unknown, zipPath: unknown, names: unknown, options: unknown): Promise<ExtractResult> => {
      if (typeof id !== 'string' || typeof zipPath !== 'string' || !Array.isArray(names) || names.length > 50_000 || !names.every((n) => typeof n === 'string')) return { error: 'no-file' }
      return extractSelection(this.sources, id, zipPath, names as string[], {
        file: async (defaultName) => {
          const picked = await dialog.showSaveDialog(win, { defaultPath: defaultName })
          return picked.canceled ? undefined : picked.filePath
        },
        folder: async () => {
          const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Extract Here' })
          return picked.canceled ? undefined : picked.filePaths[0]
        },
      }, { folder: (options as { folder?: unknown } | null)?.folder === true })
    })
    handle('fb:page-copy', (win, id: unknown) => (typeof id === 'string' ? this.copyFromPage(win, id) : false))
    handle('fb:page-find', (win, id: unknown, query: unknown, options: unknown) => {
      const o = (options ?? {}) as Record<string, unknown>
      if (typeof id !== 'string' || typeof query !== 'string' || query.length > 1000) return { found: false, count: 0 }
      return this.findInPage(win, id, query, { caseSensitive: o.caseSensitive === true, backwards: o.backwards === true, reset: o.reset === true, count: o.count === true })
    })
    handle('fb:page-select-all', async (win, id: unknown) => {
      if (typeof id === 'string') await this.pageFrame(win, id)?.executeJavaScript('(() => { const s = getSelection(); s?.removeAllRanges(); if (document.body) s?.selectAllChildren(document.body) })()').catch(() => undefined)
    })
    handle('fb:page-find-clear', async (win, id: unknown) => {
      if (typeof id === 'string') await this.findInPage(win, id, '', { caseSensitive: false, backwards: false, reset: true, count: false })
    })
    const asPrintRequest = (request: unknown): PrintRequest | null => {
      const r = request as Record<string, unknown> | null
      if (r?.kind === 'snapshot' && typeof r.id === 'string') return { kind: 'snapshot', id: r.id }
      if ((r?.kind === 'image' || r?.kind === 'html' || r?.kind === 'document') && typeof r.id === 'string' && typeof r.path === 'string') return { kind: r.kind, id: r.id, path: r.path }
      if (r?.kind === 'text' && typeof r.title === 'string' && typeof r.text === 'string' && r.text.length <= MAX_COPY) return { kind: 'text', title: r.title, text: r.text, ...(typeof r.name === 'string' ? { name: r.name.slice(0, 300) } : {}) }
      return null
    }
    handle('fb:print', (win, request: unknown): Promise<PrintResult> | PrintResult => {
      const valid = asPrintRequest(request)
      return valid ? this.print(win, valid) : { printed: false, reason: 'unsupported' }
    })
    handle('fb:save-pdf', (win, request: unknown): Promise<SaveResult> | SaveResult => {
      const valid = asPrintRequest(request)
      return valid ? this.savePdf(win, valid) : { saved: false, reason: 'error', message: 'This cannot be saved as a PDF.' }
    })
    handle('fb:save-converted', (win, id: unknown): Promise<SaveResult> | SaveResult => (typeof id === 'string' ? this.saveConverted(win, id) : { saved: false, reason: 'error' }))
    handle('fb:open-with', (_win, id: unknown, name: unknown): Promise<OpenWithResult> | OpenWithResult => (typeof id === 'string' && typeof name === 'string' ? this.openWith(id, name) : { opened: false, reason: 'no-file' }))
    handle('fb:media-open', (_win, id: unknown, name: unknown): Promise<MediaOpen> | MediaOpen => (typeof id === 'string' && typeof name === 'string' ? this.openMedia(id, name) : { error: 'no-file' }))
    // The files of a folder that was opened: the interface names the root and paths inside it, and the answer says what was done (or why not).
    const short = (v: unknown): v is string => typeof v === 'string' && v.length < 4096
    handle('fb:fs-create', (_win, id: unknown, parent: unknown, name: unknown, kind: unknown): Promise<OpResult> | OpResult =>
      short(id) && short(parent) && short(name) && (kind === 'file' || kind === 'dir') ? this.roots.create(id, parent, name, kind) : { ok: false, error: 'invalid-name' })
    handle('fb:fs-rename', (_win, id: unknown, name: unknown, newName: unknown): Promise<OpResult> | OpResult => (short(id) && short(name) && short(newName) ? this.roots.rename(id, name, newName) : { ok: false, error: 'invalid-name' }))
    handle('fb:fs-move', (_win, id: unknown, name: unknown, to: unknown): Promise<OpResult> | OpResult => (short(id) && short(name) && short(to) ? this.roots.move(id, name, to) : { ok: false, error: 'not-found' }))
    // Editing a text file of a folder: the text in and out whole; the line ending and the byte order mark of the file travel with it.
    const version = (v: unknown): v is { mtimeMs: number; size: number; crc32?: number } =>
      typeof v === 'object' && v !== null && Number.isFinite((v as { mtimeMs?: unknown }).mtimeMs) && Number.isFinite((v as { size?: unknown }).size) && ((v as { crc32?: unknown }).crc32 === undefined || Number.isFinite((v as { crc32?: unknown }).crc32))
    const ending = (v: unknown): v is 'lf' | 'crlf' | 'cr' => v === 'lf' || v === 'crlf' || v === 'cr'
    handle('fb:edit-open', (_win, id: unknown, name: unknown) => (short(id) && short(name) ? this.roots.edit(id, name) : ({ ok: false, error: 'no-file' } as const)))
    handle('fb:edit-save', (_win, id: unknown, name: unknown, text: unknown, base: unknown, options: unknown) => {
      const o = options as { eol?: unknown; bom?: unknown; overwrite?: unknown } | null
      if (!short(id) || !short(name) || typeof text !== 'string' || text.length > SAVE_CHARS || !version(base) || !o || !ending(o.eol) || typeof o.bom !== 'boolean') return { ok: false, error: 'failed' } as const
      return this.roots.saveEdit(id, name, text, base, { eol: o.eol, bom: o.bom, overwrite: o.overwrite === true })
    })
    handle('fb:edit-open-bytes', (_win, id: unknown, name: unknown) => (short(id) && short(name) ? this.roots.editBytes(id, name) : ({ ok: false, error: 'no-file' } as const)))
    handle('fb:edit-save-bytes', (_win, id: unknown, name: unknown, bytes: unknown, base: unknown, options: unknown) => {
      const o = options as { overwrite?: unknown } | null
      if (!short(id) || !short(name) || !(bytes instanceof Uint8Array) || bytes.length > SAVE_CHARS || !version(base)) return { ok: false, error: 'failed' } as const
      return this.roots.saveEditBytes(id, name, bytes, base, o?.overwrite === true)
    })
    handle('fb:edit-save-bytes-as', async (win, name: unknown, bytes: unknown): Promise<SaveResult> => {
      if (!short(name) || !(bytes instanceof Uint8Array) || bytes.length > SAVE_CHARS) return { saved: false, reason: 'error' }
      const picked = await dialog.showSaveDialog(win, { defaultPath: path.basename(name) })
      if (picked.canceled || !picked.filePath) return { saved: false, reason: 'cancelled' }
      try {
        await fs.promises.writeFile(picked.filePath, bytes)
        return { saved: true, path: picked.filePath }
      } catch (err) {
        return { saved: false, reason: 'error', message: (err as Error).message }
      }
    })
    handle('fb:edit-save-as', async (win, name: unknown, text: unknown, options: unknown): Promise<SaveResult> => {
      const o = options as { eol?: unknown; bom?: unknown } | null
      if (!short(name) || typeof text !== 'string' || text.length > SAVE_CHARS || !o || !ending(o.eol) || typeof o.bom !== 'boolean') return { saved: false, reason: 'error' }
      const picked = await dialog.showSaveDialog(win, { defaultPath: path.basename(name) })
      if (picked.canceled || !picked.filePath) return { saved: false, reason: 'cancelled' }
      try {
        const body = Buffer.from(o.eol === 'lf' ? text : text.replace(/\n/g, o.eol === 'crlf' ? '\r\n' : '\r'), 'utf8')
        await fs.promises.writeFile(picked.filePath, o.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body)
        return { saved: true, path: picked.filePath }
      } catch (err) {
        return { saved: false, reason: 'error', message: (err as Error).message }
      }
    })
    // Drafts: the changes of a file not yet saved, kept for the next start. The interface names a root; the folder that was opened (its path) is what keeps them apart.
    const rootPathOf = (id: string): string | null => {
      const root = this.roots.info(id)
      return root && !root.trash ? root.path : null
    }
    handle('fb:draft-put', (_win, id: unknown, name: unknown, draft: unknown): boolean => {
      const d = draft as { kind?: unknown; text?: unknown; bytes?: unknown; base?: unknown; eol?: unknown; bom?: unknown } | null
      const rootPath = short(id) ? rootPathOf(id) : null
      if (!rootPath || !short(name) || !d || !version(d.base)) return false
      const at = new Date().toISOString()
      if (d.kind === 'text' && typeof d.text === 'string' && d.text.length <= DRAFT_LIMIT && ending(d.eol) && typeof d.bom === 'boolean') return this.drafts.put({ version: 1, rootPath, path: name, kind: 'text', text: d.text, base: d.base, eol: d.eol, bom: d.bom, at })
      if (d.kind === 'bytes' && d.bytes instanceof Uint8Array && d.bytes.length <= DRAFT_LIMIT) return this.drafts.put({ version: 1, rootPath, path: name, kind: 'bytes', bytes: d.bytes, base: d.base, at })
      return false
    })
    handle('fb:draft-get', (_win, id: unknown, name: unknown) => {
      const rootPath = short(id) ? rootPathOf(id) : null
      return rootPath && short(name) ? this.drafts.get(rootPath, name) : null
    })
    handle('fb:draft-delete', (_win, id: unknown, name: unknown): void => {
      const rootPath = short(id) ? rootPathOf(id) : null
      if (rootPath && short(name)) this.drafts.delete(rootPath, name)
    })
    handle('fb:draft-clear', (): void => this.drafts.clear())
    handle('fb:draft-list', () => this.drafts.list().map(({ rootPath, path: name, kind, at }) => ({ rootPath, path: name, kind, at })))
    handle('fb:fs-copy', (_win, id: unknown, name: unknown, to: unknown): Promise<OpResult> | OpResult => (short(id) && short(name) && short(to) ? this.roots.copy(id, name, to) : { ok: false, error: 'not-found' }))
    handle('fb:fs-remove', (_win, id: unknown, name: unknown, how: unknown): Promise<OpResult> | OpResult =>
      short(id) && short(name) && (how === 'trash' || how === 'forever') ? this.roots.remove(id, name, how, (file) => shell.trashItem(file)) : { ok: false, error: 'not-found' })
    handle('fb:doc-open', (_win, id: unknown, name: unknown): Promise<DocOpen> | DocOpen => (typeof id === 'string' && typeof name === 'string' ? this.openDoc(id, name) : { error: 'no-file' }))
    handle('fb:doc-release', (_win, token: unknown) => (typeof token === 'string' ? this.docs.release(token) : undefined))
    handle('fb:media-release', (_win, token: unknown) => (typeof token === 'string' ? this.releaseMedia(token) : undefined))
    handle('fb:open-default', (_win, id: unknown, name: unknown): Promise<OpenWithResult> | OpenWithResult => (typeof id === 'string' && typeof name === 'string' ? this.openDefault(id, name) : { opened: false, reason: 'no-file' }))
    handle('fb:open-with-app', (_win, token: unknown, appId: unknown, always: unknown): Promise<OpenWithResult> | OpenWithResult => (typeof token === 'string' && typeof appId === 'string' ? this.openWithApp(token, appId, always === true) : { opened: false, reason: 'no-file' }))
    handle('fb:open-with-cancel', (_win, token: unknown) => (typeof token === 'string' ? this.openWithCancel(token) : undefined))
    handle('fb:reveal', async (_win, id: unknown, name: unknown) => {
      if (typeof id !== 'string') return
      if (this.roots.has(id)) {
        const file = await this.roots.diskPath(id, typeof name === 'string' ? name : '')
        shell.showItemInFolder(file ?? this.roots.info(id)!.path)
        return
      }
      const snapshot = this.registry.get(id)
      if (snapshot) shell.showItemInFolder(snapshot.path)
    })
    handle('fb:signers-list', () => Object.fromEntries(Object.entries(this.signers.list()).map(([fingerprint, s]) => [fingerprint, { name: s.name }])))
    handle('fb:signers-trust', (_win, fingerprint: unknown, name: unknown) => {
      if (typeof fingerprint === 'string') this.signers.trust(fingerprint, typeof name === 'string' ? name : undefined)
    })
    handle('fb:signers-forget', (_win, fingerprint: unknown) => {
      if (typeof fingerprint === 'string') this.signers.forget(fingerprint)
    })
    handle('fb:app-info', (): AppInfo => {
      // The licence and the notices are files of the installation (resources/), or of the repository when it runs from source.
      const read = (file: string) => {
        try {
          return fs.readFileSync(path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), file), 'utf8').slice(0, 4 * 2 ** 20)
        } catch {
          return ''
        }
      }
      return { name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch, licence: read(app.isPackaged ? 'LICENSE.md' : 'LICENSE'), notices: read('THIRD-PARTY-NOTICES.md') }
    })
    handle('fb:session-load', () => this.session.load())
    handle('fb:session-save', (_win, value: unknown) => this.session.save(value))
    registerPlacesIpc(handle, { roots: this.roots, favorites: this.favorites, recentFolders: this.recentFolders, openRoot: (target, options) => this.openRoot(target, options) })
    handle('fb:recent-list', () => this.recent.list())
    handle('fb:recent-clear', () => this.recent.clear())
  }
}
