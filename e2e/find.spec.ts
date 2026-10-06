import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test'
import { writeSampleWsnp, writeViewerWsnp } from '../fixtures/build.ts'

// End-to-end: Find, Copy, Print and the two icons of the activity bar, in every kind of tab.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let app: ElectronApplication | undefined

test.beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-find-'))))
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(env: Record<string, string> = {}): Promise<Page> {
  const file = path.join(dir, 'viewer.wsnp')
  await writeViewerWsnp(file, { title: 'Harbor Times', url: 'https://harbortimes.example/' })
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, file], env: { ...process.env, ...env } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByRole('tab').first().waitFor()
  // The page has to be there before anything is asked of it.
  await page.frameLocator('iframe').locator('#end').waitFor()
  return page
}
async function openFile(page: Page, folder: string[], name: string) {
  for (const f of folder) {
    const item = page.getByRole('treeitem', { name: f, exact: true })
    if ((await item.getAttribute('aria-expanded')) === 'false') await item.click()
  }
  await page.getByRole('treeitem', { name, exact: true }).dblclick()
}
const pageFrame = (page: Page): Frame => page.frames().find((f) => f.url().startsWith('wsnp://'))!
const selectionOfPage = (page: Page) => pageFrame(page).evaluate(() => String(getSelection()))
const findBox = (page: Page) => page.getByRole('textbox', { name: 'Find' })
const counter = (page: Page, text: string | RegExp) => page.getByRole('search').getByText(text)
const clipboard = () => app!.evaluate(({ clipboard }) => clipboard.readText())
const editMenu = async (page: Page, item: RegExp) => {
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: item }).click()
}

test.describe('Find', () => {
  test('in the page of a snapshot: Ctrl+F, the matches are selected in the page one after the other, with a wrap, and Escape clears them', async () => {
    const page = await launch()
    await page.keyboard.press('ControlOrMeta+f')
    await expect(findBox(page)).toBeFocused()
    await findBox(page).fill('end')
    await expect(counter(page, '1 of 2')).toBeVisible()
    await expect.poll(() => selectionOfPage(page)).toBe('end')
    await page.keyboard.press('Enter')
    await expect(counter(page, '2 of 2')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(counter(page, '1 of 2')).toBeVisible()
    await page.keyboard.press('Shift+Enter')
    await expect(counter(page, '2 of 2')).toBeVisible()
    await page.getByRole('button', { name: 'Match Case' }).click()
    await findBox(page).fill('End')
    await expect(counter(page, 'No results')).toBeVisible()
    await findBox(page).fill('nothing of the sort')
    await expect(counter(page, 'No results')).toBeVisible()
    await findBox(page).fill('the')
    await expect(counter(page, /^1 of \d+$/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('search')).toHaveCount(0)
    await expect.poll(() => selectionOfPage(page)).toBe('')
  })

  test('from the Edit menu, and Find and Copy are enabled with a tab open', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /^Copy/ })).toBeEnabled()
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /^Find/ })).toBeEnabled()
    await page.getByRole('menu').getByRole('menuitem', { name: /^Find/ }).click()
    await expect(page.getByRole('search')).toBeVisible()
    await expect(findBox(page)).toBeFocused()
  })

  test('in a source file, over the whole text: each match is counted, the current one is drawn apart and scrolled into view', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'long.txt')
    await page.keyboard.press('ControlOrMeta+f')
    await findBox(page).fill('jack')
    await expect(counter(page, '1 of 60')).toBeVisible()
    await expect(page.locator('.cm-wsnpMatch-current')).toHaveText('jack')
    await page.keyboard.press('Shift+Enter')
    await expect(counter(page, '60 of 60')).toBeVisible()
    await expect(page.locator('.cm-wsnpMatch-current')).toBeInViewport()
    // The colour of a match is the theme's, not fixed.
    const dark = await page.locator('.cm-wsnpMatch-current').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(dark).not.toBe('rgba(0, 0, 0, 0)')
    await findBox(page).fill('THE END')
    await expect(counter(page, '1 of 1')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.cm-wsnpMatch')).toHaveCount(0)
  })

  test('in a PDF, over every page: a step goes to the page of the match', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'handbook.pdf')
    await expect(page.locator('canvas').first()).toBeVisible()
    await page.keyboard.press('ControlOrMeta+f')
    await findBox(page).fill('chapter')
    await expect(counter(page, '1 of 12')).toBeVisible()
    for (let i = 0; i < 4; i++) await page.keyboard.press('Enter')
    await expect(counter(page, '5 of 12')).toBeVisible()
    // The page of the match is on screen (the match itself is centred, so the page box may still read the page before).
    await expect(page.locator('[data-page="5"]')).toBeInViewport()
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.press('Shift+Enter')
    await expect(counter(page, '12 of 12')).toBeVisible()
    await expect(page.locator('[data-page="12"]')).toBeInViewport()
  })

  test('in the views drawn by the interface: Settings and the metadata', async () => {
    const page = await launch()
    await page.keyboard.press('ControlOrMeta+,')
    await page.keyboard.press('ControlOrMeta+f')
    await findBox(page).fill('word wrap')
    await expect(counter(page, /^1 of \d+$/)).toBeVisible()
    await page.getByRole('tab', { name: 'Harbor Times' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show Metadata' }).click()
    await expect(page.getByRole('tab', { selected: true })).toContainText('Metadata')
    // Each tab has its own search: the bar closed when the tab changed.
    await expect(page.getByRole('search')).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+f')
    await findBox(page).fill('harbor')
    await expect(counter(page, /^1 of \d+$/)).toBeVisible()
  })

  test('there is nothing to search in a picture: Find is off', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    await openFile(page, ['assets', 'images'], 'photo.png')
    await expect(page.getByRole('img', { name: 'photo.png' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+f')
    await expect(page.getByRole('search')).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /^Find/ })).toBeDisabled()
  })
})

test.describe('Copy', () => {
  test('what the page has selected goes to the clipboard from the Edit menu, though the focus is in the menu', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    await app!.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await pageFrame(page).evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('end')!)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(range)
    })
    await editMenu(page, /^Copy/)
    await expect.poll(clipboard).toBe('The end of the page.')
  })

  test('with nothing selected the clipboard is left as it was', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    await app!.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await editMenu(page, /^Copy/)
    await page.waitForTimeout(300)
    expect(await clipboard()).toBe('before')
  })

  test('the selection of a source file is copied, too', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'notes.md')
    // Markdown opens formatted; its source is the other button of the toolbar.
    await page.getByRole('button', { name: 'Show the Markdown as text' }).click()
    await expect(page.locator('.cm-content')).toContainText('# Notes')
    await page.locator('.cm-line').first().click({ clickCount: 3 })
    await app!.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await editMenu(page, /^Copy/)
    await expect.poll(clipboard).toContain('# Notes')
  })

  test('text of the views drawn by the interface is copied: a name in a ZIP’s list', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'bundle.zip')
    await page.getByRole('table').waitFor()
    await page.getByRole('cell', { name: 'top.txt', exact: true }).locator('span.truncate').evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(range)
    })
    await app!.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await editMenu(page, /^Copy/)
    await expect.poll(clipboard).toBe('top.txt')
  })
})

test.describe('Print and the activity bar', () => {
  const pdfAt = (file: string) => expect.poll(() => (fs.existsSync(file) ? fs.readFileSync(file).subarray(0, 5).toString() : ''), { timeout: 15000 }).toBe('%PDF-')

  test('the icons: Open Folder is there and Open File is not (Ctrl+O opens what the dialog answers); Print is off until there is something to print', async () => {
    const page = await launch()
    const bar = page.getByRole('navigation', { name: 'Activity Bar' })
    await expect(bar.getByRole('button', { name: 'Open Folder' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Open File…' })).toHaveCount(0)
    await expect(bar.getByRole('button', { name: 'Print…' })).toBeEnabled()
    const second = path.join(dir, 'second.wsnp')
    await writeSampleWsnp(second, { title: 'Second page', url: 'https://second.example/' })
    await app!.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as unknown as typeof dialog.showOpenDialog
    }, second)
    await page.keyboard.press('ControlOrMeta+o')
    await expect(page.getByRole('tab', { selected: true })).toContainText('Second page')
    await page.keyboard.press('ControlOrMeta+w')
    await page.keyboard.press('ControlOrMeta+w')
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(bar.getByRole('button', { name: 'Print…' })).toBeDisabled()
  })

  test('prints the page of the snapshot (from a view of its own, which goes away), a text as the tab shows it, and a picture', async () => {
    const out = path.join(dir, 'printed.pdf')
    const page = await launch({ WSNP_PRINT_TO: out })
    const bar = page.getByRole('navigation', { name: 'Activity Bar' })
    await bar.getByRole('button', { name: 'Print…' }).click()
    await pdfAt(out)
    expect(fs.statSync(out).size).toBeGreaterThan(1000)
    expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    fs.rmSync(out)
    await openFile(page, ['assets', 'files'], 'min.json')
    await expect(page.getByText('Formatted')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+p')
    await pdfAt(out)
    fs.rmSync(out)
    await openFile(page, ['assets', 'images'], 'photo.png')
    await expect(page.getByRole('img', { name: 'photo.png' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+p')
    await pdfAt(out)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('a ZIP’s list, a PDF and the metadata are not printed: the icon and the menu are off', async () => {
    const page = await launch()
    const bar = page.getByRole('navigation', { name: 'Activity Bar' })
    await openFile(page, ['assets', 'files'], 'bundle.zip')
    await page.getByRole('table').waitFor()
    await expect(bar.getByRole('button', { name: 'Print…' })).toBeDisabled()
    if (process.platform === 'darwin') return
    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /^Print/ })).toBeDisabled()
  })
})
