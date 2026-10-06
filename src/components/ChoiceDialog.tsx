import { useEffect, useRef } from 'react'
import { useI18n } from '@/i18n/context.tsx'

export interface Choice {
  label: string
  run: () => void
  /** The one Enter gives (it has the focus first). */
  primary?: boolean
}

/** A question with several answers and Cancel, in a modal dialog: Esc and Cancel say no, Tab goes through the buttons, and the primary one has the focus. */
export function ChoiceDialog({ title, message, choices, onCancel }: { title: string; message: string; choices: Choice[]; onCancel: () => void }) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const buttons = box.current?.querySelectorAll<HTMLButtonElement>('button')
    const primary = box.current?.querySelector<HTMLButtonElement>('button[data-primary]')
    ;(primary ?? buttons?.[0])?.focus()
  }, [])
  const button = 'h-[26px] rounded-sm px-4 text-[13px]'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          } else if (e.key === 'Tab') {
            e.preventDefault()
            const buttons = [...(box.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
            buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
          }
        }}
        className="flex w-[min(520px,calc(100vw-32px))] flex-col gap-3 border border-widget-border bg-widget p-5 text-[13px] text-fg shadow-[0_2px_16px_var(--vscode-widget-shadow)]"
      >
        <h2 className="m-0 text-[16px] font-normal">{title}</h2>
        <p className="m-0 text-fg-muted select-text">{message}</p>
        <div className="flex flex-wrap justify-end gap-2">
          {choices.map((choice) => (
            <button key={choice.label} type="button" data-primary={choice.primary ? '' : undefined} onClick={choice.run} className={`${button} ${choice.primary ? 'bg-button text-button-fg hover:bg-button-hover' : 'border border-group-border hover:bg-toolbar-hover'}`}>
              {choice.label}
            </button>
          ))}
          <button type="button" onClick={onCancel} className={`${button} hover:bg-toolbar-hover`}>
            {t('confirm.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
