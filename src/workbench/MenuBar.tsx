import { useCallback, useRef, useState } from 'react'
import { useDismiss, MenuList } from '@/components/Menu.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { MENUS, type Commands } from './commands.ts'

/** VS Code's menu bar, drawn in the title bar on Windows and Linux (macOS has the native menu). */
export function MenuBar({ commands }: { commands: Commands }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<number | null>(null)
  // A menu opened from the keyboard (Enter on its name, or the side arrows) has its first item lit; one opened with the mouse has none.
  const [keyboard, setKeyboard] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(null), [])
  useDismiss(open !== null, ref, close)
  const move = (direction: -1 | 1) => {
    setKeyboard(true)
    setOpen((i) => (i === null ? i : (i + direction + MENUS.length) % MENUS.length))
  }

  return (
    <div ref={ref} role="menubar" className="no-drag flex h-full items-center">
      {MENUS.map((menu, i) => (
        <div key={menu.id} className="relative flex h-full items-center">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            // A press on a menu must not take the selection of the view away: Copy acts on it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              setKeyboard(e.detail === 0)
              setOpen(open === i ? null : i)
            }}
            onMouseEnter={() => {
              if (open === null) return
              setKeyboard(false)
              setOpen(i)
            }}
            className={`h-[24px] rounded-md px-2.5 text-[13px] leading-[24px] hover:bg-toolbar-hover ${open === i ? 'bg-toolbar-hover' : ''}`}
          >
            {t(menu.label)}
          </button>
          {open === i ? (
            <div className="absolute top-full left-0 z-50 mt-[-2px]">
              <MenuList key={`${menu.id}${keyboard}`} entries={menu.entries(t, commands)} label={t(menu.label)} onClose={close} onSide={move} autoSelect={keyboard} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
