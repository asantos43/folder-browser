import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { formatBytes } from '@/lib/format.ts'
import { SaveButton, Separator, Toolbar, ZoomControls } from './Toolbar.tsx'
import { viewZoom } from '@/state/viewZoom.ts'
import { keepState, keptState, useSize } from './useViewport.ts'
import { anchoredScroll, IMAGE_LIMITS, resolveScale, stepZoom, wheelZoom, type ZoomMode } from './zoom.ts'

/**
 * A picture of the snapshot, with a toolbar: zoom out and in, a box for fit and percentages, actual size, Save As. Ctrl and the
 * wheel zoom around the pointer, `+` `-` `0` zoom from the keyboard, and a zoomed picture is dragged to move it.
 */
export function ImageView({ id, bytes, mediaType, name, onSave, leading }: { id: string; bytes: Uint8Array; mediaType: string; name: string; onSave: () => void; /** Buttons at the start of the toolbar (the SVG's switch to its source). */ leading?: ReactNode }) {
  const { t } = useI18n()
  const url = useMemo(() => URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType })), [bytes, mediaType])
  const [natural, setNatural] = useState<{ width: number; height: number } | 'broken' | null>(null)
  const [mode, setMode] = useState<ZoomMode>(() => keptState(`zoom:${id}`, 'auto'))
  const scroller = useRef<HTMLDivElement>(null)
  const room = useSize(scroller)
  const anchor = useRef<{ x: number; y: number; ratio: number } | null>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  useEffect(() => () => URL.revokeObjectURL(url), [url])
  useEffect(() => keepState(`zoom:${id}`, mode), [id, mode])
  // The keys of the workbench (Ctrl+=, Ctrl+-, Ctrl+0) zoom this picture while it is shown.
  useEffect(() => viewZoom.set({ step: (direction) => zoomTo(stepZoom(scale, direction, IMAGE_LIMITS)), reset: () => setMode('auto') }))

  const dims = typeof natural === 'object' && natural !== null ? natural : null
  const size = dims ?? { width: 0, height: 0 }
  const scale = resolveScale(mode, size, room, IMAGE_LIMITS, 16)

  // After a zoom around the pointer, the point that was under it is under it still.
  useLayoutEffect(() => {
    const a = anchor.current
    const el = scroller.current
    if (!a || !el) return
    el.scrollLeft = anchoredScroll(el.scrollLeft, a.x, a.ratio)
    el.scrollTop = anchoredScroll(el.scrollTop, a.y, a.ratio)
    anchor.current = null
  }, [scale])

  const zoomTo = (next: number, at?: { x: number; y: number }) => {
    const el = scroller.current
    if (el && next !== scale) anchor.current = { x: at?.x ?? el.clientWidth / 2, y: at?.y ?? el.clientHeight / 2, ratio: next / scale }
    setMode(next)
  }
  const step = (direction: 1 | -1) => zoomTo(stepZoom(scale, direction, IMAGE_LIMITS))

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    const box = e.currentTarget.getBoundingClientRect()
    zoomTo(wheelZoom(scale, e.deltaY, IMAGE_LIMITS), { x: e.clientX - box.left, y: e.clientY - box.top })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === '+' || e.key === '=') step(1)
    else if (e.key === '-') step(-1)
    else if (e.key === '0') setMode(1)
    else return
    e.preventDefault()
  }
  const onPointerDown = (e: PointerEvent) => {
    const el = scroller.current
    if (!el || e.button !== 0 || (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)) return
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    const el = scroller.current
    if (!d || !el) return
    el.scrollLeft = d.left - (e.clientX - d.x)
    el.scrollTop = d.top - (e.clientY - d.y)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        {leading}
        <ZoomControls mode={mode} scale={scale} onMode={(m) => (typeof m === 'number' ? zoomTo(m) : setMode(m))} onStep={step} />
        <Separator />
        <SaveButton label={t('file.saveAs')} onClick={onSave} />
      </Toolbar>
      {/* The chequered ground shows what is transparent; `margin: auto` on the picture centres it and still lets a large one scroll. */}
      <div
        ref={scroller}
        tabIndex={0}
        aria-label={name}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        className="flex min-h-0 flex-1 overflow-auto bg-[repeating-conic-gradient(var(--vscode-editorGroup-border)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] outline-none"
      >
        {natural === 'broken' ? (
          <p className="m-auto rounded bg-editor p-3 text-fg-muted">{t('file.imageBroken')}</p>
        ) : (
          <img
            src={url}
            alt={name}
            draggable={false}
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onError={() => setNatural('broken')}
            // Until its size is known the picture is loaded out of sight: shown at its own size first, it would flash, large, before it is fitted.
            style={dims ? { width: dims.width * scale, height: dims.height * scale, imageRendering: scale >= 3 ? 'pixelated' : 'auto' } : { position: 'absolute', width: 1, height: 1, opacity: 0 }}
            className="m-auto block max-w-none shrink-0"
          />
        )}
      </div>
      {dims ? <p className="m-0 shrink-0 bg-editor px-3 py-1 text-[12px] text-fg-muted">{t('file.image', { width: dims.width, height: dims.height, size: formatBytes(bytes.length) })}</p> : null}
    </div>
  )
}
