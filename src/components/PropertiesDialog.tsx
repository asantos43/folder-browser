import type { DirEntry } from '@core/api.ts'
import { useEffect, useRef } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { formatBytes, formatDate } from '@/lib/format.ts'

const KIND: Record<DirEntry['kind'], MessageKey> = { dir: 'properties.kindDir', file: 'properties.kindFile', zip: 'properties.kindZip', wsnp: 'properties.kindWsnp' }

/** What the tree knows of one row: its name, where it is, what it is, how big and when it changed. A modal dialog: Esc or the button closes it. */
export function PropertiesDialog({ entry, location, onClose }: { entry: DirEntry; /** Where it is, written for a person (the folder that was opened, then the path in it). */ location: string; onClose: () => void }) {
  const { t, language } = useI18n()
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])
  const rows: [MessageKey, string][] = [
    ['properties.name', entry.name],
    ['properties.location', location],
    ['properties.kind', t(KIND[entry.kind])],
    ...(entry.kind === 'dir' ? [] : ([['properties.size', `${formatBytes(entry.size)} (${entry.size.toLocaleString(language)} B)`]] as [MessageKey, string][])),
    ['properties.modified', formatDate(entry.modified, language)],
    ['properties.hidden', t(entry.hidden ? 'properties.yes' : 'properties.no')],
    ...(entry.link ? ([['properties.link', t('properties.yes')]] as [MessageKey, string][]) : []),
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('properties.title')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          } else if (e.key === 'Tab') {
            e.preventDefault()
            close.current?.focus()
          }
        }}
        className="flex w-[min(520px,calc(100vw-32px))] flex-col gap-3 border border-widget-border bg-widget p-5 text-[13px] text-fg shadow-[0_2px_16px_var(--vscode-widget-shadow)]"
      >
        <h2 className="m-0 text-[16px] font-normal">{t('properties.title')}</h2>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 select-text">
          {rows.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-fg-muted">{t(key)}</dt>
              <dd className="m-0 break-all">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end">
          <button ref={close} type="button" onClick={onClose} className="h-[26px] rounded-sm bg-button px-4 text-button-fg hover:bg-button-hover">
            {t('properties.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
