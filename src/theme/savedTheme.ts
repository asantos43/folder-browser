import { useEffect } from 'react'
import { settingsRegistry } from '@core/settings/registry.ts'
import { settingFor } from '@/state/setting.ts'
import { themeRegistry, type ThemeRegistry } from './registry.ts'

type SavedThemeRegistry = Pick<ThemeRegistry, 'activeSelection' | 'previewSelection' | 'hasTheme' | 'apply' | 'reset'>

/** O(1) selection lookup per change; no storage writes or enumeration of themes. */
export function reconcileSavedTheme(saved: unknown, registry: SavedThemeRegistry): void {
  if (registry.previewSelection() !== null || typeof saved !== 'string') return
  const active = registry.activeSelection()
  if (saved === '') {
    if (active !== null) registry.reset()
    return
  }
  const separator = saved.indexOf(':')
  if (separator <= 0 || separator === saved.length - 1) return
  const pluginId = saved.slice(0, separator)
  const themeId = saved.slice(separator + 1)
  if (active?.pluginId === pluginId && active.themeId === themeId) return
  if (registry.hasTheme(pluginId, themeId)) registry.apply(pluginId, themeId)
}

/** App-wide bridge: the picker need not be mounted for startup or reactivation. */
export function useSavedTheme(): void {
  useEffect(() => {
    const definition = settingsRegistry.get('appearance.themePlugin')
    if (!definition) return
    const setting = settingFor(definition)
    const reconcile = () => reconcileSavedTheme(setting.get(), themeRegistry)
    const unsubscribeSetting = setting.subscribe(reconcile)
    const unsubscribeRegistry = themeRegistry.subscribe(reconcile)
    reconcile()
    return () => { unsubscribeSetting(); unsubscribeRegistry() }
  }, [])
}
