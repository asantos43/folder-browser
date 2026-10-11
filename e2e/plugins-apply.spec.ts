import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { buildPluginFolder, removePluginFixture } from '../fixtures/plugins.ts'

let app: ElectronApplication | undefined
let dir: string
const owner = 'acme.sample'
const theme = `${owner}:fixture`
const scheme = `${owner}/fixture-keys`
const optionId = `${owner}:mode`

test.beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-apply-e2e-')) })
test.afterEach(async () => {
  await close()
  await removePluginFixture(dir)
})

async function close() {
  if (!app) return
  // Normal quit exercises the settings host's flush-before-quit hook.
  await app.evaluate(({ app }) => app.quit())
  await app.close().catch(() => {})
  app = undefined
}

async function launch(profile = 'profile', confirmation = '1') {
  const start = performance.now()
  app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(dir, profile)}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, HOME: dir, XDG_DATA_HOME: path.join(dir, 'data'), XDG_CONFIG_HOME: path.join(dir, 'config'),
      LANG: 'en_US.UTF-8', FB_PLUGIN_TEST: '1', FB_TEST_PLUGIN_CONFIRM: confirmation },
  })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return { page, startup: performance.now() - start }
}

async function fixture(id = owner) {
  return buildPluginFolder(path.join(dir, 'sources', id), {
    files: {
      'theme.json': JSON.stringify({ 'vscode-foreground': '#123456' }),
      'keys.json': JSON.stringify([{ command: `${id}:hello`, key: 'Ctrl+Alt+Y' }]),
      // An empty catalog exercises French selection while retaining English fallback labels.
      'fr.json': JSON.stringify({}),
    },
    manifest: { id, name: 'Apply Fixture', texts: {
      'fixture.mode': { en: 'Fixture mode', 'pt-BR': 'Modo da amostra' },
      'fixture.normal': { en: 'Normal mode' }, 'fixture.high': { en: 'High mode' },
    }, contributes: {
      themes: [{ id: 'fixture', label: 'Fixture Theme', base: 'light', tokens: 'theme.json' }],
      commands: [{ id: `${id}:hello`, title: 'Fixture Command', palette: true,
        menu: { menu: 'menubar/tools', group: 'tools', order: 1 } }],
      keymaps: [{ id: 'fixture-keys', label: 'Fixture Keys', keys: 'keys.json' }],
      // A language belongs to one plugin: only the default fixture provides French.
      ...(id === owner ? { locales: [{ language: 'fr', label: 'Français', file: 'fr.json' }] } : {}),
      configuration: { title: 'Apply Fixture', properties: {
        mode: { type: 'enum', values: ['normal', 'high'], valueLabels: ['fixture.normal', 'fixture.high'],
          default: 'normal', label: 'fixture.mode' },
      } },
    }, activation: ['onStartupFinished'] },
  })
}

async function install(page: Page, source: string) {
  expect(await page.evaluate(source => window.fb!.plugins.installPaths([source]), source)).toMatchObject({ ok: true })
}

async function settings(page: Page, section: 'Settings' | 'Plugins' | 'Keyboard' = 'Settings') {
  await page.keyboard.press('ControlOrMeta+,')
  const view = page.locator('[data-settings-page]')
  await view.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: section, exact: true }).click()
  if (section === 'Settings') await view.getByRole('searchbox', { name: 'Search settings' }).fill('')
  return view
}

async function toolsMenu(page: Page, present: boolean) {
  if (process.platform === 'darwin') {
    await expect.poll(() => app!.evaluate(({ Menu }) => {
      const tools = Menu.getApplicationMenu()?.items.find(item => item.label === 'Tools')
      return tools?.submenu?.items.map(item => ({ label: item.label, enabled: item.enabled })) ?? []
    })).toEqual(present ? [{ label: 'Fixture Command', enabled: false }] : [])
  } else {
    const tools = page.getByRole('menubar').getByRole('menuitem', { name: 'Tools', exact: true })
    if (!present) { await expect(tools).toHaveCount(0); return }
    await expect(tools).toBeVisible()
    await tools.click()
    await expect(page.getByRole('menu', { name: 'Tools', exact: true }).getByRole('menuitem', { name: /Fixture Command/ })).toBeDisabled()
    await page.keyboard.press('Escape')
  }
}

async function palette(page: Page, present: boolean) {
  await page.keyboard.press('ControlOrMeta+Shift+p')
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('combobox') })
  await dialog.getByRole('combobox').fill('>Fixture Command')
  const command = dialog.getByRole('option', { name: /Fixture Command/ })
  if (present) {
    await expect(command).toHaveAttribute('aria-disabled', 'true')
    await expect(command).toContainText('Available in a future phase')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
  } else await expect(command).toHaveCount(0)
  await page.keyboard.press('Escape')
}

async function contributions(page: Page) {
  const view = await settings(page)
  await expect(view.getByRole('radio', { name: /Fixture Theme/ })).toBeVisible()
  await expect(view.getByRole('combobox', { name: 'Display Language', exact: true }).locator('option[value="fr"]')).toHaveText('Français')
  const option = view.locator(`[data-setting="${optionId}"]`)
  await expect(option.getByRole('combobox', { name: 'Fixture mode', exact: true })).toBeVisible()
  await expect(option.getByRole('combobox').locator('option[value="high"]')).toHaveText('High mode')
  await expect(view.getByRole('heading', { name: `Plugins ▸ ${owner}`, exact: true })).toBeVisible()
  await settings(page, 'Keyboard')
  await expect(page.getByRole('combobox', { name: 'Scheme', exact: true }).locator(`option[value="${scheme}"]`)).toContainText('Fixture Keys')
  await palette(page, true)
  await toolsMenu(page, true)
}

test('installs and applies every level 0 contribution in the interface', async () => {
  const { page } = await launch()
  await install(page, await fixture())
  await contributions(page)
  const view = await settings(page)
  await view.getByRole('radio', { name: /Fixture Theme/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme-plugin-preview', theme)
  await view.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-plugin-preview')
  await settings(page, 'Keyboard')
  await page.getByRole('combobox', { name: 'Scheme', exact: true }).selectOption(scheme)
  await expect(page.getByRole('combobox', { name: 'Scheme', exact: true })).toHaveValue(scheme)
})

async function choosePreferences(page: Page) {
  const view = await settings(page)
  await view.getByRole('radio', { name: /Fixture Theme/ }).click()
  await view.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme-plugin', theme)
  await view.getByRole('combobox', { name: 'Display Language', exact: true }).selectOption('fr')
  await settings(page, 'Keyboard')
  await page.getByRole('combobox', { name: 'Scheme', exact: true }).selectOption(scheme)
  await expect.poll(() => page.evaluate(() => window.fb!.settings.all())).toMatchObject({
    'appearance.themePlugin': `${owner}:${theme}`, 'keys.scheme': scheme, 'system.language': 'fr',
  })
}

test('restores contributions and selected theme and scheme after profile restarts', async () => {
  let { page } = await launch()
  await install(page, await fixture())
  await contributions(page)
  await close()
  ;({ page } = await launch())
  await contributions(page)
  await choosePreferences(page)
  await close()
  ;({ page } = await launch())
  await contributions(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme-plugin', theme)
  await expect(page.getByRole('combobox', { name: 'Scheme', exact: true })).toHaveValue(scheme)
  const view = await settings(page)
  await expect(view.getByRole('radio', { name: /Fixture Theme/ })).toBeChecked()
  await expect(view.getByRole('combobox', { name: 'Display Language', exact: true })).toHaveValue('fr')
})

test('disables contributions while retaining preferences, re-enables, then removes them', async () => {
  const { page } = await launch()
  await install(page, await fixture())
  await contributions(page)
  await choosePreferences(page)
  let view = await settings(page)
  await view.locator(`[data-setting="${optionId}"]`).getByRole('combobox').selectOption('high')
  await settings(page, 'Plugins')
  const row = page.locator(`[data-plugin-id="${owner}"]`)
  await row.getByRole('switch').click()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await palette(page, false)
  await toolsMenu(page, false)
  view = await settings(page)
  await expect(view.getByRole('radio', { name: /Fixture Theme/ })).toHaveCount(0)
  await expect(view.getByRole('note')).toContainText('Saved theme unavailable')
  await expect(view.getByRole('combobox', { name: 'Display Language', exact: true })).toHaveValue('fr')
  await expect(view.getByRole('status').filter({ hasText: 'The saved language fr is unavailable' })).toBeVisible()
  const option = view.locator(`[data-setting="${optionId}"]`)
  await expect(option).toHaveAttribute('aria-disabled', 'true')
  await expect(option.getByRole('combobox')).toBeDisabled()
  await expect(option.getByRole('combobox')).toHaveValue('high')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-plugin')
  await settings(page, 'Keyboard')
  const keys = page.getByRole('combobox', { name: 'Scheme', exact: true })
  await expect(keys).toHaveValue(scheme)
  await expect(keys.locator(`option[value="${scheme}"]`)).toHaveText(scheme)
  await expect(page.getByRole('alert').filter({ hasText: `Scheme ${scheme} is unavailable` })).toBeVisible()
  expect(await page.evaluate(() => window.fb!.settings.all())).toMatchObject({
    'appearance.themePlugin': `${owner}:${theme}`, 'system.language': 'fr', 'keys.scheme': scheme,
  })
  await settings(page, 'Plugins')
  await row.getByRole('switch').click()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await contributions(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme-plugin', theme)
  view = await settings(page)
  await expect(view.getByRole('note')).toHaveCount(0)
  await expect(option).not.toHaveAttribute('aria-disabled')
  await expect(option.getByRole('combobox', { name: 'Fixture mode', exact: true })).toHaveValue('high')
  await settings(page, 'Plugins')
  await row.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete my settings for this plugin', exact: true }).click()
  await expect(row).toHaveCount(0)
  expect(await page.evaluate(() => window.fb!.plugins.list())).toEqual([])
  await palette(page, false)
  await toolsMenu(page, false)
  view = await settings(page)
  await expect(option).toHaveCount(0)
  await expect(view.getByRole('radio', { name: /Fixture Theme/ })).toHaveCount(0)
  await expect(page.locator('style[data-theme-plugin-source], style[data-theme-plugin-preview-source]')).toHaveCount(0)
  await expect(view.getByRole('combobox', { name: 'Display Language', exact: true }).locator('option[value="fr"]')).toContainText('Unavailable')
  await settings(page, 'Keyboard')
  await expect(keys.locator(`option[value="${scheme}"]`)).toHaveText(scheme)
  const generation = await page.evaluate(() => window.fb!.plugins.generation())
  expect(generation.plugins).toEqual([])
})

test('cancels install confirmation without publishing files or contributions', async () => {
  // plugins-host.ts maps any nonempty test confirmation other than '1' to Cancel.
  // Drive the same native dialog adapter through IPC without production changes.
  const { page } = await launch('profile', '0')
  const before = await page.evaluate(() => window.fb!.plugins.generation())
  const result = await page.evaluate(source => window.fb!.plugins.installPaths([source]), await fixture())
  expect(result).toEqual({ cancelled: true })
  expect(await page.evaluate(() => window.fb!.plugins.list())).toEqual([])
  expect(await page.evaluate(() => window.fb!.plugins.generation())).toEqual(before)
  await settings(page, 'Plugins')
  await expect(page.getByRole('region', { name: 'Plugins' }).getByRole('listitem')).toHaveCount(0)
  await palette(page, false)
  await toolsMenu(page, false)
  const plugins = path.join(dir, 'profile', 'plugins')
  const index = await fs.readFile(path.join(plugins, 'installed.json'), 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '{"plugins":{}}'
    throw error
  })
  expect(JSON.parse(index).plugins).toEqual({})
})

test('uses real Tab, Space, Enter and Escape throughout the Plugins page', async () => {
  const { page } = await launch()
  await install(page, await fixture())
  await install(page, await fixture('acme.second'))
  const view = await settings(page, 'Plugins')
  const panel = page.getByRole('region', { name: 'Plugins', exact: true })
  await expect(panel.getByRole('listitem')).toHaveCount(2)
  // Anchor once at the active navigation button; all subsequent movement is native Tab.
  await view.getByRole('navigation').getByRole('button', { name: 'Plugins', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'Install Plugin from File…', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  const disableAll = panel.getByRole('button', { name: 'Disable All', exact: true })
  await expect(disableAll).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alertdialog', { name: 'Disable All', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  // Existing dialogs do not restore focus; anchor back before checking Tab order.
  await disableAll.focus()
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('searchbox', { name: 'Search by name, id or publisher' })).toBeFocused()
  const rows = panel.getByRole('listitem')
  for (let i = 0; i < 2; i++) {
    const row = rows.nth(i)
    const toggle = row.getByRole('switch')
    await page.keyboard.press('Tab')
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(toggle).toBeEnabled()
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(toggle).toBeEnabled()
    await page.keyboard.press('Tab')
    await expect(row.getByRole('button', { name: 'Settings', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(row.getByRole('button', { name: 'Open its folder', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    const remove = row.getByRole('button', { name: 'Remove', exact: true })
    await expect(remove).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alertdialog', { name: "Remove 'Apply Fixture'?", exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await remove.focus()
    await expect(row).toBeVisible()
  }
  expect(await page.evaluate(() => window.fb!.plugins.list().then(items => items.map(item => item.enabled)))).toEqual([true, true])
})

test('keeps startup with 50 small installed plugins below empty median × 1.5 + 300 ms', async () => {
  // Budget declared before measurement: launch → visible titlebar, three samples per
  // profile, median(50 owners) <= 1.5 × median(empty) + 300 ms. Setup is excluded.
  const sources: string[] = []
  for (let i = 0; i < 50; i++) {
    const id = `acme.startup-${i}`
    sources.push(await buildPluginFolder(path.join(dir, 'sources', id), {
      files: { 'theme.json': JSON.stringify({ 'vscode-foreground': '#123456' }) },
      manifest: { id, name: `Startup ${i}`, contributes: {
        themes: [{ id: 'small', label: `Small ${i}`, base: 'light', tokens: 'theme.json' }],
        commands: [{ id: `${id}:hello`, title: `Hello ${i}`, palette: true }],
      }, activation: ['onStartupFinished'] },
    }))
  }
  const setup = await launch('loaded')
  // Individual installs also validate that all 50 packages genuinely reach the index.
  for (const source of sources) await install(setup.page, source)
  await expect.poll(() => setup.page.evaluate(() => window.fb!.plugins.list().then(items => items.length))).toBe(50)
  await close()
  // Warm both profiles equally; alternate measured launches to reduce drift.
  for (const profile of ['empty', 'loaded']) { await launch(profile); await close() }
  const empty: number[] = []
  const loaded: number[] = []
  for (let round = 0; round < 3; round++) {
    for (const profile of round % 2 ? ['loaded', 'empty'] : ['empty', 'loaded']) {
      const { page, startup } = await launch(profile)
      ;(profile === 'empty' ? empty : loaded).push(startup)
      // After the timed milestone, prove startup actually restores the owners.
      await expect.poll(() => page.evaluate(() => window.fb!.plugins.generation().then(g => g.plugins.length))).toBe(profile === 'loaded' ? 50 : 0)
      await close()
    }
  }
  const median = (samples: number[]) => [...samples].sort((a, b) => a - b)[1]
  const limit = median(empty) * 1.5 + 300
  console.info(`plugin startup/titlebar: empty=${JSON.stringify(empty)} ms; 50=${JSON.stringify(loaded)} ms; medians=${median(empty).toFixed(1)}/${median(loaded).toFixed(1)} ms; limit=${limit.toFixed(1)} ms`)
  expect(median(loaded), '50-plugin startup median exceeds empty × 1.5 + 300 ms').toBeLessThanOrEqual(limit)
})
