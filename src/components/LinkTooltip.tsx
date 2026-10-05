import { useEffect, useRef, useState } from 'react'

export interface LinkHover {
  link: string
  /** Where the pointer is, in the window's pixels. */
  x: number
  y: number
}

/** How long the pointer rests on a link before its address shows (VS Code's hover waits about as long). */
export const LINK_DELAY = 350

/**
 * The address of the link under the pointer, in the style of VS Code's hover. It shows after a short wait, where the pointer was then, and goes when the pointer
 * leaves the link. It lives in the interface, not in the page: the page is another process, and a tooltip of its own would be one it could style or fill.
 */
export function LinkTooltip({ hover }: { hover: LinkHover | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<LinkHover | null>(null)
  const [at, setAt] = useState({ x: 0, y: 0 })
  useEffect(() => {
    setShown(null)
    if (!hover) return
    const timer = setTimeout(() => setShown(hover), LINK_DELAY)
    return () => clearTimeout(timer)
  }, [hover])
  useEffect(() => {
    if (!shown || !ref.current) return
    const box = ref.current.getBoundingClientRect()
    const below = shown.y + 22
    setAt({
      x: Math.max(4, Math.min(shown.x + 12, window.innerWidth - box.width - 4)),
      y: below + box.height + 4 > window.innerHeight ? Math.max(4, shown.y - box.height - 8) : below,
    })
  }, [shown])
  if (!shown) return null
  return (
    <div
      ref={ref}
      role="tooltip"
      data-testid="link-tooltip"
      className="pointer-events-none fixed z-50 max-w-[min(640px,calc(100vw-8px))] break-all rounded-[3px] border border-menu-border bg-menu px-2 py-1 text-[13px] leading-[18px] text-menu-fg shadow-[0_2px_8px_var(--vscode-widget-shadow)]"
      style={{ left: at.x, top: at.y }}
    >
      {shown.link}
    </div>
  )
}
