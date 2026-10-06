import { distinctValues, FILTER_OPS, UNARY_OPS, type Filter, type FilterOp } from '@core/table.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'

const field = 'h-[24px] rounded-sm border border-group-border bg-editor px-1 text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus'

/**
 * The filter of one column, as a small panel under its header: a condition and a value, or the distinct values of the column to tick (the most frequent ones, with how many rows
 * have each). Apply makes the filter (an empty value with a condition that takes one is no filter), Clear takes it away.
 */
export function ColumnFilter({ name, column, body, filter, at, onApply, onClose }: { name: string; column: number; body: string[][]; filter: Filter | undefined; at: { x: number; y: number }; onApply: (filter: Filter | null) => void; onClose: () => void }) {
  const { t } = useI18n()
  const panel = useRef<HTMLDivElement>(null)
  const [op, setOp] = useState<FilterOp>(filter?.op ?? 'contains')
  const [value, setValue] = useState(filter?.value ?? '')
  const [ticked, setTicked] = useState<Set<string>>(new Set(filter?.values ?? []))
  const distinct = useMemo(() => distinctValues(body, column), [body, column])

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])

  const apply = () => {
    if (op === 'in') return onApply(ticked.size ? { column, op, value: '', values: [...ticked] } : null)
    if (!UNARY_OPS.includes(op) && value === '') return onApply(null)
    onApply({ column, op, value })
  }
  const tick = (v: string) => {
    const next = new Set(ticked)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setTicked(next)
    setOp('in')
  }

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={t('filter.title', { name })}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') apply()
      }}
      style={{ left: Math.max(4, Math.min(at.x, window.innerWidth - 280)), top: at.y }}
      className="fixed z-50 flex w-[270px] flex-col gap-2 rounded border border-widget-border bg-widget p-2 text-[13px] text-fg shadow-lg"
    >
      <label className="flex flex-col gap-1">
        <span className="text-fg-muted">{t('filter.operator')}</span>
        <select aria-label={t('filter.operator')} value={op} onChange={(e) => setOp(e.target.value as FilterOp)} className={field}>
          {FILTER_OPS.map((o) => (
            <option key={o} value={o}>
              {t(`filter.op.${o}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      {UNARY_OPS.includes(op) || op === 'in' ? null : (
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted">{t('filter.value')}</span>
          <input aria-label={t('filter.value')} autoFocus value={value} onChange={(e) => setValue(e.target.value)} className={field} />
        </label>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-fg-muted">{t('filter.values')}</span>
        <ul className="m-0 max-h-[180px] list-none overflow-auto p-0">
          {distinct.map(({ value: v, count }) => (
            <li key={v}>
              <label className="flex cursor-pointer items-center gap-2 py-px hover:bg-list-hover">
                <input type="checkbox" checked={ticked.has(v)} onChange={() => tick(v)} />
                <span className="min-w-0 flex-1 truncate">{v === '' ? '∅' : v}</span>
                <span className="text-fg-muted">{count}</span>
              </label>
            </li>
          ))}
        </ul>
        {distinct.more ? <span className="text-fg-muted">{t('filter.more')}</span> : null}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onApply(null)} className="h-[24px] rounded px-2 hover:bg-toolbar-hover">
          {t('filter.clear')}
        </button>
        <button type="button" onClick={apply} className="h-[24px] rounded bg-button px-3 text-button-fg hover:bg-button-hover">
          {t('filter.apply')}
        </button>
      </div>
    </div>
  )
}
