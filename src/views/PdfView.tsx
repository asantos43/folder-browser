import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject, type WheelEvent } from 'react'
import { createPdfFindTarget } from '@/find/pdf.ts'
import { fileTarget } from '@/find/types.ts'
import { viewZoom } from '@/state/viewZoom.ts'
import { useI18n } from '@/i18n/context.tsx'
import { SaveButton, Separator, Toolbar, ToolbarButton, ZoomControls } from './Toolbar.tsx'
import { keepState, keptState, useSize } from './useViewport.ts'
import { PDF_LIMITS, resolveScale, stepZoom, wheelZoom, type Size, type ZoomMode } from './zoom.ts'
import './pdf.css'

type Pdfjs = typeof import('pdfjs-dist')

const GAP = 8
/** A page is drawn at the screen's pixel density, but never in more pixels than this (a zoomed page would take a gigabyte). */
const MAX_PIXELS = 48_000_000
/** Pages this far (in pixels) from the window are not kept drawn. */
const KEEP_NEAR = 1200

let library: Promise<Pdfjs> | undefined
/** pdf.js, loaded the first time a PDF is shown (it is most of a megabyte). Its worker, fonts and colour data are files of the build. */
function loadPdfjs(): Promise<Pdfjs> {
  library ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    return pdfjs
  })()
  return library
}

type Load = { state: 'loading' } | { state: 'ready'; doc: PDFDocumentProxy; pdfjs: Pdfjs } | { state: 'protected' } | { state: 'broken' }

/** Draws one page when it is near the window, and lets go of it when it is far: a long PDF stays light. */
function PdfPage({ pdfjs, doc, number, size, scale, root }: { pdfjs: Pdfjs; doc: PDFDocumentProxy; number: number; size: Size; scale: number; root: RefObject<HTMLElement | null> }) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    if (!box.current || typeof IntersectionObserver === 'undefined') return setNear(true)
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root.current, rootMargin: `${KEEP_NEAR}px 0px` })
    observer.observe(box.current)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    const target = canvas.current
    const layer = text.current
    if (!target || !layer) return
    if (!near) {
      target.width = 0
      target.height = 0
      layer.replaceChildren()
      return
    }
    let cancelled = false
    let task: RenderTask | undefined
    let textLayer: InstanceType<Pdfjs['TextLayer']> | undefined
    void (async () => {
      const page = await doc.getPage(number)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const out = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / Math.max(1, viewport.width * viewport.height)))
      target.width = Math.floor(viewport.width * out)
      target.height = Math.floor(viewport.height * out)
      target.style.width = `${Math.floor(viewport.width)}px`
      target.style.height = `${Math.floor(viewport.height)}px`
      task = page.render({ canvas: target, viewport, transform: out === 1 ? undefined : [out, 0, 0, out, 0, 0] })
      await task.promise
      if (cancelled) return
      layer.replaceChildren()
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport })
      await textLayer.render()
    })().catch(() => {
      // a render that was cancelled (the page moved or the zoom changed) is not a failure
    })
    return () => {
      cancelled = true
      task?.cancel()
      textLayer?.cancel()
    }
  }, [near, scale, doc, number, pdfjs])

  return (
    <div ref={box} data-page={number} role="img" aria-label={t('pdf.pageLabel', { n: number })} className="relative mx-auto bg-white shadow-[0_0_4px_var(--vscode-widget-shadow)]" style={{ width: Math.floor(size.width * scale), height: Math.floor(size.height * scale), marginBottom: GAP }}>
      <canvas ref={canvas} className="block" />
      <div ref={text} className="textLayer" />
    </div>
  )
}

/**
 * A PDF of the snapshot in a tab, drawn by pdf.js in the interface itself: no plug-in, no script of the PDF runs, and nothing is
 * fetched. A toolbar has zoom (out, in, a box with fit and percentages, actual size), the page (previous, next, go to) and Save As.
 */
export function PdfView({ id, bytes, name, onSave }: { id: string; bytes: Uint8Array; name: string; onSave: () => void }) {
  const { t } = useI18n()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [sizes, setSizes] = useState<Size[]>([])
  const [mode, setMode] = useState<ZoomMode>(() => keptState(`zoom:${id}`, 'auto'))
  const [current, setCurrent] = useState(1)
  const [typed, setTyped] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const room = useSize(scroller)
  const keep = useRef<number | null>(null)

  useEffect(() => keepState(`zoom:${id}`, mode), [id, mode])

  // Load the document, and then the size of every page in the background (the first page is enough to start).
  useEffect(() => {
    let alive = true
    let task: { destroy: () => Promise<void> } | undefined
    setLoad({ state: 'loading' })
    setSizes([])
    void (async () => {
      const pdfjs = await loadPdfjs()
      const origin = `${location.origin}/pdfjs/`
      const loading = pdfjs.getDocument({
        data: bytes.slice(),
        cMapUrl: `${origin}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${origin}standard_fonts/`,
        iccUrl: `${origin}iccs/`,
        wasmUrl: `${origin}wasm/`,
        // Nothing of the PDF runs or is fetched: no scripts (pdf.js runs them only when given a scripting object), no forms.
        enableXfa: false,
        useSystemFonts: false,
        disableAutoFetch: true,
      })
      task = loading
      const doc = await loading.promise
      if (!alive) return
      const first = await doc.getPage(1)
      const view = first.getViewport({ scale: 1 })
      setLoad({ state: 'ready', doc, pdfjs })
      const all: Size[] = [{ width: view.width, height: view.height }]
      setSizes(all)
      for (let n = 2; n <= doc.numPages && alive; n++) {
        const v = (await doc.getPage(n)).getViewport({ scale: 1 })
        all.push({ width: v.width, height: v.height })
        if (n % 25 === 0 || n === doc.numPages) setSizes([...all])
      }
    })().catch((err: unknown) => alive && setLoad({ state: (err as { name?: string })?.name === 'PasswordException' ? 'protected' : 'broken' }))
    return () => {
      alive = false
      void task?.destroy().catch(() => {})
    }
  }, [bytes])

  const pages = load.state === 'ready' ? load.doc.numPages : 0
  const sizeOf = (n: number): Size => sizes[n - 1] ?? sizes[0] ?? { width: 612, height: 792 }
  const widest = sizes.reduce((w, s) => Math.max(w, s.width), sizes[0]?.width ?? 612)
  const scale = resolveScale(mode, mode === 'fit-page' ? sizeOf(current) : { width: widest, height: sizeOf(current).height }, room, PDF_LIMITS, 16)

  // The page being read stays where it is when the zoom changes.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && keep.current !== null) el.scrollTop = keep.current * el.scrollHeight
    keep.current = null
  }, [scale])
  const setZoom = (next: ZoomMode) => {
    const el = scroller.current
    if (el && el.scrollHeight) keep.current = el.scrollTop / el.scrollHeight
    setMode(next)
  }
  const step = (direction: 1 | -1) => setZoom(stepZoom(scale, direction, PDF_LIMITS))
  // The keys of the workbench (Ctrl+=, Ctrl+-, Ctrl+0) zoom this PDF while it is shown.
  useEffect(() => viewZoom.set({ step, reset: () => setZoom('auto') }))

  const goTo = useCallback((n: number) => {
    const el = scroller.current
    const page = el?.querySelector<HTMLElement>(`[data-page="${n}"]`)
    if (el && page) el.scrollTo({ top: page.offsetTop - GAP })
  }, [])

  // Find and Copy of the workbench act on this PDF while it is shown.
  const currentNow = useRef(current)
  currentNow.current = current
  useEffect(() => {
    if (load.state !== 'ready') return
    return fileTarget.set(createPdfFindTarget(load.doc, () => scroller.current, goTo, () => currentNow.current))
  }, [load, goTo])

  // The current page is the one across the top third of the window.
  const pending = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(pending.current)
    pending.current = requestAnimationFrame(() => {
      const el = scroller.current
      if (!el) return
      const line = el.scrollTop + el.clientHeight / 3
      const all = [...el.querySelectorAll<HTMLElement>('[data-page]')]
      const hit = all.find((p) => p.offsetTop + p.offsetHeight >= line) ?? all.at(-1)
      if (hit) setCurrent(Number(hit.dataset.page))
    })
  }
  useEffect(() => () => cancelAnimationFrame(pending.current), [])

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) setZoom(wheelZoom(scale, e.deltaY, PDF_LIMITS))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === '+' || e.key === '=') step(1)
    else if (e.key === '-') step(-1)
    else if (e.key === '0') setZoom(1)
    else return
    e.preventDefault()
  }
  const commitPage = () => {
    const n = Math.min(pages, Math.max(1, Math.round(Number(typed))))
    if (typed !== null && Number.isFinite(n) && typed.trim() !== '') goTo(n)
    setTyped(null)
  }

  const failed = load.state === 'protected' || load.state === 'broken'
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        <ZoomControls mode={mode} scale={scale} onMode={(m) => setZoom(m)} onStep={step} />
        <Separator />
        <ToolbarButton icon="chevron-up" label={t('pdf.previous')} onClick={() => goTo(Math.max(1, current - 1))} disabled={!pages || current <= 1} />
        <input
          aria-label={t('pdf.page')}
          inputMode="numeric"
          disabled={!pages}
          value={typed ?? (pages ? String(current) : '')}
          onChange={(e) => setTyped(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => setTyped(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitPage()
            if (e.key === 'Escape') setTyped(null)
          }}
          className="h-[24px] w-10 rounded-sm border border-group-border bg-editor px-1 text-center text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus"
        />
        <span className="text-fg-muted">{t('pdf.of', { total: pages })}</span>
        <ToolbarButton icon="chevron-down" label={t('pdf.next')} onClick={() => goTo(Math.min(pages, current + 1))} disabled={!pages || current >= pages} />
        <Separator />
        <SaveButton label={t('file.saveAs')} onClick={onSave} />
      </Toolbar>
      <div ref={scroller} tabIndex={0} aria-label={name} onScroll={onScroll} onWheel={onWheel} onKeyDown={onKeyDown} className="relative min-h-0 flex-1 overflow-auto bg-sidebar p-4 outline-none">
        {load.state === 'loading' ? <p className="m-0 text-fg-muted">{t('pdf.loading')}</p> : null}
        {failed ? <p className="m-0 text-fg-muted">{t(load.state === 'protected' ? 'pdf.protected' : 'pdf.broken')}</p> : null}
        {load.state === 'ready'
          ? Array.from({ length: pages }, (_, i) => <PdfPage key={i} pdfjs={load.pdfjs} doc={load.doc} number={i + 1} size={sizeOf(i + 1)} scale={scale} root={scroller} />)
          : null}
      </div>
    </div>
  )
}
