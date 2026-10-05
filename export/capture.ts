import { BrowserWindow, type WebContents } from 'electron'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const log = (...parts: unknown[]): void => {
  if (process.env.WSNP_DEBUG) console.error('[capture]', ...parts)
}

export interface CaptureOptions {
  /** CSS width to lay the page out at. */
  width: number
  /** CSS height of the window the page thinks it has (default 800). */
  viewportHeight?: number
  /** Device pixel ratio (default 1). */
  scale?: number
  format?: 'png' | 'jpeg'
  /** JPEG quality, 1–100 (default 85). */
  quality?: number
  /** Height of one screenshot, in CSS px (default 4096). */
  stripPx?: number
  /** Tallest single image, in device px; a taller page is split into numbered parts (default 16384). */
  maxPartPx?: number
  /** Called with each part's canvas before it is encoded, to inspect pixels. */
  onPart?: (stitcher: Stitcher, part: { index: number; y: number; height: number }) => Promise<void>
}

export interface CapturedImage {
  bytes: Buffer
  /** In device pixels. */
  width: number
  height: number
}

export interface CaptureReport {
  parts: CapturedImage[]
  strips: number
  cssWidth: number
  cssHeight: number
  ms: number
}

/**
 * Joins screenshots in a canvas that lives in a hidden renderer, so no image library is needed:
 * Chromium's own `OffscreenCanvas` draws, samples and encodes.
 */
export class Stitcher {
  private readonly win: BrowserWindow

  private constructor(win: BrowserWindow) {
    this.win = win
  }

  static async create(): Promise<Stitcher> {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
    await win.loadURL('about:blank')
    return new Stitcher(win)
  }

  private run<T>(code: string): Promise<T> {
    return this.win.webContents.executeJavaScript(code, false) as Promise<T>
  }

  async begin(width: number, height: number): Promise<void> {
    await this.run(`(() => { window.__c = new OffscreenCanvas(${width}, ${height}); window.__x = window.__c.getContext('2d'); return true })()`)
  }

  async draw(base64: string, y: number): Promise<void> {
    await this.run(`(async () => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,${base64}')).blob());
      window.__x.drawImage(bmp, 0, ${y}); bmp.close(); return true })()`)
  }

  /** The RGBA of pixels of the canvas. */
  sample(points: { x: number; y: number }[]): Promise<number[][]> {
    return this.run(`${JSON.stringify(points)}.map(({ x, y }) => Array.from(window.__x.getImageData(x, y, 1, 1).data))`)
  }

  async finish(format: 'png' | 'jpeg', quality: number): Promise<Buffer> {
    const b64 = await this.run<string>(`(async () => {
      const blob = await window.__c.convertToBlob({ type: 'image/${format}', quality: ${quality / 100} });
      const url = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob) });
      return url.slice(url.indexOf(',') + 1) })()`)
    return Buffer.from(b64, 'base64')
  }

  /** Decodes an encoded image and reads pixels of it (checks what was really written). */
  async inspect(bytes: Buffer, format: 'png' | 'jpeg', points: { x: number; y: number }[]): Promise<{ width: number; height: number; pixels: number[][] }> {
    return this.run(`(async () => {
      const bmp = await createImageBitmap(await (await fetch('data:image/${format};base64,${bytes.toString('base64')}')).blob());
      const c = new OffscreenCanvas(1, 1), x = c.getContext('2d', { willReadFrequently: true });
      const pixels = ${JSON.stringify(points)}.map(({ x: px, y: py }) => { x.clearRect(0, 0, 1, 1); x.drawImage(bmp, px, py, 1, 1, 0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data) });
      return { width: bmp.width, height: bmp.height, pixels } })()`)
  }

  /** Scales an image down to at most `maxWidth` px wide (the preview of a .wsnp). */
  async shrink(bytes: Buffer, maxWidth: number, quality: number): Promise<Buffer> {
    const b64 = await this.run<string>(`(async () => {
      const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,${bytes.toString('base64')}')).blob());
      const w = Math.min(bmp.width, ${maxWidth}), h = Math.round(bmp.height * w / bmp.width);
      const c = new OffscreenCanvas(w, h); c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: ${quality / 100} });
      const url = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob) });
      return url.slice(url.indexOf(',') + 1) })()`)
    return Buffer.from(b64, 'base64')
  }

  close(): void {
    this.win.destroy()
  }
}

/** Lays the page out at the requested size and waits for fonts and a moment of quiet. */
async function prepare(wc: WebContents, options: CaptureOptions): Promise<void> {
  log('prepare: set metrics')
  await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: options.width,
    height: options.viewportHeight ?? 800,
    deviceScaleFactor: options.scale ?? 1,
    mobile: false,
  })
  log('prepare: fonts')
  await wc.debugger.sendCommand('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })
  await wait(250)
  log('prepare: done')
}

function withDebugger<T>(wc: WebContents, work: () => Promise<T>): Promise<T> {
  const attached = wc.debugger.isAttached()
  if (!attached) wc.debugger.attach('1.3')
  return work().finally(async () => {
    await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => {})
    if (!attached) wc.debugger.detach()
  })
}

/**
 * The whole page as one image (or, if it is taller than `maxPartPx`, as numbered parts): the page
 * is photographed in strips beyond the window, joined in a canvas, and encoded.
 */
export function captureFullPage(wc: WebContents, stitcher: Stitcher, options: CaptureOptions): Promise<CaptureReport> {
  return withDebugger(wc, async () => {
    const started = Date.now()
    const scale = options.scale ?? 1
    const format = options.format ?? 'png'
    const stripCss = options.stripPx ?? 4096
    const partCss = Math.max(1, Math.floor((options.maxPartPx ?? 16384) / scale))
    await prepare(wc, options)
    const metrics = (await wc.debugger.sendCommand('Page.getLayoutMetrics')) as { cssContentSize: { width: number; height: number } }
    const cssWidth = Math.ceil(metrics.cssContentSize.width)
    const cssHeight = Math.ceil(metrics.cssContentSize.height)

    const parts: CapturedImage[] = []
    let strips = 0
    for (let y0 = 0, index = 0; y0 < cssHeight; y0 += partCss, index++) {
      const partHeight = Math.min(partCss, cssHeight - y0)
      await stitcher.begin(Math.round(cssWidth * scale), Math.round(partHeight * scale))
      for (let y = 0; y < partHeight; y += stripCss) {
        const height = Math.min(stripCss, partHeight - y)
        log('strip', y0 + y, height)
        const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: y0 + y, width: cssWidth, height, scale: 1 },
        })) as { data: string }
        await stitcher.draw(shot.data, Math.round(y * scale))
        strips++
      }
      await options.onPart?.(stitcher, { index, y: y0, height: partHeight })
      parts.push({
        bytes: await stitcher.finish(format, options.quality ?? 85),
        width: Math.round(cssWidth * scale),
        height: Math.round(partHeight * scale),
      })
    }
    return { parts, strips, cssWidth, cssHeight, ms: Date.now() - started }
  })
}

/** What the window shows (`viewportHeight` tall): a JPEG, for the preview of a .wsnp. */
export function captureVisible(wc: WebContents, options: CaptureOptions): Promise<Buffer> {
  return withDebugger(wc, async () => {
    await prepare(wc, options)
    const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: options.quality ?? 85, fromSurface: true })) as { data: string }
    return Buffer.from(shot.data, 'base64')
  })
}

/** Width and height of a JPEG, read from its start-of-frame marker. */
export function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }
    i += 2 + bytes.readUInt16BE(i + 2)
  }
  return null
}

/** Tries to photograph `heights` (CSS px) of the page in ONE screenshot, to learn where the browser gives up. */
export function probeSingleShot(wc: WebContents, options: CaptureOptions, heights: number[]): Promise<{ height: number; ok: boolean; bytes?: number; got?: string; ms: number; error?: string }[]> {
  return withDebugger(wc, async () => {
    await prepare(wc, options)
    const results: { height: number; ok: boolean; bytes?: number; got?: string; ms: number; error?: string }[] = []
    for (const height of heights) {
      const started = Date.now()
      try {
        const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 50,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: options.width, height, scale: 1 },
        })) as { data: string }
        const size = jpegSize(Buffer.from(shot.data, 'base64'))
        results.push({ height, ok: true, bytes: Math.round((shot.data.length * 3) / 4), got: size ? `${size.width}x${size.height}` : 'unknown', ms: Date.now() - started })
      } catch (err) {
        results.push({ height, ok: false, ms: Date.now() - started, error: (err as Error).message })
      }
    }
    return results
  })
}
