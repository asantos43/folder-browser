import { useEffect, useState } from 'react'
import { readStored, writeStored } from '@/lib/storage.ts'

export type ThemeSetting = 'auto' | 'dark' | 'light'
export type ThemeName = 'dark' | 'light'

const isSetting = (v: unknown): v is ThemeSetting => v === 'auto' || v === 'dark' || v === 'light'

/** The theme in use: the user's choice, or the system's when it is "auto" (VS Code's "Auto Detect Color Scheme"). */
export const resolveTheme = (setting: ThemeSetting, systemPrefersDark: boolean): ThemeName => (setting === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : setting)

const systemQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined)

/** Puts the theme on <html> and tells the window the colours of its title bar. */
export function applyTheme(theme: ThemeName): void {
  const root = document.documentElement
  root.dataset.theme = theme
  const style = getComputedStyle(root)
  const color = style.getPropertyValue('--vscode-titleBar-activeBackground').trim()
  const symbolColor = style.getPropertyValue('--vscode-titleBar-activeForeground').trim()
  if (color && symbolColor) window.fb?.setTitleBar({ color, symbolColor })
}

export function useTheme(): { setting: ThemeSetting; theme: ThemeName; setSetting: (s: ThemeSetting) => void } {
  const [setting, setSettingState] = useState<ThemeSetting>(() => readStored('theme', 'auto', isSetting))
  const [systemDark, setSystemDark] = useState(() => systemQuery()?.matches ?? true)
  const theme = resolveTheme(setting, systemDark)

  useEffect(() => {
    const query = systemQuery()
    if (!query) return
    const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  useEffect(() => applyTheme(theme), [theme])

  return {
    setting,
    theme,
    setSetting: (s) => {
      setSettingState(s)
      writeStored('theme', s)
    },
  }
}

/** Before the first render, so the window does not flash the wrong theme. */
export function applyInitialTheme(): void {
  applyTheme(resolveTheme(readStored('theme', 'auto', isSetting), systemQuery()?.matches ?? true))
}
