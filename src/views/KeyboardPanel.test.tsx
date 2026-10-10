// @vitest-environment happy-dom
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { KeysHost } from '../../electron/keys-host.ts'
import { I18nProvider } from '@/i18n/context.tsx'
import { en } from '@/i18n/en.ts'
import { ptBR } from '@/i18n/pt-BR.ts'
import { registry } from '@/workbench/commands.ts'
import { setUserKeys } from '@core/keys/effective.ts'
import { filterKeyboard, indexKeyboard } from './keyboardModel.ts'
import { SettingsView } from './SettingsView.tsx'
import { KeyboardPanel } from './KeyboardPanel.tsx'

let host: KeysHost, dir: string, input: string
const listeners = new Set<(snapshot: any) => void>()
let invoke: (channel: string, ...args: unknown[]) => Promise<any>
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-keyboard-panel-')); input = path.join(dir, 'import.json')
  const handlers = new Map<string, (...args: any[]) => any>(), sync = new Map<string, (...args: any[]) => any>()
  const frame = { url: 'fb-ui://app/index.html' }
  const sender = { mainFrame: frame, getURL: () => frame.url, send: (_channel: string, snapshot: any) => listeners.forEach(listener => listener(snapshot)) }
  const event = { sender, senderFrame: frame, returnValue: undefined } as any
  host = new KeysHost(dir, { on: (channel: string, handler: (...args: any[]) => any) => { sync.set(channel, handler) }, removeListener: () => {}, handle: (channel: string, handler: (...args: any[]) => any) => { handlers.set(channel, handler) }, removeHandler: () => {} } as any, () => [{ webContents: sender, isDestroyed: () => false }] as any, false, () => {}, { open: async () => input, save: async () => input, show: async () => {} })
  host.register()
  invoke = async (channel, ...args) => handlers.get(channel)!(event, ...args)
  vi.stubGlobal('fb', { platform: 'linux', keys: {
    recording: (active: boolean) => { sync.get('fb:keys-recording')!(event, active); return event.returnValue },
    get: () => { sync.get('fb:keys-get')!(event); return event.returnValue },
    onChanged: (listener: (snapshot: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    set: (entries: unknown) => invoke('fb:keys-set', entries), export: () => invoke('fb:keys-export'),
    previewImport: () => invoke('fb:keys-import-preview'), applyImport: (token: number, confirmed: boolean) => invoke('fb:keys-import-apply', token, confirmed),
  } })
})
afterEach(() => { cleanup(); listeners.clear(); host.dispose(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); setUserKeys([], false) })
const page = () => render(<I18nProvider language="en"><KeyboardPanel /></I18nProvider>)
const row = (id: string) => document.querySelector(`[data-key-command="${id}"]`) as HTMLElement
const click = (id: string, label: string) => fireEvent.click(within(row(id)).getByRole('button', { name: label }))
const chord = (key: string, ctrlKey = true, altKey = true) => fireEvent.keyDown(window, { key, ctrlKey, altKey })
const apply = () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Apply' }))

it('opens Keyboard inside Settings and records a nonreserved chord through the real host', async () => {
  render(<I18nProvider language="en"><SettingsView theme="auto" setTheme={() => {}} /></I18nProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Keyboard' }))
  const record = within(row('toggleSideBar')).getByRole('button', { name: 'Record key' }); record.focus(); fireEvent.click(record)
  expect(screen.getByRole('status').textContent).toContain('Recording a key')
  chord('Control'); expect(screen.queryByRole('alertdialog')).toBeNull()
  chord('Escape'); expect(screen.getByRole('status').textContent).toBe(''); expect(document.activeElement).toBe(record)
  click('toggleSideBar', 'Record key'); chord('j')
  expect(host.snapshot.entries).toEqual([])
  apply()
  await vi.waitFor(() => expect(within(row('toggleSideBar')).getByText('Ctrl+Alt+J')).toBeTruthy())
  expect(JSON.parse(fs.readFileSync(host.file, 'utf8'))).toEqual([{ key: 'Mod+B', command: '-toggleSideBar' }, { key: 'Ctrl+Alt+J', command: 'toggleSideBar' }])
})
it('refuses a reserved chord immediately and keeps recording without a confirmation', () => {
  page(); click('toggleSideBar', 'Record key'); chord('v', true, false)
  expect(screen.getByRole('alert').textContent).toContain('reserved')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(host.snapshot.entries).toEqual([])
  expect(screen.getByRole('status').textContent).toContain('Recording')
})
it('keeps recording, without resuming the native shortcuts, when the file is reread meanwhile', async () => {
  const recording = vi.spyOn(window.fb!.keys, 'recording')
  page(); click('toggleSideBar', 'Record key')
  expect(recording.mock.calls).toEqual([[true]])
  act(() => listeners.forEach(listener => listener({ entries: [{ key: 'Ctrl+Alt+L', command: 'toggleHidden' }], warnings: [] })))
  expect(within(row('toggleHidden')).getByText('Modified')).toBeTruthy()
  expect(recording.mock.calls).toEqual([[true]])
  chord('j'); expect(within(screen.getByRole('alertdialog')).getByText(/Ctrl\+Alt\+J/)).toBeTruthy()
  expect(recording.mock.calls).toEqual([[true], [false]])
})
it('shows another command conflict before confirmation', async () => {
  await invoke('fb:keys-set', [{ key: 'Ctrl+Alt+J', command: 'toggleHidden' }])
  page(); click('toggleSideBar', 'Record key'); chord('j')
  expect(within(screen.getByRole('alertdialog')).getByText(/Conflicts with:.*Hidden/)).toBeTruthy()
  expect(host.snapshot.entries).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(host.snapshot.entries).toHaveLength(1)
})
it('restores by deleting all additions and removals, and confirms restore all', async () => {
  await invoke('fb:keys-set', [{ key: 'Mod+B', command: '-toggleSideBar' }, { key: 'Ctrl+Alt+J', command: 'toggleSideBar' }])
  page(); expect(within(row('toggleSideBar')).getByText('Modified')).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(document.querySelectorAll('[data-key-command]')).toHaveLength(1)
  click('toggleSideBar', 'Reset')
  await vi.waitFor(() => expect(host.snapshot.entries).toEqual([]))
  expect(JSON.parse(fs.readFileSync(host.file, 'utf8'))).toEqual([])
  fireEvent.click(screen.getByRole('checkbox'))
  click('toggleSideBar', 'Remove key')
  await vi.waitFor(() => expect(within(row('toggleSideBar')).getByText('No key')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Reset All…' }))
  expect(host.snapshot.entries).toHaveLength(1)
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset All…' }))
  await vi.waitFor(() => expect(host.snapshot.entries).toEqual([]))
})
it('previews valid entries, warnings and conflicts and requires the matching confirmed token', async () => {
  fs.writeFileSync(input, JSON.stringify([{ key: 'Ctrl+Alt+J', command: 'toggleSideBar' }, { key: 'Ctrl+Alt+J', command: 'toggleHidden' }, { key: 'Mod+V', command: 'toggleHidden' }]))
  page(); fireEvent.click(screen.getByRole('button', { name: 'Import…' }))
  const summary = await screen.findByRole('alertdialog')
  expect(summary.textContent).toContain('Reserved key chord'); expect(summary.textContent).toContain('Conflicts with:')
  expect(host.snapshot.entries).toEqual([])
  const pending = await invoke('fb:keys-import-preview')
  expect(await invoke('fb:keys-import-apply', pending.token, false)).toHaveProperty('error', 'Confirmation required')
  expect(host.snapshot.entries).toEqual([])
  expect(await invoke('fb:keys-import-apply', pending.token + 1, true)).toHaveProperty('error')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Import…' })); await screen.findByRole('alertdialog'); apply()
  await vi.waitFor(() => expect(host.snapshot.entries).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: 'Export…' }))
  await vi.waitFor(() => expect(JSON.parse(fs.readFileSync(input, 'utf8'))).toHaveLength(2))
})
it('rejects an import exceeding 256 KB without changing keys', async () => {
  fs.writeFileSync(input, '[]' + ' '.repeat(300 * 1024))
  expect(await invoke('fb:keys-import-preview')).toHaveProperty('error', expect.stringContaining('256 KB'))
  expect(host.snapshot.entries).toEqual([])
  expect(fs.existsSync(host.file)).toBe(false)
})
it('filters 500 commands below 10 ms and renders a bounded panel below 200 ms', () => {
  const commands = Array.from({ length: 500 }, (_, i) => ({ id: `budget:command${i}`, title: 'menu.openFile', category: 'file' }))
  const indexed = indexKeyboard(commands, [], false, key => en[key as keyof typeof en] || key)
  const start = performance.now()
  expect(filterKeyboard(indexed, 'command49', false)).toHaveLength(11)
  const filterMs = performance.now() - start
  expect(filterMs).toBeLessThan(10)
  commands.forEach(command => registry.register(command))
  try {
    const opening = performance.now(); page(); const openMs = performance.now() - opening
    expect(document.querySelectorAll('[data-key-command]')).toHaveLength(40)
    expect(openMs).toBeLessThan(200)
    console.info(`Keyboard budget: filter=${filterMs.toFixed(2)} ms, open=${openMs.toFixed(2)} ms`)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'command49' } })
    expect(document.querySelectorAll('[data-key-command]')).toHaveLength(11)
  } finally { commands.forEach(command => registry.unregister(command.id)) }
})
it('keeps English and Brazilian Portuguese keyboard translations in parity', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(ptBR).sort())
  for (const key of Object.keys(en).filter(key => key.startsWith('keyboard.'))) expect(ptBR[key as keyof typeof en]).toBeTruthy()
})
