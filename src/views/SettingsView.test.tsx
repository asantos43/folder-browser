// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { settingsRegistry, type SettingInput } from '@core/settings/registry.ts'
import { builtinSettings } from '@core/settings/builtin.ts'
import { settingFor } from '@/state/setting.ts'
import { I18nProvider } from '@/i18n/context.tsx'
import { useLanguageSetting, resolveLanguage } from '@/state/language.ts'
import { useTheme } from '@/theme/theme.ts'
import { en } from '@/i18n/en.ts'
import { ptBR } from '@/i18n/pt-BR.ts'
import { SettingsView } from './SettingsView.tsx'

const removals: Array<() => void> = []
function contribute(inputs: SettingInput[]) { const remove = settingsRegistry.contribute(inputs); removals.push(remove); return remove }
function page() { return render(<I18nProvider language="en"><SettingsView theme="auto" setTheme={() => {}} /></I18nProvider>) }
const row = (id: string) => document.querySelector(`[data-setting="${id}"]`) as HTMLElement
const search = (query: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
beforeEach(() => { for (const d of settingsRegistry.all()) settingFor(d).reset() })
afterEach(() => { cleanup(); removals.splice(0).forEach(remove => remove()); vi.unstubAllGlobals() })

it('generates all 17 builtins and one editable control for each declared type', () => {
  const definitions: SettingInput[] = [
    { id: 'controls:boolean', type: 'boolean', default: false, label: 'settings.wordWrap', category: 'test' },
    { id: 'controls:choice', type: 'choice', default: 'one', choices: ['one', 'two'], label: 'settings.colorTheme', category: 'test' },
    { id: 'controls:number', type: 'number', default: 3, min: 1, max: 5, label: 'settings.reopen', category: 'test' },
    { id: 'controls:string', type: 'string', default: 'old', label: 'settings.language', category: 'test' },
    { id: 'controls:colour', type: 'colour', default: '', label: 'settings.divider', category: 'test' },
    { id: 'controls:list', type: 'list', default: ['one'], label: 'settings.showHidden', category: 'test' },
  ]
  contribute(definitions); page()
  expect(document.querySelectorAll('[data-setting]')).toHaveLength(23)
  fireEvent.click(within(row('controls:boolean')).getByRole('checkbox'))
  fireEvent.change(within(row('controls:choice')).getByRole('combobox'), { target: { value: 'two' } })
  fireEvent.change(within(row('controls:number')).getByRole('spinbutton'), { target: { value: '4' } })
  fireEvent.change(within(row('controls:string')).getByRole('textbox'), { target: { value: 'new' } })
  fireEvent.change(within(row('controls:colour')).getByLabelText('Divider Line Colour'), { target: { value: '#123456' } })
  fireEvent.change(within(row('controls:list')).getByRole('textbox'), { target: { value: 'one\ntwo' } })
  expect(definitions.map(d => settingFor(settingsRegistry.get(d.id)!).get())).toEqual([true, 'two', 4, 'new', '#123456', ['one', 'two']])
})

it('searches labels without accents or case, descriptions and declared keywords', () => {
  contribute([{ id: 'search:keyword', type: 'boolean', default: false, category: 'test', label: 'settings.wordWrap', keywords: ['settings.portuguese'] }])
  page(); search('PORTUGUES')
  expect(row('search:keyword')).toBeTruthy()
  expect(row('files.showHidden')).toBeNull()
  search('minified'); expect(row('editor.formatSource')).toBeTruthy(); expect(row('search:keyword')).toBeNull()
  search('cOlOr ThEmE'); expect(row('appearance.theme')).toBeTruthy(); expect(row('editor.formatSource')).toBeNull()
})

it('marks modified values, filters them and resets a row to its default', () => {
  page(); fireEvent.click(within(row('files.showHidden')).getByRole('checkbox'))
  expect(within(row('files.showHidden')).getByText('Modified')).toBeTruthy()
  fireEvent.click(screen.getByRole('switch', { name: 'Show Only Modified' }))
  expect(document.querySelectorAll('[data-setting]')).toHaveLength(1)
  fireEvent.click(within(row('files.showHidden')).getByRole('button', { name: /^Reset$/ }))
  expect(settingFor(settingsRegistry.get('files.showHidden')!).get()).toBe(false)
  expect(document.querySelectorAll('[data-setting]')).toHaveLength(0)
  fireEvent.click(screen.getByRole('switch', { name: 'Show Only Modified' }))
  expect(within(row('files.showHidden')).queryByText('Modified')).toBeNull()
})

it('resets an entire section including rows hidden by the search', () => {
  page()
  fireEvent.click(within(row('files.showHidden')).getByRole('checkbox'))
  fireEvent.click(within(row('files.sortDescending')).getByRole('checkbox'))
  fireEvent.click(within(row('editor.wordWrap')).getByRole('checkbox'))
  expect(settingFor(settingsRegistry.get('files.sortDescending')!).get()).toBe(true)
  expect(settingFor(settingsRegistry.get('files.showHidden')!).get()).toBe(true)
  search('hidden')
  fireEvent.click(within(screen.getByRole('region', { name: 'Files' })).getByRole('button', { name: 'Reset section' }))
  expect(settingFor(settingsRegistry.get('files.sortDescending')!).get()).toBe(false)
  expect(within(row('files.showHidden')).queryByText('Modified')).toBeNull()
  expect(settingFor(settingsRegistry.get('editor.wordWrap')!).get()).toBe(true)
})

it('shows restart metadata and adds/removes a plugin section while mounted', () => {
  page(); expect(screen.queryByRole('region', { name: 'Plugins ▸ demo' })).toBeNull()
  let remove!: () => void
  act(() => { remove = contribute([{ id: 'demo:restart', type: 'boolean', default: false, category: 'test', label: 'settings.wordWrap', restart: true }]) })
  expect(within(screen.getByRole('region', { name: 'Plugins ▸ demo' })).getByText('Restart required')).toBeTruthy()
  expect(within(row('editor.wordWrap')).queryByText('Restart required')).toBeNull()
  act(remove); expect(screen.queryByRole('region', { name: 'Plugins ▸ demo' })).toBeNull()
})

it('keeps theme and language selectors connected to their existing consumers', () => {
  function Harness() {
    const [language] = useLanguageSetting()
    const theme = useTheme()
    return <I18nProvider language={resolveLanguage(language)}><SettingsView theme={theme.setting} setTheme={theme.setSetting} /></I18nProvider>
  }
  render(<Harness />)
  fireEvent.change(within(row('appearance.theme')).getByRole('combobox'), { target: { value: 'dark' } })
  expect(document.documentElement.dataset.theme).toBe('dark')
  fireEvent.change(within(row('system.language')).getByRole('combobox'), { target: { value: 'pt-BR' } })
  expect(screen.getByRole('searchbox').getAttribute('aria-label')).toBe(ptBR['settings.search'])
})

it('declares translated labels/descriptions and choice/category keys for all builtins', () => {
  expect(builtinSettings).toHaveLength(17)
  for (const definition of builtinSettings) {
    expect(definition.label).toBeTruthy(); expect(definition.description).toBeTruthy()
    for (const key of [definition.label!, definition.description!, definition.categoryLabel!, ...(definition.choiceLabels ?? []), ...(definition.keywords ?? [])]) {
      expect(en[key as keyof typeof en], key).toBeTruthy()
      expect(ptBR[key as keyof typeof ptBR], key).toBeTruthy()
    }
  }
})

it('shows the import summary before applying, asks again for safety, and confirms reset', async () => {
  const api = {
    export: vi.fn(async () => ({ changed: [] })), showFile: vi.fn(async () => ({ changed: [] })),
    previewImport: vi.fn(async () => ({ token: 7, needsConfirm: true, preview: { changes: [
      { id: 'guard:enabled', before: false, after: true, needsConfirm: true },
      { id: 'unknown:key', after: 2, reason: 'Unknown setting', needsConfirm: false },
      { id: 'appearance.theme', before: 'auto', after: 42, reason: 'Invalid value', needsConfirm: false },
    ] } })),
    applyImport: vi.fn(async () => ({ changed: ['guard:enabled'] })), resetAll: vi.fn(async () => ({ changed: [] })),
  }
  vi.stubGlobal('fb', { settings: api })
  page()
  fireEvent.click(screen.getByRole('button', { name: 'Export…' }))
  await vi.waitFor(() => expect(api.export).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Import…' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Show Settings File' }))
  await vi.waitFor(() => expect(api.showFile).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Import…' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Import…' }))
  await screen.findByRole('alertdialog', { name: 'Import summary' })
  expect(screen.getByText(/guard:enabled: false → true/)).toBeTruthy()
  expect(screen.getByText(/Unknown setting; skipped/)).toBeTruthy()
  expect(screen.getByText(/Invalid value; skipped/)).toBeTruthy()
  expect(api.applyImport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(screen.getByRole('alertdialog', { name: 'Confirm safety changes' })).toBeTruthy()
  expect(api.applyImport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(api.applyImport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Import…' }))
  await screen.findByRole('alertdialog', { name: 'Import summary' })
  fireEvent.click(screen.getByRole('button', { name: 'Apply' })); fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await vi.waitFor(() => expect(api.applyImport).toHaveBeenCalledWith(7, true, true))
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Reset All…' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Reset All…' }))
  expect(api.resetAll).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(api.resetAll).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Reset All…' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset All…' }))
  await vi.waitFor(() => expect(api.resetAll).toHaveBeenCalledWith(true))
})

it('keeps portable command translations in parity', () => {
  for (const key of Object.keys(en).filter(key => key.startsWith('settings.'))) {
    expect(ptBR[key as keyof typeof en], key).toBeTruthy()
  }
  expect(Object.keys(en).sort()).toEqual(Object.keys(ptBR).sort())
})

