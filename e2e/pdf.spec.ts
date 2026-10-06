import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test'
import { writeViewerWsnp } from '../fixtures/build.ts'
import { goToFile } from './helpers.ts'

// End-to-end: Save as PDF for the page, an HTML file, a text and a picture; and the menus of a right click in the page and in a text.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let app: ElectronApplication | undefined

test.beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-pdf-'))))
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
  // The page has to be there before anything is asked of it (a right click in a frame that is still loading is nobody's).
  await page.frameLocator('iframe').locator('#end').waitFor()
  return page
}
// (A snapshot has no tree of its files: a file opens by Go to File, as a link in its page would open it.)
async function openFile(page: Page, _folder: string[], name: string) {
  await goToFile(page, name)
}
/** The save dialog is answered by the main process, which keeps what it was asked. */
async function answerSave(to: string) {
  await app!.evaluate(({ dialog }, target) => {
    const g = globalThis as unknown as { __saveOptions: unknown }
    dialog.showSaveDialog = (async (_w: unknown, opts: unknown) => ((g.__saveOptions = opts), { canceled: false, filePath: target })) as unknown as typeof dialog.showSaveDialog
  }, to)
}
const suggested = async () => ((await app!.evaluate(() => (globalThis as unknown as { __saveOptions: { defaultPath: string } }).__saveOptions)) as { defaultPath: string }).defaultPath
const isPdf = (file: string) => expect.poll(() => (fs.existsSync(file) ? fs.readFileSync(file).subarray(0, 5).toString() : ''), { timeout: 15000 }).toBe('%PDF-')
const fileMenu = async (page: Page, name: RegExp) => {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menu').getByRole('menuitem', { name }).click()
}
const pageFrame = (page: Page): Frame => page.frames().find((f) => f.url().startsWith('wsnp://'))!
const clipboard = () => app!.evaluate(({ clipboard }) => clipboard.readText())
/** A right click at a place of the window, as a person would make it: through the DevTools protocol, which reaches a page in its own process (Electron's sendInputEvent stays in the interface). */
async function rightClick(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 })
  await cdp.detach()
}

test.describe('Save as PDF', () => {
  test('the page of the snapshot, named after its title', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    const out = path.join(dir, 'page.pdf')
    await answerSave(out)
    await fileMenu(page, /^Save as PDF/)
    await expect(page.getByRole('status')).toContainText('Saved page.pdf.')
    await isPdf(out)
    expect(fs.statSync(out).size).toBeGreaterThan(1000)
    expect(await suggested()).toBe('Harbor Times.pdf')
    // The view that drew it is gone, and so is nothing else: the interface is where it was.
    expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await expect(page.getByRole('tab')).toHaveCount(1)
  })

  test('an HTML file as the page it is, a text as the tab shows it, a picture as a picture', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'page.html')
    await expect(page.locator('.cm-content')).toContainText('<title>t</title>')
    const html = path.join(dir, 'html.pdf')
    await answerSave(html)
    await fileMenu(page, /^Save as PDF/)
    await isPdf(html)
    expect(await suggested()).toBe('page.pdf')

    await openFile(page, ['assets', 'files'], 'notes.md')
    // Markdown opens formatted; its source is the other button of the toolbar.
    await page.getByRole('button', { name: 'Show the Markdown as text' }).click()
    await expect(page.locator('.cm-content')).toContainText('# Notes')
    const text = path.join(dir, 'text.pdf')
    await answerSave(text)
    await fileMenu(page, /^Save as PDF/)
    await isPdf(text)
    expect(await suggested()).toBe('notes.pdf')

    await openFile(page, ['assets', 'images'], 'photo.png')
    await expect(page.getByRole('img', { name: 'photo.png' })).toBeVisible()
    const image = path.join(dir, 'image.pdf')
    await answerSave(image)
    await fileMenu(page, /^Save as PDF/)
    await isPdf(image)
    expect(fs.statSync(image).size).toBeGreaterThan(500)
  })

  test('a ZIP’s list and the metadata cannot be saved as a PDF, and the menu says so', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'bundle.zip')
    await page.getByRole('table').waitFor()
    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /^Save as PDF/ })).toBeDisabled()
  })

  test('a cancelled dialog writes nothing and says nothing', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    await app!.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true })) as unknown as typeof dialog.showSaveDialog
    })
    await fileMenu(page, /^Save as PDF/)
    await page.waitForTimeout(400)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveCount(0)
  })
})

test.describe('the menu of a right click', () => {
  test('in the page of a snapshot: Select All, Copy, Print and Save as PDF, where the click was', async () => {
    // Not yet seen to work on macOS: a right click made through the DevTools protocol in the page's frame brings up no menu there (the text file's does).
    test.skip(process.platform === 'darwin', 'right click inside a frame, unverified on macOS')
    const out = path.join(dir, 'printed.pdf')
    const page = await launch({ WSNP_PRINT_TO: out })
    const box = (await page.locator('iframe').boundingBox())!
    const at = { x: box.x + 200, y: box.y + 150 }
    await rightClick(page, at.x, at.y)
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText([/^Select All/, /^Copy/, /^Print…/, /^Save as PDF…/])
    const where = (await menu.boundingBox())!
    expect(Math.abs(where.x - at.x)).toBeLessThan(40)
    expect(Math.abs(where.y - at.y)).toBeLessThan(40)
    // Nothing is selected yet, so there is nothing to copy.
    await expect(menu.getByRole('menuitem', { name: /^Copy/ })).toBeDisabled()
    await menu.getByRole('menuitem', { name: /^Select All/ }).click()
    await expect.poll(() => pageFrame(page).evaluate(() => String(getSelection()).includes('The end of the page.'))).toBe(true)
    await app!.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await rightClick(page, at.x, at.y)
    await page.getByRole('menu').getByRole('menuitem', { name: /^Copy/ }).click()
    await expect.poll(clipboard).toContain('The end of the page.')
    await rightClick(page, at.x, at.y)
    await page.getByRole('menu').getByRole('menuitem', { name: /^Print…/ }).click()
    await isPdf(out)
    const pdf = path.join(dir, 'from-menu.pdf')
    await answerSave(pdf)
    await rightClick(page, at.x, at.y)
    await page.getByRole('menu').getByRole('menuitem', { name: /^Save as PDF…/ }).click()
    await isPdf(pdf)
  })

  test('no item is lit when it opens; the one under the pointer is lit, and only that one, also once the keys are used', async () => {
    // Not yet seen to work on macOS: a right click made through the DevTools protocol in the page's frame brings up no menu there (the text file's does).
    test.skip(process.platform === 'darwin', 'right click inside a frame, unverified on macOS')
    const page = await launch()
    const box = (await page.locator('iframe').boundingBox())!
    await rightClick(page, box.x + 200, box.y + 150)
    const menu = page.getByRole('menu')
    const lit = () => menu.locator('[role=menuitem][data-active=true]')
    await expect(menu.getByRole('menuitem').first()).toBeVisible()
    await expect(lit()).toHaveCount(0)
    await menu.getByRole('menuitem', { name: /^Print…/ }).hover()
    await expect(lit()).toHaveCount(1)
    await expect(lit()).toHaveText(/^Print…/)
    // The keys take over from the pointer: one item still, now the next.
    await page.keyboard.press('ArrowDown')
    await expect(lit()).toHaveCount(1)
    await expect(lit()).toHaveText(/^Save as PDF…/)
    await page.keyboard.press('Home')
    await expect(lit()).toHaveText(/^Select All/)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })

  test('in a text file: Select All and Copy, and Copy copies all of the text', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'long.txt')
    await expect(page.locator('.cm-content')).toContainText('THE END')
    await page.locator('.cm-content').click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText([/^Select All/, /^Copy/])
    await expect(menu.getByRole('menuitem', { name: /^Copy/ })).toBeDisabled()
    await menu.getByRole('menuitem', { name: /^Select All/ }).click()
    await app!.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await page.locator('.cm-content').click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: /^Copy/ }).click()
    await expect.poll(clipboard).toBe(`${'all work and no play makes jack a dull boy '.repeat(60)}THE END\nsecond line\n`)
  })

  test('Escape closes it, and a click elsewhere too', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'long.txt')
    await page.locator('.cm-content').click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.locator('.cm-content').click({ button: 'right' })
    await page.getByRole('tab').first().click()
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
})
