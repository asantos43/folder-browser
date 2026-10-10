import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildPlugin, removePluginFixture } from '../fixtures/plugins.ts'

let app: ElectronApplication | undefined
let dir: string
test.beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-plugins-e2e-')) })
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  await removePluginFixture(dir)
})

async function launch(extra: Record<string, string> = {}) {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, HOME: dir, XDG_DATA_HOME: path.join(dir, 'data'), XDG_CONFIG_HOME: path.join(dir, 'config'), LANG: 'en_US.UTF-8', ...extra },
  })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}

// Bootstrap acceptance: the actual sandboxed preload talks to ipcMain in Electron.
// Kept beside the plugin lifecycle so a mock of both sides cannot satisfy this spec.
test('real preload reaches the main process before plugin integration', async () => {
  const page = await launch()
  await page.evaluate(() => window.fb!.settings.set([['files.showHidden', true]]))
  expect(await page.evaluate(() => window.fb!.settings.all()['files.showHidden'])).toBe(true)
})

test('installs, lists, disables and removes a synthetic plugin through the real preload and IPC', async () => {
  const file = path.join(dir, 'sample.fbplugin')
  await buildPlugin({ file })
  const page = await launch({ FB_PLUGIN_TEST: '1', FB_TEST_PLUGIN_PATH: file, FB_TEST_PLUGIN_CONFIRM: '1' })
  // Nothing plugin-related is read/created until its first request.
  expect(await fs.stat(path.join(dir, 'profile/plugins')).catch(() => null)).toBe(null)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Plugins' })
  await panel.getByRole('button', { name: 'Install Plugin from File…' }).click()
  const row = page.locator('[data-plugin-id="acme.sample"]')
  await expect(row).toBeVisible()
  await expect(row.getByText('Unsigned', { exact: true })).toBeVisible()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => JSON.parse(await fs.readFile(path.join(dir, 'profile/plugins/installed.json'), 'utf8')).plugins['acme.sample'].version).toBe('1.0.0')
  const record = JSON.parse(await fs.readFile(path.join(dir, 'profile/plugins/installed.json'), 'utf8')).plugins['acme.sample']
  await row.getByRole('switch', { name: 'Disable Sample' }).click()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await row.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByRole('button', { name: 'Keep my settings for this plugin' }).click()
  await expect(row).toHaveCount(0)
  expect(await page.evaluate(() => window.fb!.plugins.list())).toEqual([])
  // Real contextBridge subscription and its cancellation, not a mocked event bus.
  expect(await page.evaluate(async () => {
    let changes = 0
    const off = window.fb!.plugins.onChange(() => { changes++ })
    await window.fb!.plugins.disableAll()
    await new Promise(resolve => setTimeout(resolve, 30))
    off()
    await window.fb!.plugins.disableAll()
    await new Promise(resolve => setTimeout(resolve, 30))
    return changes
  })).toBe(1)
  // 100 bounded synthetic index records; an unreadable record remains visible.
  await fs.writeFile(path.join(dir, 'profile/plugins/installed.json'), JSON.stringify({ schema: 1,
    plugins: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`acme.plugin-${i}`, record])) }))
  const median = await page.evaluate(async () => {
    await window.fb!.plugins.list() // warm immutable index/summary cache
    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      if ((await window.fb!.plugins.list()).length !== 100) throw new Error('Expected 100 plugin summaries')
      samples.push(performance.now() - start)
    }
    return samples.sort((a, b) => a - b)[10]
  })
  console.info(`real plugin IPC/100 median: ${median.toFixed(3)} ms`)
  expect(median).toBeLessThan(16.7)
})
