import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Icon } from './Icon.tsx'

export type MenuEntry =
  | { separator: true }
  | { id: string; label: string; shortcut?: string; disabled?: boolean; checked?: boolean; run?: () => void; submenu?: MenuEntry[] }

export const isSeparator = (entry: MenuEntry): entry is { separator: true } => 'separator' in entry

/**
 * A drop-down list in VS Code's style: arrows move, Enter runs, Esc closes, Right opens a submenu and Left goes back. Plain HTML, so it can sit
 * over a page. One item at a time is lit, the one the pointer is over or the keys are on (never both, as two lit items would be): a menu opened
 * with the mouse has none lit until the pointer or an arrow key picks one; `autoSelect` (a menu opened from the keyboard) lights the first.
 */
export function MenuList({ entries, label, onClose, onSide, onBack, autoSelect = false }: { entries: MenuEntry[]; label: string; onClose: () => void; onSide?: (direction: -1 | 1) => void; onBack?: () => void; autoSelect?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState<{ id: string; keyboard: boolean } | null>(null)
  const [active, setActive] = useState<number | null>(autoSelect ? 0 : null)
  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > div > button[role^="menuitem"]:not(:disabled)') ?? [])]

  // The focus is on the menu itself until an item is lit, so Enter never runs an item nobody can see as chosen.
  useEffect(() => {
    if (active === null) ref.current?.focus()
    else items()[active]?.focus()
  }, [active])

  const onKeyDown = (event: KeyboardEvent) => {
    const list = items()
    const entry = active === null ? undefined : entries.find((e) => !isSeparator(e) && e.id === list[active]?.dataset.id)
    if (event.key === 'ArrowDown') setActive(active === null ? 0 : (active + 1) % list.length)
    else if (event.key === 'ArrowUp') setActive(active === null ? list.length - 1 : (active - 1 + list.length) % list.length)
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(list.length - 1)
    else if (event.key === 'ArrowRight' && entry && !isSeparator(entry) && entry.submenu) setSub({ id: entry.id, keyboard: true })
    else if (event.key === 'ArrowRight' && onSide) onSide(1)
    else if (event.key === 'ArrowLeft' && onBack) onBack()
    else if (event.key === 'ArrowLeft' && onSide) onSide(-1)
    else if (event.key === 'Escape') onClose()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  let enabledIndex = -1
  return (
    <div ref={ref} role="menu" tabIndex={-1} aria-label={label} onKeyDown={onKeyDown} className="no-drag min-w-[260px] rounded-md border border-menu-border bg-menu py-1.5 text-menu-fg shadow-[0_4px_16px_var(--vscode-widget-shadow)] outline-none">
      {entries.map((entry, i) => {
        if (isSeparator(entry)) return <div key={`s${i}`} role="separator" className="mx-3 my-1.5 h-px bg-menu-separator" />
        const mine = entry.disabled ? -1 : ++enabledIndex
        return (
          <div key={entry.id} className="relative">
            <button
              type="button"
              data-id={entry.id}
              data-active={mine >= 0 && mine === active}
              role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={entry.checked}
              aria-haspopup={entry.submenu ? 'menu' : undefined}
              aria-expanded={entry.submenu ? sub?.id === entry.id : undefined}
              disabled={entry.disabled}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => {
                if (mine >= 0) setActive(mine)
                setSub(entry.submenu && !entry.disabled ? { id: entry.id, keyboard: false } : null)
              }}
              onClick={() => {
                if (entry.submenu) return setSub({ id: entry.id, keyboard: false })
                onClose()
                entry.run?.()
              }}
              className="mx-1 flex h-[28px] w-[calc(100%-8px)] items-center gap-2 rounded-[4px] px-3 text-left text-[13px] leading-[28px] outline-none data-[active=true]:bg-menu-select data-[active=true]:text-menu-select-fg disabled:opacity-40"
            >
              <span className="flex w-4 shrink-0 justify-center">{entry.checked ? <Icon name="check" /> : null}</span>
              <span className="flex-1 whitespace-nowrap">{entry.label}</span>
              {entry.shortcut ? <span className="ml-10 whitespace-nowrap opacity-70">{entry.shortcut}</span> : null}
              {entry.submenu ? <Icon name="chevron-right" /> : null}
            </button>
            {entry.submenu && sub?.id === entry.id ? (
              <div className="absolute top-[-7px] left-[calc(100%-2px)] z-10">
                <MenuList entries={entry.submenu} label={entry.label} onClose={onClose} onBack={() => setSub(null)} autoSelect={sub.keyboard} />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Calls `onClose` when the user clicks elsewhere, and also when the window loses focus: a click inside a snapshot's
 * iframe never reaches this document, but it takes the focus away.
 */
export function useDismiss(active: boolean, inside: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    if (!active) return
    const down = (e: PointerEvent) => {
      if (!inside.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', down, true)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      window.removeEventListener('blur', onClose)
    }
  }, [active, inside, onClose])
}
