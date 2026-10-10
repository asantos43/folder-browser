import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let app: ElectronApplication | undefined
let dir: string
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-portable-e2e-')) })
test.afterEach(async () => {
  await app?.close().catch(() => {}); app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('exports, previews and applies an import, then resets through the real preload', async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env: { ...process.env, LANG: 'en_US.UTF-8', XDG_DATA_HOME: path.join(dir, 'data') } })
  const file = path.join(dir, 'export.json')
  // Only native file choosers are replaced; the UI, preload, IPC and store remain real.
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog
  }, file)
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  await page.keyboard.press('ControlOrMeta+,')
  const hidden = page.locator('[data-setting="files.showHidden"]').getByRole('checkbox')
  const wrap = page.locator('[data-setting="editor.wordWrap"]').getByRole('checkbox')
  await hidden.check()
  await page.getByRole('button', { name: 'Export…' }).click()
  await expect.poll(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8'))['files.showHidden']).toBe(true)
  await hidden.uncheck()
  await page.getByRole('button', { name: 'Import…' }).click()
  const summary = page.getByRole('alertdialog', { name: 'Import summary' })
  await expect(summary).toContainText('files.showHidden: false → true')
  await expect(hidden).not.toBeChecked()
  await summary.getByRole('button', { name: 'Apply' }).click()
  await expect(hidden).toBeChecked()
  await wrap.check()
  await page.getByRole('button', { name: 'Reset All…' }).click()
  const reset = page.getByRole('alertdialog', { name: 'Reset All…' })
  await expect(hidden).toBeChecked()
  await reset.getByRole('button', { name: 'Reset All…' }).click()
  await expect(hidden).not.toBeChecked(); await expect(wrap).not.toBeChecked()
  expect(await page.evaluate(() => window.fb!.settings.all()['files.showHidden'])).toBe(false)
})

test('export, then reset all, then import restores the choices (file on disk too)', async () => {
  const profile = path.join(dir, 'profile')
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env: { ...process.env, LANG: 'en_US.UTF-8', XDG_DATA_HOME: path.join(dir, 'data') } })
  const file = path.join(dir, 'export.json')
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog
  }, file)
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  await page.keyboard.press('ControlOrMeta+,')
  const hidden = page.locator('[data-setting="files.showHidden"]').getByRole('checkbox')
  const wrap = page.locator('[data-setting="editor.wordWrap"]').getByRole('checkbox')
  await hidden.check(); await wrap.check()
  await page.getByRole('button', { name: 'Export…' }).click()
  await expect.poll(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8'))['editor.wordWrap']).toBe(true)
  expect(fs.readdirSync(dir).filter(name => name.includes('.tmp'))).toEqual([])
  await page.getByRole('button', { name: 'Reset All…' }).click()
  await page.getByRole('alertdialog', { name: 'Reset All…' }).getByRole('button', { name: 'Reset All…' }).click()
  await expect(hidden).not.toBeChecked(); await expect(wrap).not.toBeChecked()
  await page.getByRole('button', { name: 'Import…' }).click()
  const summary = page.getByRole('alertdialog', { name: 'Import summary' })
  await expect(summary).toContainText('files.showHidden: false → true')
  await expect(summary).toContainText('editor.wordWrap: false → true')
  await summary.getByRole('button', { name: 'Apply' }).click()
  await expect(hidden).toBeChecked(); await expect(wrap).toBeChecked()
  await expect.poll(() => { try { const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')); return saved['files.showHidden'] === true && saved['editor.wordWrap'] === true } catch { return false } }).toBe(true)
})
