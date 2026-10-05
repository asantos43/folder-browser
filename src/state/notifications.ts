import { useCallback, useEffect, useRef, useState } from 'react'
import type { Notice } from './messages.ts'

export interface Notification extends Notice {
  id: number
}

const INFO_MS = 8000

/** The messages shown at the bottom right, as VS Code's notifications: an error stays until dismissed, an information goes by itself. */
export function useNotifications(): { notifications: Notification[]; notify: (notice: Notice) => void; dismiss: (id: number) => void } {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const next = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setNotifications((list) => list.filter((n) => n.id !== id))
  }, [])

  const notify = useCallback(
    (notice: Notice) => {
      const id = next.current++
      setNotifications((list) => [...list.slice(-4), { ...notice, id }])
      if (notice.level === 'info') timers.current.set(id, setTimeout(() => dismiss(id), INFO_MS))
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return { notifications, notify, dismiss }
}
