import { useEffect, useRef } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import type { Notice } from './messages.ts'

/** Show startup diagnostics once, also under React's StrictMode effect replay. */
export function useSettingsNotices(notify: (notice: Notice) => void): void {
  const { t } = useI18n()
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    for (const notice of window.fb?.settings?.notices() ?? []) {
      notify({ level: 'error', text: t('settings.fileNotice', { id: notice.id, message: notice.message }) })
    }
  }, [notify, t])
}
