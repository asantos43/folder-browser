import { useCallback, useEffect, useRef, useState } from 'react'
import { MenuList, useDismiss, type MenuEntry } from './Menu.tsx'

export interface ContextMenuState {
  x: number
  y: number
  entries: MenuEntry[]
  label: string
}

/** A menu opened by a right click, kept inside the window. */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ x: 0, y: 0 })
  const close = useCallback(() => onClose(), [onClose])
  useDismiss(menu !== null, ref, close)
  useEffect(() => {
    if (!menu || !ref.current) return
    const box = ref.current.getBoundingClientRect()
    setAt({ x: Math.max(0, Math.min(menu.x, window.innerWidth - box.width - 4)), y: Math.max(0, Math.min(menu.y, window.innerHeight - box.height - 4)) })
  }, [menu])
  if (!menu) return null
  return (
    <div ref={ref} className="fixed z-50" style={{ left: at.x, top: at.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList entries={menu.entries} label={menu.label} onClose={close} />
    </div>
  )
}
