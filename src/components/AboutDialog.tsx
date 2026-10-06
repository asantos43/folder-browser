import type { AppInfo } from '@core/api.ts'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { Icon } from './Icon.tsx'

export const SOURCE_URL = 'https://github.com/asantos43/folder-browser'

/** The About window: version, what it runs on, the licence, the third-party notices and the links. A modal dialog: Esc or the button closes it. */
export function AboutDialog({ info, onClose, onOpenExternal, onOpenGuide, onCopy }: { info: AppInfo | null; onClose: () => void; /** Opens the user guide that is inside the application, in a tab. */ onOpenGuide: () => void; onOpenExternal: (url: string) => void; onCopy: (text: string) => void }) {
  const { t } = useI18n()
  const [notices, setNotices] = useState(false)
  const [copied, setCopied] = useState(false)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])

  const summary = info ? `${info.name} ${info.version}\n${t('about.runsOn', { electron: info.electron, chrome: info.chrome, node: info.node, platform: info.platform, arch: info.arch })}` : ''
  const link = 'text-left text-link hover:underline'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('about.title')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          } else if (e.key === 'Tab') {
            // The focus stays in the dialog.
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')]
            const at = items.indexOf(document.activeElement as HTMLElement)
            const next = items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]
            e.preventDefault()
            next?.focus()
          }
        }}
        className="flex max-h-[85vh] w-[min(560px,calc(100vw-32px))] flex-col gap-3 overflow-hidden border border-widget-border bg-widget p-5 text-[13px] text-fg shadow-[0_2px_16px_var(--vscode-widget-shadow)]"
      >
        <div className="flex items-center gap-4">
          <img src="./icon.svg" alt="" className="h-16 w-16" />
          <div>
            <h2 className="m-0 text-[18px] font-normal">{info?.name ?? 'Folder Browser'}</h2>
            {info ? <p className="m-0 text-fg-muted">{t('about.version', { version: info.version })}</p> : null}
          </div>
        </div>
        <p className="m-0">{t('about.tagline')}</p>
        {info ? <p className="m-0 text-[12px] text-fg-muted">{t('about.runsOn', { electron: info.electron, chrome: info.chrome, node: info.node, platform: info.platform, arch: info.arch })}</p> : null}
        <p className="m-0">
          <strong>{t('about.licence')}:</strong> {t('about.licenceText')}
        </p>
        <p className="m-0 text-[12px] text-fg-muted">{t('about.icons')}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <button type="button" className={link} onClick={() => onOpenExternal(SOURCE_URL)}>
            {t('about.source')}
          </button>
          <button type="button" className={link} onClick={onOpenGuide}>
            {t('about.guide')}
          </button>
          <button
            type="button"
            className={link}
            onClick={() => {
              onCopy(summary)
              setCopied(true)
            }}
          >
            {copied ? t('about.copied') : t('about.copy')}
          </button>
        </div>
        <div className="min-h-0">
          <button type="button" aria-expanded={notices} onClick={() => setNotices(!notices)} className={`${link} flex items-center gap-1`}>
            <Icon name={notices ? 'chevron-down' : 'chevron-right'} />
            {t(notices ? 'about.hideNotices' : 'about.showNotices')}
          </button>
          <span className="ml-5 text-[12px] text-fg-muted">{t('about.noticesHint')}</span>
          {notices ? (
            <pre tabIndex={0} aria-label={t('about.notices')} className="m-0 mt-2 max-h-[38vh] overflow-auto whitespace-pre-wrap border border-group-border bg-editor p-2 text-[11px] text-editor-fg select-text">
              {info?.notices || '—'}
            </pre>
          ) : null}
        </div>
        <div className="flex justify-end">
          <button ref={close} type="button" onClick={onClose} className="h-[26px] rounded-sm bg-button px-4 text-[13px] text-button-fg hover:bg-button-hover">
            {t('about.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
