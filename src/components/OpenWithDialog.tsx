import type { Chooser, ChooserApp } from '@core/api.ts'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'

/**
 * The "Open With" dialog, drawn by the viewer as GNOME's is (Cancel, the name, Open; a search box; "Recommended Apps" and "Other Apps"; "Always use for this file type"):
 * a program cannot put the desktop's own in front of its window on Wayland. Arrows move, Enter opens, Escape cancels, a double click opens, typing searches.
 */
export function OpenWithDialog({ chooser, onChoose, onCancel }: { chooser: Chooser; onChoose: (appId: string, always: boolean) => void; onCancel: () => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [always, setAlways] = useState(false)
  const [picked, setPicked] = useState(chooser.apps[0]?.id ?? '')
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    search.current?.focus()
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return chooser.apps.filter((a) => !q || a.name.toLowerCase().includes(q))
  }, [chooser, query])
  const recommended = shown.filter((a) => a.recommended)
  const others = shown.filter((a) => !a.recommended)
  // What is picked has to be one that is shown: the first, when a search leaves the choice out.
  const current = shown.some((a) => a.id === picked) ? picked : (shown[0]?.id ?? '')
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const move = (by: number) => {
    const at = shown.findIndex((a) => a.id === current)
    const next = shown[Math.max(0, Math.min(shown.length - 1, at + by))]
    if (next) setPicked(next.id)
  }
  const open = () => current && onChoose(current, always)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onCancel()
    else if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'Enter') open()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const row = (app: ChooserApp) => (
    <div
      key={app.id}
      role="option"
      aria-selected={app.id === current}
      onClick={() => setPicked(app.id)}
      onDoubleClick={() => onChoose(app.id, always)}
      className={`mx-1 flex h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 ${app.id === current ? 'bg-list-active text-list-active-fg' : 'hover:bg-list-hover'}`}
    >
      {app.iconUrl ? <img src={app.iconUrl} alt="" className="h-8 w-8 shrink-0 object-contain" /> : <Icon name="extensions" className="w-8 shrink-0 text-center text-[24px]" />}
      <span className="truncate">{app.name}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-label={t('openWith.title')} onKeyDown={onKeyDown} className="flex max-h-[84vh] w-[min(440px,calc(100vw-32px))] flex-col gap-3 rounded-xl border border-widget-border bg-widget p-3 text-[14px] text-fg shadow-[0_8px_32px_var(--vscode-widget-shadow)]">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <button type="button" onClick={onCancel} className="h-[34px] justify-self-start rounded-lg bg-toolbar-hover px-5 hover:opacity-80">
            {t('openWith.cancelButton')}
          </button>
          <h2 className="m-0 text-[14px] font-bold">{t('openWith.title')}</h2>
          <button type="button" onClick={open} disabled={!current} className="h-[34px] justify-self-end rounded-lg bg-button px-5 font-bold text-button-fg hover:bg-button-hover disabled:opacity-50">
            {t('openWith.open')}
          </button>
        </div>
        <div className="flex h-[36px] items-center gap-2 rounded-lg border border-group-border bg-editor px-3 focus-within:border-focus">
          <Icon name="search" className="shrink-0 text-fg-muted" />
          <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('openWith.search')} spellCheck={false} className="min-w-0 flex-1 bg-transparent text-fg outline-none" />
        </div>
        <p className="m-0 px-2 text-center">
          {t('openWith.heading', { name: '\u0000' }).split('\u0000').flatMap((part, i) => (i === 0 ? [part] : [<b key="name" className="break-all">{chooser.name}</b>, part]))}
        </p>
        <div ref={list} role="listbox" aria-label={t('openWith.title')} className="min-h-[120px] flex-1 overflow-auto rounded-lg border border-group-border py-1">
          {recommended.length ? <div className="px-4 pt-2 pb-1 font-bold">{t('openWith.recommended')}</div> : null}
          {recommended.map(row)}
          {others.length ? <div className="px-4 pt-3 pb-1 font-bold">{t('openWith.other')}</div> : null}
          {others.map(row)}
          {!shown.length ? <p className="m-0 p-4 text-fg-muted">{t('openWith.none')}</p> : null}
        </div>
        <label className="flex items-center justify-between gap-3 px-2 text-fg-muted">
          <span>
            <span className="block">{t('openWith.always')}</span>
            <span className="block text-[12px]">{chooser.mimeLabel}</span>
          </span>
          <input type="checkbox" role="switch" aria-label={t('openWith.always')} checked={always} onChange={(e) => setAlways(e.target.checked)} className="h-[22px] w-[40px]" />
        </label>
      </div>
    </div>
  )
}
