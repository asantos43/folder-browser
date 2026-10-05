import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import type { Notification } from '@/state/notifications.ts'

/** VS Code's notifications, bottom right: an error stays until dismissed, an information goes by itself. */
export function Notifications({ notifications, onDismiss }: { notifications: Notification[]; onDismiss: (id: number) => void }) {
  const { t } = useI18n()
  if (!notifications.length) return null
  return (
    <div aria-label={t('notification.label')} className="pointer-events-none fixed right-3 bottom-[30px] z-40 flex w-[min(420px,calc(100vw-24px))] flex-col gap-2">
      {notifications.map((n) => (
        <div key={n.id} role={n.level === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex items-start gap-2 border border-widget-border bg-widget p-3 text-[13px] text-fg shadow-[0_2px_8px_var(--vscode-widget-shadow)]">
          <Icon name={n.level === 'error' ? 'error' : 'info'} className={`mt-px text-[16px] ${n.level === 'error' ? 'text-error' : 'text-link'}`} />
          <p className="m-0 min-w-0 flex-1 break-words">{n.text}</p>
          <button type="button" aria-label={t('notification.dismiss')} title={t('notification.dismiss')} onClick={() => onDismiss(n.id)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-toolbar-hover">
            <Icon name="close" className="text-[14px]" />
          </button>
        </div>
      ))}
    </div>
  )
}
