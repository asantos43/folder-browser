import type { ConvertedInfo } from '@core/snapshots.ts'
import { useState } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'

/**
 * The bar over the page of a snapshot that was made from a ZIP saved by PageKeep (docs/PAGEKEEP-ZIP.md, section 4): it says so, that the
 * original is not changed, and offers to save the converted file as a `.wsnp`. **Details** lists what the conversion removed and what the ZIP did not record.
 */
export function ConvertedBar({ info, onSave }: { info: ConvertedInfo; onSave: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const count = info.warnings.length + info.omitted
  return (
    <div role="region" aria-label={t('converted.details')} className="shrink-0 border-b border-group-border bg-widget text-[13px] text-fg">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <Icon name="info" className="shrink-0 text-[16px]" />
        <span className="min-w-0 flex-1">{t('converted.bar', { tool: info.tool })}</span>
        <button type="button" onClick={onSave} className="h-[24px] rounded-sm bg-button px-3 text-button-fg hover:bg-button-hover">
          {t('converted.save')}
        </button>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="h-[24px] rounded-sm px-2 hover:bg-toolbar-hover">
          {t('converted.details')}
        </button>
      </div>
      {open ? (
        <div className="max-h-[160px] overflow-auto px-3 pb-2 pl-9 text-[12px] text-fg-muted select-text">
          <p className="m-0 mb-1">{t('converted.unrecorded')}</p>
          <p className="m-0 mb-1">{count ? t('converted.warnings', { count }) : t('converted.noWarnings')}</p>
          {count ? (
            <ul className="m-0 list-disc pl-4">
              {info.warnings.map((w, i) => (
                <li key={i} className="break-all">
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
