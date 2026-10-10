import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeSampleWsnp, writeViewerWsnp } from '../fixtures/build.ts'
import { goToFile } from './helpers.ts'

// End-to-end: the arrows and the box of the title bar, the command palette, and reopening what was open.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let app: ElectronApplication | undefined

let made = false
test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-nav-'))
  made = false
})
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const viewer = () => path.join(dir, 'viewer.wsnp')
const second = () => path.join(dir, 'second.wsnp')
async function files() {
  if (made) return
  made = true
  await writeViewerWsnp(viewer(), { title: 'Meadow Times', url: 'https://meadowtimes.example/' })
  await writeSampleWsnp(second(), { title: 'Second page', url: 'https://second.example/' })
}
async function launch(...args: string[]): Promise<Page> {
  await files()
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, ...args] })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  // With files named, the interface is ready when they are open (a slow machine opens them after the window is there).
  if (args.length) await expect(tabs(page).first()).toBeVisible()
  return page
}
const tabs = (page: Page) => page.getByRole('tab')
const selected = (page: Page) => page.getByRole('tab', { selected: true })
const back = (page: Page) => page.getByRole('button', { name: 'Go Back' })
const forward = (page: Page) => page.getByRole('button', { name: 'Go Forward' })
const box = (page: Page) => page.getByTestId('titlebar').locator('button', { has: page.locator('span.truncate') })

test.describe('the title bar', () => {
  test('the arrows are off at first, then walk back and forward through the tabs visited; Alt+Left and Alt+Right do the same', async () => {
    const page = await launch(viewer(), second())
    await expect(tabs(page)).toHaveCount(2)
    await expect(back(page)).toBeDisabled()
    await expect(forward(page)).toBeDisabled()
    await tabs(page).first().click()
    await expect(selected(page)).toContainText('viewer.wsnp')
    await expect(back(page)).toBeEnabled()
    await back(page).click()
    await expect(selected(page)).toContainText('second.wsnp')
    await expect(back(page)).toBeDisabled()
    await expect(forward(page)).toBeEnabled()
    await forward(page).click()
    await expect(selected(page)).toContainText('viewer.wsnp')
    // (Alt+Left and Alt+Right; on macOS Control+- and Control+Shift+-, as in VS Code.)
    const [backKey, forwardKey] = process.platform === 'darwin' ? ['Control+-', 'Control+Shift+-'] : ['Alt+ArrowLeft', 'Alt+ArrowRight']
    await page.keyboard.press(backKey)
    await expect(selected(page)).toContainText('second.wsnp')
    await page.keyboard.press(forwardKey)
    await expect(selected(page)).toContainText('viewer.wsnp')
  })

  test('the arrows say what they do, with their keys', async () => {
    const page = await launch(viewer())
    await expect(back(page)).toHaveAttribute('title', /Go Back \((Alt\+Left|⌃-)\)/)
    await expect(forward(page)).toHaveAttribute('title', /Go Forward \((Alt\+Right|⌃⇧-)\)/)
    await expect(box(page)).toHaveAttribute('title', /Go to a file of the open snapshots, or type > for commands/)
  })

  test('the box opens Go to File: the tabs first, then any file of any open snapshot by part of its name', async () => {
    const page = await launch(viewer(), second())
    // (Both snapshots have to be open before there is anything to go to.)
    await expect(tabs(page)).toHaveCount(2)
    await box(page).click()
    const dialog = page.getByRole('dialog', { name: 'Go to File' })
    await expect(dialog.getByRole('option')).toHaveCount(2)
    await expect(dialog.getByRole('combobox')).toBeFocused()
    await dialog.getByRole('combobox').fill('hand')
    await expect(dialog.getByRole('option').first()).toContainText('handbook.pdf')
    await expect(dialog.getByRole('option').first()).toContainText('viewer.wsnp › assets/files')
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(selected(page)).toContainText('handbook.pdf')
    await expect(page.locator('canvas').first()).toBeVisible()
    // Files of the other snapshot are there too.
    await page.keyboard.press('ControlOrMeta+e')
    await page.getByRole('combobox', { name: 'Go to File' }).fill('logo')
    await expect(dialog.getByRole('option').first()).toContainText('logo.png')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(selected(page)).toContainText('logo.png')
  })

  test('Escape and a click outside close it; with no match it says so', async () => {
    const page = await launch(viewer())
    await box(page).click()
    await page.getByRole('combobox', { name: 'Go to File' }).fill('zzzzzz')
    await expect(page.getByText('No matching results')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await box(page).click()
    await page.mouse.click(700, 500)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Ctrl+Shift+P opens the palette: a command of the menus is found by part of its name and run; the themes are commands', async () => {
    const page = await launch(viewer())
    await page.keyboard.press('ControlOrMeta+Shift+p')
    const input = page.getByRole('combobox', { name: 'Go to File' })
    await expect(input).toHaveValue('>')
    await input.fill('>settings')
    await expect(page.getByRole('dialog').getByRole('option').first()).toContainText('Settings')
    await page.keyboard.press('Enter')
    await expect(selected(page)).toContainText('Settings')
    await page.keyboard.press('ControlOrMeta+Shift+p')
    await page.getByRole('combobox', { name: 'Go to File' }).fill('>color theme: light')
    await page.keyboard.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    // Commands that cannot run now are not offered.
    await page.keyboard.press('ControlOrMeta+Shift+p')
    await page.getByRole('combobox', { name: 'Go to File' }).fill('>save as .wsnp')
    await expect(page.getByText('No matching results')).toBeVisible()
  })

  test('the Go menu has the same: Go Back, Go Forward and Go to File', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch(viewer(), second())
    await page.getByRole('menuitem', { name: 'Go', exact: true }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /^Go Back/ })).toBeDisabled()
    await menu.getByRole('menuitem', { name: /^Go to File/ }).click()
    await expect(page.getByRole('dialog', { name: 'Go to File' })).toBeVisible()
  })
})

test.describe('reopening what was open', () => {
  test('the snapshots and files open at the end come back at the next start, in order, with the same tab in front', async () => {
    let page = await launch(viewer(), second())
    await goToFile(page, 'site.css')
    await expect(selected(page)).toContainText('site.css')
    await app!.close()
    page = await launch()
    await expect(tabs(page)).toHaveCount(3)
    await expect(selected(page)).toContainText('site.css')
    const names = await tabs(page).evaluateAll((els) => els.map((e) => e.querySelector('span.truncate')?.textContent ?? ''))
    // (A file opens beside the tab in front.)
    expect(names).toEqual(['viewer.wsnp', 'second.wsnp', 'site.css'])
    // The restored snapshots are checked like any other.
    await expect(page.getByRole('contentinfo')).toContainText(/Intact|Checking|problem/)
  })

  test('the tab in front, the metadata and a file in a ZIP are remembered too', async () => {
    let page = await launch(viewer())
    await goToFile(page, 'bundle.zip')
    await page.getByRole('table').waitFor()
    await page.getByRole('cell', { name: 'docs/readme.txt', exact: true }).dblclick()
    await expect(page.locator('.cm-content')).toContainText('the ferry leaves at noon')
    await app!.close()
    page = await launch()
    await expect(selected(page)).toContainText('readme.txt')
    await expect(page.locator('.cm-content')).toContainText('the ferry leaves at noon')
  })

  test('with a file named on the command line only that opens', async () => {
    let page = await launch(viewer())
    await app!.close()
    page = await launch(second())
    await expect(tabs(page)).toHaveCount(1)
    await expect(selected(page)).toContainText('second.wsnp')
  })

  test('nothing comes back after the last tab was closed on purpose', async () => {
    let page = await launch(viewer())
    await page.keyboard.press('ControlOrMeta+w')
    await expect(tabs(page)).toHaveCount(0)
    await app!.close()
    page = await launch()
    await expect(tabs(page)).toHaveCount(0)
  })

  test('the setting is in Settings; off, nothing is reopened, and nothing is kept', async () => {
    let page = await launch(viewer())
    await page.keyboard.press('ControlOrMeta+,')
    const box = page.getByRole('checkbox', { name: 'Reopen the files that were open' })
    await expect(box).toBeChecked()
    await box.uncheck()
    await page.getByRole('tab', { name: /viewer.wsnp/ }).click()
    await app!.close()
    page = await launch()
    await expect(tabs(page)).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('checkbox', { name: 'Reopen the files that were open' })).not.toBeChecked()
  })

  test('a snapshot that is gone is said, and the rest still opens', async () => {
    let page = await launch(viewer(), second())
    await app!.close()
    fs.rmSync(second())
    page = await launch()
    await expect(tabs(page)).toHaveCount(1)
    await expect(selected(page)).toContainText('viewer.wsnp')
    await expect(page.getByRole('alert')).toContainText('second.wsnp')
  })
})
