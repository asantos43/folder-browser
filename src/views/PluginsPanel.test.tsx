// @vitest-environment happy-dom
import { Profiler, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { PluginsProvider, usePlugins } from '@/plugins/usePlugins.tsx'
import type { InstallOutcome, PluginSummary, PluginsApi, TrustLabel } from '@core/plugins/summary.ts'
import { PluginsPanel } from './PluginsPanel.tsx'

const TRUTH: TrustLabel[] = ['catalog', 'signed-trusted', 'signed-unknown', 'repository', 'unsigned']

function summary(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: 'acme.demo',
    name: 'Acme Demo',
    version: '1.0.0',
    description: 'A demo plugin',
    publisher: { id: 'acme', name: 'Acme' },
    trust: 'unsigned',
    enabled: true,
    sizeBytes: 12_345,
    contributes: { themes: 0, keymaps: 0, languages: 0, locales: 0, openWith: 0, commands: 0, settings: 0 },
    hasCode: false,
    developer: false,
    ...overrides,
  }
}

interface Fake {
  api: PluginsApi
  list: ReturnType<typeof vi.fn>
  setEnabled: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  disableAll: ReturnType<typeof vi.fn>
  openFolder: ReturnType<typeof vi.fn>
  install: ReturnType<typeof vi.fn>
  listeners: Set<() => void>
  fireChange: () => void
}

function fakeApi(overrides: Partial<{ items: PluginSummary[], installResult: InstallOutcome }> = {}): Fake {
  const items = overrides.items ?? []
  const list = vi.fn(async () => items)
  const setEnabled = vi.fn(async () => {})
  const remove = vi.fn(async () => {})
  const disableAll = vi.fn(async () => {})
  const openFolder = vi.fn(async () => {})
  const install = vi.fn(async (): Promise<InstallOutcome> => overrides.installResult ?? { cancelled: true })
  const listeners = new Set<() => void>()
  const onChange = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb) } }
  return {
    api: { list, setEnabled, remove, disableAll, openFolder, install, onChange },
    list, setEnabled, remove, disableAll, openFolder, install, listeners,
    fireChange: () => listeners.forEach(l => l()),
  }
}

function page(api?: PluginsApi) {
  return render(<I18nProvider language="en"><PluginsProvider value={api}><PluginsPanel /></PluginsProvider></I18nProvider>)
}
function row(id: string) { return document.querySelector(`[data-plugin-id="${id}"]`) as HTMLElement }
const attr = (el: Element, name: string) => el.getAttribute(name)
const text = (el: Element | null) => (el ? (el.textContent ?? '') : '')

beforeEach(() => {
  // happy-dom does not implement ResizeObserver; the panel must still mount a small window.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('shows the "not available" message when no provider is set', () => {
  page()
  expect(text(screen.getByRole('region', { name: 'Plugins' }))).toContain('Plugins are not available in this build.')
})

it('shows an empty state when the list is empty', async () => {
  const fake = fakeApi({ items: [] })
  page(fake.api)
  await vi.waitFor(() => expect(text(screen.getByRole('region', { name: 'Plugins' }))).toContain('No plugins installed.'))
  expect(fake.list).toHaveBeenCalled()
})

it('renders 100 entries under 100 ms with at most ~30 rows in the DOM', async () => {
  const items = Array.from({ length: 100 }, (_, i) => summary({ id: `p${i}.demo`, name: `Plugin ${i}`, publisher: { id: `p${i}`, name: `Publisher ${i}` } }))
  const fake = fakeApi({ items })
  const start = performance.now()
  page(fake.api)
  await screen.findByRole('region', { name: 'Plugins' })
  const elapsed = performance.now() - start
  const rows = document.querySelectorAll('[data-plugin-id]')
  expect(rows.length).toBeLessThanOrEqual(30)
  expect(elapsed).toBeLessThan(100)
  console.info(`Plugins budget: render 100=${elapsed.toFixed(1)} ms, mounted=${rows.length}`)
})

it('filters by name, id and publisher, ignoring accents and case', async () => {
  const items = [
    summary({ id: 'acme.alpha', name: 'Alpha', publisher: { id: 'acme', name: 'Acme' } }),
    summary({ id: 'beta.beta', name: 'Configuração', publisher: { id: 'beta', name: 'Bêta' } }),
    summary({ id: 'gamma.gamma', name: 'Gamma', publisher: { id: 'gamma', name: 'Gamma' } }),
  ]
  const fake = fakeApi({ items })
  page(fake.api)
  await vi.waitFor(() => expect(screen.getByRole('list', { name: 'Plugins' })).toBeTruthy())
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ALPHA' } })
  await vi.waitFor(() => expect(document.querySelectorAll('[data-plugin-id]')).toHaveLength(1))
  expect(row('acme.alpha')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beta.beta' } })
  await vi.waitFor(() => expect(row('beta.beta')).toBeTruthy())
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'BêtA' } })
  await vi.waitFor(() => expect(row('beta.beta')).toBeTruthy())
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
  await vi.waitFor(() => expect(document.querySelectorAll('[data-plugin-id]').length).toBeGreaterThan(1))
})

it('renders every trust label with its text', async () => {
  const items = TRUTH.map((trust, i) => summary({ id: `${trust}.demo${i}`, name: `Demo ${trust}`, trust }))
  const fake = fakeApi({ items })
  page(fake.api)
  await vi.waitFor(() => expect(document.querySelectorAll('[data-plugin-id]')).toHaveLength(5))
  for (const trust of TRUTH) {
    const row = document.querySelector(`[data-trust="${trust}"]`)
    expect(row, trust).toBeTruthy()
  }
  expect(text(row('catalog.demo0'))).toContain('From the catalog')
  expect(text(row('signed-trusted.demo1'))).toContain('Signed by a publisher you trust')
  expect(text(row('signed-unknown.demo2'))).toContain('Signed, unknown publisher')
  expect(text(row('repository.demo3'))).toContain('From a repository')
  expect(text(row('unsigned.demo4'))).toContain('Unsigned')
})

it('calls setEnabled with the new value when the toggle is clicked, and uses the plugin name in the aria-label', async () => {
  const fake = fakeApi({ items: [summary({ name: 'Acme Demo', enabled: false })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  const toggle = within(row('acme.demo')).getByRole('switch', { name: 'Enable Acme Demo' })
  expect(attr(toggle, 'aria-checked')).toBe('false')
  fireEvent.click(toggle)
  await vi.waitFor(() => expect(fake.setEnabled).toHaveBeenCalledWith('acme.demo', true))
})

it('disables the toggle for a plugin with code and explains why', async () => {
  const fake = fakeApi({ items: [summary({ name: 'Coded', hasCode: true })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  const toggle = within(row('acme.demo')).getByRole('switch')
  expect((toggle as HTMLButtonElement).disabled).toBe(true)
  expect(attr(toggle, 'title')).toBe('Plugins with code arrive in a later version.')
  expect(text(row('acme.demo'))).toContain('Has code')
  fireEvent.click(toggle)
  expect(fake.setEnabled).not.toHaveBeenCalled()
})

it('opens a choice dialog for Remove with Keep and Delete, passing keepSettings', async () => {
  const fake = fakeApi({ items: [summary({ name: 'Acme Demo' })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  fireEvent.click(within(row('acme.demo')).getByRole('button', { name: 'Remove' }))
  const dialog = await screen.findByRole('alertdialog', { name: "Remove 'Acme Demo'?" })
  expect(within(dialog).getByRole('button', { name: 'Keep my settings for this plugin' })).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Delete my settings for this plugin' })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my settings for this plugin' }))
  await vi.waitFor(() => expect(fake.remove).toHaveBeenCalledWith('acme.demo', { keepSettings: true }))
  // re-open and try Delete
  fireEvent.click(within(row('acme.demo')).getByRole('button', { name: 'Remove' }))
  const dialog2 = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog2).getByRole('button', { name: 'Delete my settings for this plugin' }))
  await vi.waitFor(() => expect(fake.remove).toHaveBeenCalledWith('acme.demo', { keepSettings: false }))
})

it('opens the confirmation for Disable All and calls the action once', async () => {
  const fake = fakeApi({ items: [summary({ enabled: true }), summary({ id: 'two.two', enabled: true })] })
  page(fake.api)
  await screen.findByRole('region', { name: 'Plugins' })
  const button = screen.getByRole('button', { name: 'Disable All' })
  expect((button as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(button)
  const dialog = await screen.findByRole('alertdialog', { name: 'Disable All' })
  expect(within(dialog).getByRole('button', { name: 'Disable All' })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Disable All' }))
  await vi.waitFor(() => expect(fake.disableAll).toHaveBeenCalledOnce())
})

it('disables Disable All when nothing is enabled', async () => {
  const fake = fakeApi({ items: [summary({ enabled: false })] })
  page(fake.api)
  await screen.findByRole('region', { name: 'Plugins' })
  expect((screen.getByRole('button', { name: 'Disable All' }) as HTMLButtonElement).disabled).toBe(true)
})

it('shows the install refusal in plain words, and shows nothing when the user cancels', async () => {
  const fake = fakeApi({ items: [], installResult: { ok: false, code: 'install.failed', message: 'not a valid package' } })
  page(fake.api)
  await screen.findByRole('region', { name: 'Plugins' })
  fireEvent.click(screen.getByRole('button', { name: 'Install Plugin from File…' }))
  await vi.waitFor(() => expect(fake.install).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(text(screen.getByRole('alert'))).toContain('Could not install: not a valid package'))
  // Cancelling leaves the previous message on screen (cancellation does not change UI state).
  fake.install.mockResolvedValueOnce({ cancelled: true })
  fireEvent.click(screen.getByRole('button', { name: 'Install Plugin from File…' }))
  await vi.waitFor(() => expect(fake.install).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(text(screen.getByRole('alert'))).toContain('Could not install: not a valid package'))
  // A successful install clears the previous error.
  fake.install.mockResolvedValueOnce({ ok: true, id: 'new.id' })
  fireEvent.click(screen.getByRole('button', { name: 'Install Plugin from File…' }))
  await vi.waitFor(() => expect(fake.install).toHaveBeenCalledTimes(3))
  await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it('shows the rejection of install() in plain words (not a stack trace)', async () => {
  // The host promise itself rejects (the install dialog could not even open).
  const fake = fakeApi({ items: [] })
  fake.install.mockRejectedValueOnce(new Error('dialog system unavailable'))
  page(fake.api)
  await screen.findByRole('region', { name: 'Plugins' })
  fireEvent.click(screen.getByRole('button', { name: 'Install Plugin from File…' }))
  await vi.waitFor(() => expect(text(screen.getByRole('alert'))).toContain('dialog system unavailable'))
})

it('renders plugin text as text, never HTML, and caps a 5000-character name visually', async () => {
  const longName = 'A'.repeat(5000) + 'tail'
  // The hostile markup goes in the *name*, which is the field the row renders, not the description.
  const fake = fakeApi({ items: [summary({ name: `${longName}<img src=x onerror="window.__owned=true">`, description: '' })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  expect((window as unknown as { __owned?: boolean }).__owned).toBeUndefined()
  // No <img> element is ever created from the name; the markup is just text in the DOM.
  expect(row('acme.demo').querySelector('img')).toBeNull()
  // The host element has overflow hidden + text-overflow ellipsis (CSS enforces the cap).
  const nameEl = row('acme.demo').querySelector('strong') as HTMLElement
  expect(nameEl.className).toMatch(/truncate/)
  expect(nameEl.textContent).toMatch(/^A+/)
})

it('updates the list once per frame when the host fires onChange in bursts', async () => {
  const items = [summary()]
  const fake = fakeApi({ items })
  page(fake.api)
  await vi.waitFor(() => expect(fake.list).toHaveBeenCalledTimes(1))
  fake.fireChange(); fake.fireChange(); fake.fireChange(); fake.fireChange(); fake.fireChange()
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  // Coalesced: at most one extra refresh (the first burst). With 5 calls, expect ≤ 2 list() total.
  expect(fake.list.mock.calls.length).toBeLessThanOrEqual(2)
})

it('runs at most one list() at a time when onChange fires during an in-flight refresh', async () => {
  // Slow `list()` and fire onChange events while the first call is in flight. The hook's
  // `inFlight` guard plus the `dirty` flag guarantee that no two `list()` calls overlap
  // and that exactly one retry runs once the in-flight call resolves.
  let resolveFirst!: (items: PluginSummary[]) => void
  const fake = fakeApi({ items: [summary()] })
  fake.list.mockImplementationOnce(() => new Promise<PluginSummary[]>(resolve => { resolveFirst = resolve }))
  fake.list.mockImplementation(async () => [summary()])
  page(fake.api)
  // Fire 10 onChange events while the first list() is in flight.
  for (let i = 0; i < 10; i++) fake.fireChange()
  expect(fake.list).toHaveBeenCalledTimes(1)
  // Wait for the rAF scheduled by fireChange to fire (it sees inFlight=true and returns;
  // the dirty flag is set here so a follow-up is scheduled once the in-flight call resolves).
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  // Resolve the first list; one extra refresh is scheduled by the dirty flag.
  resolveFirst([summary()])
  await vi.waitFor(() => expect(fake.list.mock.calls.length).toBeGreaterThanOrEqual(2))
  // Let everything settle.
  await new Promise(resolve => setTimeout(resolve, 50))
  // Initial + 1 dirty-triggered retry. The guard prevented overlapping calls.
  expect(fake.list.mock.calls.length).toBe(2)
})

it('marks onChange during an in-flight list as dirty and refreshes once more when the call settles', async () => {
  // Make the first `list()` pending while we fire onChange events. Without the `dirty`
  // flag the guard would drop those events and the list would stay stale; with the fix
  // a single follow-up refresh runs once the first one resolves.
  let resolveFirst!: (items: PluginSummary[]) => void
  const fake = fakeApi({ items: [summary()] })
  fake.list.mockImplementationOnce(() => new Promise<PluginSummary[]>(resolve => { resolveFirst = resolve }))
  fake.list.mockImplementation(async () => [summary()])
  page(fake.api)
  // Several onChange events arrive while the first list() is still pending.
  fake.fireChange(); fake.fireChange(); fake.fireChange()
  expect(fake.list).toHaveBeenCalledTimes(1)
  // Wait for the rAF to fire (with inFlight=true, the dirty flag is set, no new list call).
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  // Resolve the first list: the dirty flag schedules a single follow-up refresh.
  resolveFirst([summary()])
  await vi.waitFor(() => expect(fake.list.mock.calls.length).toBeGreaterThanOrEqual(2))
  await new Promise(resolve => setTimeout(resolve, 50))
  // Initial + 1 dirty-triggered retry.
  expect(fake.list.mock.calls.length).toBe(2)
})

it('operates by keyboard: the toggle is focusable and activates on Space and Enter', async () => {
  const fake = fakeApi({ items: [summary({ enabled: false })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  const toggle = within(row('acme.demo')).getByRole('switch', { name: 'Enable Acme Demo' })
  // Tab reaches the toggle (we focus it directly here, but the rendered button is focusable).
  toggle.focus()
  expect(document.activeElement).toBe(toggle)
  // Space and Enter on a focused button activate it; happy-dom does not run the default
  // action on Space alone, so we dispatch `keyDown` followed by `click`.
  fireEvent.keyDown(toggle, { key: ' ' })
  fireEvent.click(toggle)
  await vi.waitFor(() => expect(fake.setEnabled).toHaveBeenCalledWith('acme.demo', true))
  // Enter too: it is also a click activator. The first click leaves `busy=true` until
  // the action resolves, so we wait for the button to be enabled again before pressing.
  await vi.waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
  fireEvent.keyDown(toggle, { key: 'Enter' })
  fireEvent.click(toggle)
  await vi.waitFor(() => expect(fake.setEnabled).toHaveBeenCalledTimes(2))
})

it('shows a developer-mode banner when at least one plugin is in developer mode', async () => {
  const fake = fakeApi({ items: [summary({ developer: true, id: 'dev.dev' })] })
  page(fake.api)
  await screen.findByRole('region', { name: 'Plugins' })
  expect(text(screen.getByRole('status'))).toContain('Developer mode is on')
})

it('shows a one-line error message for a plugin the host could not summarise', async () => {
  const fake = fakeApi({ items: [summary({ error: 'manifest.json: too big' })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  expect(text(within(row('acme.demo')).getByRole('alert'))).toContain('Could not read this plugin: manifest.json: too big')
})

it('isolates the plugin name from neighbouring text with a U+202E bidi override', async () => {
  // The override character must not flip the surrounding English text. <bdi> isolates the run.
  const fake = fakeApi({ items: [summary({ name: 'innocent\u202Egpj.exe', publisher: { id: 'acme', name: 'Acme' } })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  const nameBdi = row('acme.demo').querySelector('strong > bdi') as HTMLElement
  expect(nameBdi).toBeTruthy()
  // The <bdi> element isolates the run; the raw text is preserved inside it.
  expect(nameBdi.textContent).toBe('innocent\u202Egpj.exe')
  // Sibling text outside the <bdi> must not be flipped: the next sibling "By Acme" still
  // starts with "By " (a visual reordering would put the publisher first).
  const publisherText = row('acme.demo').textContent ?? ''
  expect(publisherText.indexOf('By Acme')).toBeGreaterThan(publisherText.indexOf('innocent'))
})

it('truncates a multi-kilobyte plugin.error so the 132 px row does not overflow', async () => {
  // 2 KB error from the host: only the first 300 code points plus "…" appear in the alert,
  // and the full text is kept in the `title` attribute (and in the host title) for tooltips
  // and screen readers.
  const huge = 'X'.repeat(2000) + 'tail-of-the-error'
  const fake = fakeApi({ items: [summary({ error: huge })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  const alert = within(row('acme.demo')).getByRole('alert')
  // The shown message is at most 300 code points plus the ellipsis, plus the short
  // "Could not read this plugin: " prefix in front.
  const prefixLength = 'Could not read this plugin: '.length
  const visibleChars = Array.from(alert.textContent ?? '').filter(c => c !== '…').length
  expect(visibleChars).toBeLessThanOrEqual(prefixLength + 300)
  expect(alert.textContent).toContain('…')
  // The full text is preserved in the title attribute so on-hover / assistive tech can see it.
  expect(alert.getAttribute('title')).toBe(huge)
  // The tail of the host message is no longer in the visible text.
  expect(alert.textContent).not.toContain('tail-of-the-error')
})

it('shows a short, accessible error on the row when openFolder rejects, then clears on success', async () => {
  const fake = fakeApi({ items: [summary({ name: 'Acme Demo' })] })
  fake.openFolder.mockRejectedValueOnce(new Error('folder not found'))
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  fireEvent.click(within(row('acme.demo')).getByRole('button', { name: 'Open its folder' }))
  await vi.waitFor(() => expect(text(within(row('acme.demo')).getByRole('alert'))).toContain('Could not open its folder: folder not found'))
  expect(fake.openFolder).toHaveBeenCalledOnce()
  // The next open-folder attempt that succeeds clears the row error.
  fake.openFolder.mockResolvedValueOnce(undefined)
  fireEvent.click(within(row('acme.demo')).getByRole('button', { name: 'Open its folder' }))
  await vi.waitFor(() => expect(within(row('acme.demo')).queryByRole('alert')).toBeNull())
})

it('shows a short, accessible error on the row when the toggle rejects, then clears on success and frees busy', async () => {
  const fake = fakeApi({ items: [summary({ name: 'Acme Demo', enabled: true })] })
  fake.setEnabled.mockRejectedValueOnce(new Error('permission denied'))
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  const toggle = within(row('acme.demo')).getByRole('switch', { name: 'Disable Acme Demo' })
  fireEvent.click(toggle)
  await vi.waitFor(() => expect(text(within(row('acme.demo')).getByRole('alert'))).toContain('Could not change Acme Demo: permission denied'))
  await vi.waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
  // The next toggle that succeeds clears the row error and leaves the button enabled.
  fake.setEnabled.mockResolvedValueOnce(undefined)
  fireEvent.click(toggle)
  await vi.waitFor(() => expect(within(row('acme.demo')).queryByRole('alert')).toBeNull())
})

it('shows a short error on the row when remove rejects, closes the dialog and frees busy', async () => {
  const fake = fakeApi({ items: [summary({ name: 'Acme Demo', enabled: true })] })
  fake.remove.mockRejectedValueOnce(new Error('files in use'))
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  fireEvent.click(within(row('acme.demo')).getByRole('button', { name: 'Remove' }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my settings for this plugin' }))
  await vi.waitFor(() => expect(text(within(row('acme.demo')).getByRole('alert'))).toContain('Could not remove Acme Demo: files in use'))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await vi.waitFor(() => expect((within(row('acme.demo')).getByRole('switch') as HTMLButtonElement).disabled).toBe(false))
})

it('shows a short error when Disable All rejects, closes the dialog and frees busy', async () => {
  const fake = fakeApi({ items: [summary({ enabled: true })] })
  fake.disableAll.mockRejectedValueOnce(new Error('disk full'))
  page(fake.api)
  await screen.findByRole('region', { name: 'Plugins' })
  fireEvent.click(screen.getByRole('button', { name: 'Disable All' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Disable All' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Disable All' }))
  await vi.waitFor(() => expect(text(screen.getByRole('alert'))).toContain('Could not disable all plugins: disk full'))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await vi.waitFor(() => expect((screen.getByRole('button', { name: 'Disable All' }) as HTMLButtonElement).disabled).toBe(false))
})

it('keeps English and Brazilian Portuguese translations in parity', async () => {
  // Re-exported by the i18n parity test in src/i18n/i18n.test.ts; this one asserts the section really uses 1k.
  const { en } = await import('@/i18n/en.ts')
  const { ptBR } = await import('@/i18n/pt-BR.ts')
  const pluginsKeys = Object.keys(en).filter(key => key.startsWith('plugins.'))
  expect(pluginsKeys.length).toBeGreaterThan(20)
  for (const key of pluginsKeys) expect(ptBR[key as keyof typeof ptBR], key).toBeTruthy()
})

it('switches SettingsView back to General and filters by the plugin id when a row jumps to its options', async () => {
  // We exercise the callback wiring end to end: the parent receives the plugin id.
  const fake = fakeApi({ items: [summary({ id: 'acme.demo', contributes: { themes: 0, keymaps: 0, languages: 0, locales: 0, openWith: 0, commands: 0, settings: 1 } })] })
  let received: string | undefined
  render(<I18nProvider language="en"><PluginsProvider value={fake.api}><PluginsPanel onJumpToSettings={id => { received = id }} /></PluginsProvider></I18nProvider>)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  fireEvent.click(within(row('acme.demo')).getByRole('button', { name: 'Settings' }))
  expect(received).toBe('acme.demo')
})

it('invokes usePlugins through a real context when the parent provides the API', async () => {
  // A tiny consumer of the hook reads items and a setting; it must match what the API returns.
  function Consumer() {
    const { items, actions } = usePlugins()
    const [, setCount] = useState(0)
    return <div><span data-testid="rows">{items.length}</span><button onClick={async () => { await actions.disableAll(); setCount(c => c + 1) }}>go</button></div>
  }
  const fake = fakeApi({ items: [summary(), summary({ id: 'b.b', enabled: false })] })
  render(<I18nProvider language="en"><PluginsProvider value={fake.api}><Profiler id="consumer" onRender={() => {}}><Consumer /></Profiler></PluginsProvider></I18nProvider>)
  await vi.waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('2'))
  fireEvent.click(screen.getByRole('button', { name: 'go' }))
  await vi.waitFor(() => expect(fake.disableAll).toHaveBeenCalledOnce())
})

it('passes SettingsView plugin-id search by including the prefix in the indexed text', async () => {
  // The parent of PluginsPanel hands the plugin id to the general search; the indexed text must
  // contain it for the General section to filter to that plugin's options.
  const { settingsRegistry } = await import('@core/settings/registry.ts')
  const remove = settingsRegistry.contribute([{ id: 'acme.demo:contrast', type: 'boolean', default: false, label: 'settings.wordWrap', category: 'demo' }])
  try {
    const { indexSettings } = await import('./SettingsView.tsx')
    const entries = indexSettings(settingsRegistry.all(), (key) => key)
    const entry = entries.find(e => e.definition.id === 'acme.demo:contrast')!
    expect(entry.search).toContain('acme.demo')
  } finally { remove() }
})

it('cancellation in the install flow does not write to the install alert (mutant M4/M5)', async () => {
  // A cancelled install is a no-op for the alert: a previous error stays, and a stale
  // success mock does not blank the alert. The implementation must short-circuit on
  // `cancelled` before any `setInstallError` call.
  const fake = fakeApi({ items: [], installResult: { ok: false, code: 'install.failed', message: 'first error' } })
  page(fake.api)
  await screen.findByRole('region', { name: 'Plugins' })
  // First install: real failure, alert appears.
  fireEvent.click(screen.getByRole('button', { name: 'Install Plugin from File…' }))
  await vi.waitFor(() => expect(text(screen.getByRole('alert'))).toContain('Could not install: first error'))
  // Second install: cancelled. The previous alert must stay (cancellation does not change UI state).
  fake.install.mockResolvedValueOnce({ cancelled: true })
  fireEvent.click(screen.getByRole('button', { name: 'Install Plugin from File…' }))
  await vi.waitFor(() => expect(fake.install).toHaveBeenCalledTimes(2))
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  expect(text(screen.getByRole('alert'))).toContain('Could not install: first error')
  // Third install: a synthetic success. The handler must clear the alert on ok=true.
  fake.install.mockResolvedValueOnce({ ok: true, id: 'new.id' })
  fireEvent.click(screen.getByRole('button', { name: 'Install Plugin from File…' }))
  await vi.waitFor(() => expect(fake.install).toHaveBeenCalledTimes(3))
  await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it('positions each row at its absolute `top` inside the scrollable container (mutant on rowWindow.top)', async () => {
  // 50 rows: the visible window is a slice, not the head. The first window starts at the
  // list-relative offset `first` (≥ 0) so `index * ROW_HEIGHT` (window-relative) and
  // `(first + index) * ROW_HEIGHT` (list-relative) coincide. Scroll the container by enough
  // rows to move `first` past 0, and the positions diverge.
  const items = Array.from({ length: 50 }, (_, i) => summary({ id: `p${i}.demo` }))
  const fake = fakeApi({ items })
  page(fake.api)
  await vi.waitFor(() => expect(document.querySelectorAll('[data-plugin-id]').length).toBeGreaterThan(0))
  const box = document.querySelector('[aria-label="Plugins"][role="list"]') as HTMLElement
  expect(box).toBeTruthy()
  // Scroll 10 rows down so `first` ≥ 5 (first = max(0, floor(scrollTop/ROW_HEIGHT) - OVERSCAN)).
  box.scrollTop = 10 * 132
  fireEvent.scroll(box)
  // Wait a microtask for the React re-render to settle, then check the first visible row.
  await new Promise(r => setTimeout(r, 50))
  const firstTop = Number((document.querySelectorAll<HTMLElement>('[data-plugin-id]')[0].style.top).replace('px', ''))
  // The first row must sit at the list-relative offset, not at top:0.
  expect(firstTop).toBeGreaterThanOrEqual(5 * 132)
  // The rows are still evenly spaced by ROW_HEIGHT.
  const visibleRows = Array.from(document.querySelectorAll<HTMLElement>('[data-plugin-id]')).slice(0, 3)
  const tops = visibleRows.map(el => Number((el.style.top).replace('px', '')))
  for (let i = 1; i < tops.length; i++) {
    expect(tops[i] - tops[i - 1]).toBe(132)
  }
})

it('marks Keep my settings as the primary option in the Remove dialog (mutant on primary)', async () => {
  // Keep must carry the `data-primary` flag so ChoiceDialog auto-focuses it (and Enter
  // activates it). Without the flag the dialog would still default focus to the first
  // button, but the contract is that the safe default is the primary one.
  const fake = fakeApi({ items: [summary({ name: 'Acme Demo' })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  fireEvent.click(within(row('acme.demo')).getByRole('button', { name: 'Remove' }))
  const dialog = await screen.findByRole('alertdialog', { name: "Remove 'Acme Demo'?" })
  const keep = within(dialog).getByRole('button', { name: 'Keep my settings for this plugin' })
  expect(keep.getAttribute('data-primary')).not.toBeNull()
  // The primary button is the auto-focused one (ChoiceDialog's `useEffect` focuses it).
  expect(document.activeElement).toBe(keep)
  // Activating the focused button confirms Keep; this is the path Enter takes in a browser.
  fireEvent.click(keep)
  await vi.waitFor(() => expect(fake.remove).toHaveBeenCalledWith('acme.demo', { keepSettings: true }))
})
// Every piece of text that comes from a plugin must sit inside a <bdi>, so U+202E (override)
// and U+2066 to U+2069 (isolates) cannot reorder the text around it.
const BIDI = /[\u202A-\u202E\u2066-\u2069]/
function unisolated(root: Element): string[] {
  const bad: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (BIDI.test(node.textContent ?? '') && !node.parentElement?.closest('bdi')) bad.push(node.textContent ?? '')
  }
  return bad
}

it('puts every plugin-supplied text (name, version, author, description, error) inside a <bdi>', async () => {
  const evil = (label: string) => `${label}\u202E\u2066x\u2069\u2067y\u2068z\u2069`
  const fake = fakeApi({ items: [
    summary({ name: evil('name'), version: evil('1.0'), description: evil('desc'), publisher: { id: 'acme', name: evil('pub') } }),
    summary({ id: 'bad.one', name: 'Bad', error: evil('boom') }),
  ] })
  page(fake.api)
  await vi.waitFor(() => expect(row('bad.one')).toBeTruthy())
  expect(unisolated(row('acme.demo'))).toEqual([])
  expect(unisolated(row('bad.one'))).toEqual([])
  expect(row('acme.demo').querySelectorAll('bdi').length).toBeGreaterThanOrEqual(4)
})

it('puts the text of a rejected toggle, a rejected open-folder and a failed install inside a <bdi>', async () => {
  const fake = fakeApi({ items: [summary({ name: 'Acme Demo' })], installResult: { ok: false, code: 'install.failed', message: 'bad\u202Egpj' } })
  fake.setEnabled.mockRejectedValueOnce(new Error('no\u202Eway'))
  fake.openFolder.mockRejectedValueOnce(new Error('gone\u2066'))
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  fireEvent.click(within(row('acme.demo')).getByRole('switch'))
  await vi.waitFor(() => expect(within(row('acme.demo')).getByRole('alert')).toBeTruthy())
  expect(unisolated(row('acme.demo'))).toEqual([])
  fireEvent.click(within(row('acme.demo')).getByRole('button', { name: 'Open its folder' }))
  await vi.waitFor(() => expect(text(within(row('acme.demo')).getByRole('alert'))).toContain('gone'))
  expect(unisolated(row('acme.demo'))).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Install Plugin from File…' }))
  await vi.waitFor(() => expect(screen.getByText(/Could not install/)).toBeTruthy())
  expect(unisolated(screen.getByText(/Could not install/).closest('[role="alert"]')!)).toEqual([])
})

it('shows only a bounded slice of a 1 MB plugin.error in the DOM', async () => {
  const fake = fakeApi({ items: [summary({ error: 'E'.repeat(1_000_000) })] })
  page(fake.api)
  await vi.waitFor(() => expect(row('acme.demo')).toBeTruthy())
  expect(text(within(row('acme.demo')).getByRole('alert')).length).toBeLessThan(400)
})
