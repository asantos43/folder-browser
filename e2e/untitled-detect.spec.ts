import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: the language of a new text (Ctrl+N) is detected from what is pasted (issue #69), can be chosen by hand (and then the text never changes it), and comes back with the draft.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-untitled-detect-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\ntwo\nthree\n')
})
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {})
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...args: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, ...args], env: { ...process.env, XDG_DATA_HOME: path.join(dir, 'data') } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
const status = (page: Page) => page.locator('footer button[title="Select Language Mode"]')
const formatButton = (page: Page) => page.getByRole('button', { name: /Lay the text out for reading/ })
const draftFolder = () => path.join(dir, 'profile', 'drafts')
const draftTexts = () => (fs.existsSync(draftFolder()) ? fs.readdirSync(draftFolder()).filter((n) => n.endsWith('.json')).map((n) => fs.readFileSync(path.join(draftFolder(), n), 'utf8')) : [])

/** Puts a text on the clipboard and pastes it in the editor that has the focus. */
async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => (window as unknown as { fb: { copyText(t: string): Promise<void> } }).fb.copyText(t), text)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+v')
}

const HTML = '<!doctype html>\n<html>\n<head><title>Hi</title></head>\n<body><p>Hello, world</p></body>\n</html>\n'
const JSON_TEXT = '{"name": "folder-browser", "list": [1, 2, 3], "nested": {"a": true}}\n'

test('a pasted HTML is detected (the status bar says so and Format Document appears); choosing Plain Text stops the detection, and the choice comes back after a restart', async () => {
  const page = await launch(work)
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await expect(status(page)).toHaveText('Plain Text')
  await expect(formatButton(page)).toHaveCount(0)

  await paste(page, HTML)
  await expect(status(page)).toHaveText('HTML (detected)')
  await expect(formatButton(page)).toBeVisible()

  // A language chosen by hand is the user's: "(detected)" goes away, and a new paste does not change it.
  await status(page).click()
  await page.getByRole('combobox', { name: 'Select Language Mode' }).fill('plain')
  await page.getByRole('option', { name: /^Plain Text/ }).click()
  await expect(status(page)).toHaveText('Plain Text')
  await expect(formatButton(page)).toHaveCount(0)
  await paste(page, JSON_TEXT)
  await expect(page.locator('.cm-content')).toContainText('folder-browser')
  // Longer than the pause of the detection, which would have run by now.
  await page.waitForTimeout(800)
  await expect(status(page)).toHaveText('Plain Text')
  await expect(formatButton(page)).toHaveCount(0)

  // The draft has the choice; the window closes without asking and the next start brings it back.
  await expect.poll(() => draftTexts().some((t) => t.includes('"manual":true'))).toBe(true)
  await Promise.all([page.waitForEvent('close'), app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())])
  await app!.close().catch(() => {})
  app = undefined

  const again = await launch()
  await expect(again.getByRole('tab', { name: /^Untitled-1/ })).toBeVisible()
  await expect(again.locator('.cm-content')).toContainText('folder-browser')
  await expect(status(again)).toHaveText('Plain Text')
  await expect(formatButton(again)).toHaveCount(0)
})

test('Auto Detect gives the language back to the text', async () => {
  const page = await launch(work)
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await paste(page, HTML)
  await expect(status(page)).toHaveText('HTML (detected)')
  await status(page).click()
  await page.getByRole('combobox', { name: 'Select Language Mode' }).fill('plain')
  await page.getByRole('option', { name: /^Plain Text/ }).click()
  await expect(status(page)).toHaveText('Plain Text')
  await status(page).click()
  await page.getByRole('option', { name: /^Auto Detect/ }).click()
  await expect(status(page)).toHaveText('HTML (detected)')
})
