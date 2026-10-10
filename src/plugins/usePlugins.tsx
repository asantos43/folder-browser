import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { InstallOutcome, PluginSummary, PluginsApi, RemoveOptions } from '@core/plugins/summary.ts'

/**
 * Provided by the host at the top of the interface once the preload exposes `window.fb.plugins`.
 * Without a provider, the panel shows "Plugins are not available in this build".
 * 2.5: provide window.fb.plugins here
 */
const PluginsApiContext = createContext<PluginsApi | undefined>(undefined)

export function PluginsProvider({ value, children }: { value: PluginsApi | undefined; children: ReactNode }) {
  return <PluginsApiContext.Provider value={value}>{children}</PluginsApiContext.Provider>
}

export interface PluginsActions {
  setEnabled(id: string, enabled: boolean): Promise<void>
  disableAll(): Promise<void>
  remove(id: string, opts: RemoveOptions): Promise<void>
  openFolder(id: string): Promise<void>
  install(): Promise<InstallOutcome>
}

export interface PluginsState {
  /** False until a provider is set; the page then shows the "not available" message. */
  available: boolean
  items: PluginSummary[]
  loading: boolean
  refresh(): Promise<void>
  actions: PluginsActions
}

const NOOP_ACTIONS: PluginsActions = {
  setEnabled: async () => {},
  disableAll: async () => {},
  remove: async () => {},
  openFolder: async () => {},
  install: async () => ({ cancelled: true }),
}

/**
 * The hook the Plugins page reads. `list()` is called once on mount and again every time the
 * host fires `onChange`; multiple events in the same animation frame collapse into one call so
 * the page stays cheap when the host batches.
 */
export function usePlugins(): PluginsState {
  const api = useContext(PluginsApiContext)
  const [items, setItems] = useState<PluginSummary[]>([])
  const [loading, setLoading] = useState(false)
  const inFlight = useRef(false)
  const dirty = useRef(false)
  const scheduled = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    if (!api) return
    setLoading(true)
    try {
      const next = await api.list()
      setItems(next)
    } finally {
      setLoading(false)
    }
  }, [api])

  // Coalesce multiple `onChange` events in the same animation frame into one `list()`,
  // never run two `list()` calls at the same time, and never drop an `onChange` that
  // arrived during an in-flight refresh (mark `dirty` and run one more when it settles).
  useEffect(() => {
    if (!api) return
    const flush = () => {
      scheduled.current = null
      if (inFlight.current) { dirty.current = true; return }
      inFlight.current = true
      refresh().finally(() => {
        inFlight.current = false
        if (dirty.current) {
          dirty.current = false
          scheduled.current = requestAnimationFrame(flush)
        }
      })
    }
    const remove = api.onChange(() => {
      if (scheduled.current !== null) return
      scheduled.current = requestAnimationFrame(flush)
    })
    flush() // the first load goes through the same guard, so a change during it is not concurrent
    return () => {
      remove()
      if (scheduled.current !== null) cancelAnimationFrame(scheduled.current)
    }
  }, [api, refresh])

  if (!api) {
    return { available: false, items: [], loading: false, refresh: async () => {}, actions: NOOP_ACTIONS }
  }
  const actions: PluginsActions = {
    setEnabled: (id, enabled) => api.setEnabled(id, enabled),
    disableAll: () => api.disableAll(),
    remove: (id, opts) => api.remove(id, opts),
    openFolder: (id) => api.openFolder(id),
    install: () => api.install(),
  }
  return { available: true, items, loading, refresh, actions }
}