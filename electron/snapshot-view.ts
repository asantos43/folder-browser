import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { BaseWindow, protocol, session, WebContentsView } from 'electron'
import { openArchive, type Archive } from '../core/archive/reader.ts'
import { serveEntry } from '../core/serve.ts'

export const SCHEME = 'wsnp'
/** The interface's own scheme (phase 1 spike): the page that holds the snapshots' iframes. */
export const UI_SCHEME = 'fb-ui'
/** The address of a video or a sound the interface is playing: `fb-media://<token>/` (core/media.ts). */
export const MEDIA_SCHEME = 'fb-media'

/** Must run before the app is ready. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
    // The interface fetches its own data files (pdf.js's fonts and character maps) from its own origin.
    { scheme: UI_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    // A video or a sound is read by ranges (to seek), and streamed.
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ])
}

export interface SnapshotViewOptions {
  /** The file to load instead of the manifest's page (an HTML file of the snapshot, to print or save as PDF). */
  entry?: string
  /** Serve with the `sandbox allow-scripts` CSP directive (opaque origin). */
  sandbox?: boolean
  /** Overrides the policy (an empty string sends none). Only for tests of the layers below the policy. */
  csp?: string
  /** Called with a web link the user clicked. It is never called for a page's own navigation. */
  openExternal: (url: string) => void
  /** The size of the (hidden) window the view lives in. */
  width?: number
  height?: number
  /** Show the window (the prototype never does). */
  show?: boolean
  /** Render offscreen, so a hidden view still paints frames (needed to photograph it). */
  offscreen?: boolean
}

interface Manifest {
  pages?: { entry?: string }[]
  files?: { path: string; media_type?: string }[]
  source?: { url?: string }
  title?: string
  viewport?: { width: number; height: number; device_pixel_ratio: number }
}

/** How long after a pointer press a navigation still counts as the user's click. */
const CLICK_WINDOW_MS = 1500

/**
 * One open snapshot: its archive, its own in-memory session with the `wsnp://` protocol bound to
 * it, and a view that can reach nothing else. Requests below the page are cancelled, not just
 * forbidden by the policy.
 */
export class SnapshotView {
  readonly id = `s${crypto.randomBytes(8).toString('hex')}`
  readonly blocked: string[] = []
  readonly external: string[] = []
  readonly console: string[] = []
  readonly failedLoads: string[] = []
  /** Requests that failed after being allowed (a network error code and the address). */
  readonly requestErrors: string[] = []
  readonly window: BaseWindow
  readonly view: WebContentsView
  manifest: Manifest = {}
  private lastPointer = 0

  readonly archive: Archive
  private readonly options: SnapshotViewOptions

  private constructor(archive: Archive, options: SnapshotViewOptions) {
    this.archive = archive
    this.options = options
    const partition = `snapshot-${this.id}` // no "persist:" prefix: nothing is kept on disk
    const ses = session.fromPartition(partition)
    this.window = new BaseWindow({ show: options.show ?? false, width: options.width ?? 1280, height: options.height ?? 800 })
    this.view = new WebContentsView({
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, offscreen: options.offscreen ?? false },
    })
    this.window.contentView.addChildView(this.view)
    this.view.setBounds({ x: 0, y: 0, width: options.width ?? 1280, height: options.height ?? 800 })
    this.guardSession(ses)
    this.guardNavigation()
  }

  get origin(): string {
    return `${SCHEME}://${this.id}`
  }

  get webContents() {
    return this.view.webContents
  }

  static async open(path: string, options: SnapshotViewOptions): Promise<SnapshotView> {
    const archive = await openArchive(path)
    const snapshot = new SnapshotView(archive, options)
    try {
      snapshot.manifest = JSON.parse((await archive.read('manifest.json')).toString('utf8')) as Manifest
    } catch {
      snapshot.manifest = {}
    }
    snapshot.bindProtocol()
    await snapshot.load()
    return snapshot
  }

  /** Loads the page and resolves when the load has finished (or failed: see `failedLoads`). */
  async load(): Promise<void> {
    const entry = this.options.entry ?? this.manifest.pages?.[0]?.entry ?? 'index.html'
    const wc = this.webContents
    const done = new Promise<void>((resolve) => wc.once('did-stop-loading', () => resolve()))
    await wc.loadURL(`${this.origin}/${entry}`).catch((err: Error) => this.failedLoads.push(err.message))
    await done
  }

  private bindProtocol(): void {
    const types = new Map((this.manifest.files ?? []).filter((f) => f.media_type).map((f) => [f.path, f.media_type as string]))
    const entry = this.manifest.pages?.[0]?.entry
    session.fromPartition(`snapshot-${this.id}`).protocol.handle(SCHEME, async (request) => {
      const url = new URL(request.url)
      // A snapshot may only read itself: another snapshot's host is refused.
      if (url.hostname !== this.id) return new Response(null, { status: 403 })
      const res = await serveEntry(this.archive, url.pathname, { range: request.headers.get('range') }, { types, entry, sandbox: this.options.sandbox, csp: this.options.csp })
      const body: BodyInit | null = res.body instanceof Readable ? (Readable.toWeb(res.body) as ReadableStream) : res.body ? new Uint8Array(res.body) : null
      return new Response(body, { status: res.status, headers: res.headers })
    })
  }

  private guardSession(ses: Electron.Session): void {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const own = details.url.startsWith(`${this.origin}/`)
      const inline = /^(data|blob):/.test(details.url)
      if (own || inline) return callback({})
      this.blocked.push(`${details.resourceType} ${details.url}`)
      callback({ cancel: true })
    })
    ses.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
      if (!details.url.startsWith(`${this.origin}/`) || details.error !== 'net::ERR_BLOCKED_BY_CLIENT') this.requestErrors.push(`${details.error} ${details.url}`)
    })
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
  }

  private guardNavigation(): void {
    const wc = this.webContents
    wc.on('console-message', (event) => this.console.push(`${event.level}: ${event.message}`))
    wc.on('did-fail-load', (_e, code, description, url) => this.failedLoads.push(`${code} ${description} ${url}`))
    // A real pointer press marks the next navigation as the user's click.
    wc.on('input-event', (_e, input) => {
      if (input.type === 'mouseDown' || input.type === 'mouseUp') this.lastPointer = Date.now()
    })
    const handle = (url: string, event?: Electron.Event) => {
      if (url.startsWith(`${this.origin}/`)) return
      event?.preventDefault()
      const clicked = Date.now() - this.lastPointer < CLICK_WINDOW_MS
      if (clicked && /^(https?|mailto):/.test(url)) {
        this.external.push(url)
        this.options.openExternal(url)
      } else {
        this.blocked.push(`navigation ${url}`)
      }
    }
    wc.on('will-frame-navigate', (event) => handle(event.url, event))
    wc.on('will-redirect', (event) => handle(event.url, event))
    wc.setWindowOpenHandler(({ url }) => {
      handle(url)
      return { action: 'deny' }
    })
  }

  async close(): Promise<void> {
    this.window.contentView.removeChildView(this.view)
    this.view.webContents.close()
    this.window.close()
    await this.archive.close()
  }
}
