import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let app: ElectronApplication | undefined
let dir: string
const noSandbox = process.platform === 'linux' ? ['--no-sandbox'] : []
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-settings-e2e-')) })
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})
async function launch() {
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox], env: { ...process.env, LANG: 'en_US.UTF-8', XDG_DATA_HOME: path.join(dir, 'data') } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page.getByRole('searchbox', { name: 'Search settings' })).toBeVisible()
  return page
}

test('generated settings persist through the real preload across restarts, search and reset', async () => {
  let page = await launch()
  const hidden = () => page.locator('[data-setting="files.showHidden"]')
  await hidden().getByRole('checkbox').check()
  await expect(hidden().getByText('Modified', { exact: true })).toBeVisible()
  // Quit normally: exercises renderer batching, preload IPC and main-process flushing.
  await Promise.all([page.waitForEvent('close'), app!.evaluate(({ app }) => app.quit())])
  await app!.close().catch(() => {})
  app = undefined
  page = await launch()
  await expect(hidden().getByRole('checkbox')).toBeChecked()
  await page.getByRole('searchbox').fill('dot')
  await expect(hidden()).toBeVisible()
  await expect(page.locator('[data-setting="appearance.theme"]')).toHaveCount(0)
  await hidden().getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(hidden().getByRole('checkbox')).not.toBeChecked()
  await expect(hidden().getByText('Modified', { exact: true })).toHaveCount(0)
  await Promise.all([page.waitForEvent('close'), app!.evaluate(({ app }) => app.quit())])
  await app!.close().catch(() => {})
  app = undefined
  page = await launch()
  await expect(hidden().getByRole('checkbox')).not.toBeChecked()
})
