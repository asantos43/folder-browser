import { useEffect, useRef } from 'react'
import { useI18n } from '@/i18n/context.tsx'

/** A question with two answers, in a modal dialog: Esc and Cancel say no, and the focus starts on Cancel when `danger` (the destructive answer is never the one Enter gives). */
export function ConfirmDialog({ title, message, confirmLabel, danger = false, onConfirm, onCancel }: { title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n()
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  useEffect(() => (danger ? cancel : confirm).current?.focus(), [danger])
  const button = 'h-[26px] rounded-sm px-4 text-[13px]'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          } else if (e.key === 'Tab') {
            e.preventDefault()
            const other = document.activeElement === cancel.current ? confirm.current : cancel.current
            other?.focus()
          }
        }}
        className="flex w-[min(460px,calc(100vw-32px))] flex-col gap-3 border border-widget-border bg-widget p-5 text-[13px] text-fg shadow-[0_2px_16px_var(--vscode-widget-shadow)]"
      >
        <h2 className="m-0 text-[16px] font-normal">{title}</h2>
        <p className="m-0 text-fg-muted select-text">{message}</p>
        <div className="flex justify-end gap-2">
          <button ref={cancel} type="button" onClick={onCancel} className={`${button} ${danger ? 'bg-button text-button-fg hover:bg-button-hover' : 'hover:bg-toolbar-hover'}`}>
            {t('confirm.cancel')}
          </button>
          <button ref={confirm} type="button" onClick={onConfirm} className={`${button} ${danger ? 'border border-group-border hover:bg-toolbar-hover' : 'bg-button text-button-fg hover:bg-button-hover'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
