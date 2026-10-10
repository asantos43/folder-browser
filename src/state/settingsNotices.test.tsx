// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { FbApi } from '@core/api.ts'
import { I18nProvider } from '@/i18n/context.tsx'
import { useSettingsNotices } from './settingsNotices.ts'
import { useNotifications } from './notifications.ts'

afterEach(() => { cleanup(); delete window.fb })

function Notices() {
  const { notify, notifications } = useNotifications()
  useSettingsNotices(notify)
  return <>{notifications.map((notice) => <span key={notice.id}>{notice.text}</span>)}</>
}

it.each(['en', 'pt-BR'] as const)('shows settings diagnostics once with the existing notifications in %s', (language) => {
  const settings: FbApi['settings'] = {
    all: () => ({}), set: () => {}, reset: () => {}, onChanged: () => () => {},
    export: async () => ({ changed: [] }), previewImport: async () => ({ canceled: true }), applyImport: async () => ({ changed: [] }), resetAll: async () => ({ changed: [] }), showFile: async () => ({ changed: [] }),
    notices: () => [{ id: 'settings.json', message: 'Invalid JSON' }],
  }
  window.fb = { settings } as FbApi
  render(<StrictMode><I18nProvider language={language}><Notices /></I18nProvider></StrictMode>)
  const text = language === 'en'
    ? 'Some settings could not be loaded; defaults are in use. settings.json: Invalid JSON'
    : 'Algumas opções não puderam ser carregadas; os padrões estão em uso. settings.json: Invalid JSON'
  expect(screen.getAllByText(text)).toHaveLength(1)
})
