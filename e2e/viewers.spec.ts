import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { BROKEN_PDF, LONG_PDF, writeViewerWsnp } from '../fixtures/build.ts'
import { goToFile } from './helpers.ts'

// End-to-end: the picture and PDF viewers, with their toolbars, in the real app.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let app: ElectronApplication | undefined

test.beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-view-'))))
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(): Promise<Page> {
  const file = path.join(dir, 'viewers.wsnp')
  await writeViewerWsnp(file, { title: 'Viewers' })
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, file] })
  const page = await app.firstWindow()
  await page.getByRole('tab').first().waitFor()
  return page
}
// (A snapshot has no tree of its files: a file opens by Go to File, as a link in its page would open it.)
async function openFile(page: Page, _folder: string[], name: string) {
  await goToFile(page, name)
}
async function stubSave(target: string) {
  await app!.evaluate(({ dialog }, to) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: to })) as unknown as typeof dialog.showSaveDialog
  }, target)
}
const toolbar = (page: Page) => page.getByRole('toolbar')
const percent = (page: Page) => toolbar(page).locator('[aria-live=polite]')
const cssWidth = (el: Locator) => el.evaluate((node) => parseFloat(getComputedStyle(node).width))
const box = (page: Page, name: string) => page.getByRole('img', { name, exact: true })

test.describe('pictures', () => {
  test('a picture has a toolbar with zoom, is fitted at first, and keeps its zoom when its tab is left and come back to', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'images'], 'photo.png')
    await expect(toolbar(page)).toBeVisible()
    await expect(page.getByText('320 × 160 pixels')).toBeVisible()
    // A picture that fits is shown at its own size ("Fit" never enlarges).
    await expect(percent(page)).toHaveText('100%')
    const image = page.getByRole('img', { name: 'photo.png', exact: true })
    expect(await cssWidth(image)).toBe(320)
    await page.getByRole('button', { name: 'Zoom In' }).click()
    await expect(percent(page)).toHaveText('110%')
    expect(await cssWidth(image)).toBeCloseTo(352)
    await page.getByRole('combobox', { name: 'Zoom' }).selectOption('2')
    await expect(percent(page)).toHaveText('200%')
    expect(await cssWidth(image)).toBe(640)
    await page.getByRole('button', { name: 'Zoom Out' }).click()
    await expect(percent(page)).toHaveText('175%')
    await page.getByRole('button', { name: 'Actual Size' }).click()
    await expect(percent(page)).toHaveText('100%')
    // Zoom is kept per tab: another tab, and back.
    await page.getByRole('combobox', { name: 'Zoom' }).selectOption('3')
    await page.getByRole('tab').first().click()
    await page.getByRole('tab', { name: /photo.png/ }).click()
    await expect(percent(page)).toHaveText('300%')
    await expect(page.getByRole('combobox', { name: 'Zoom' })).toHaveValue('3')
  })

  test('the zoom box offers fit modes; a small picture is not enlarged by "Fit" but is by "Fit Width"', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'images'], 'tiny.png')
    const image = page.getByRole('img', { name: 'tiny.png' })
    expect(await cssWidth(image)).toBe(8)
    // "Fit Width" does enlarge it, as far as the zoom goes (16 times).
    await page.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-width')
    expect(await cssWidth(image)).toBe(128)
    await page.getByRole('combobox', { name: 'Zoom' }).selectOption('auto')
    expect(await cssWidth(image)).toBe(8)
    await page.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-page')
    expect(await cssWidth(image)).toBe(128)
    await expect(percent(page)).toHaveText('1600%')
  })

  test('Ctrl and the wheel zoom, and + − 0 zoom from the keyboard, inside the limits', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'images'], 'photo.png')
    const area = page.getByLabel('photo.png', { exact: true }).first()
    await area.hover()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -200)
    await page.keyboard.up('Control')
    await expect.poll(async () => parseInt((await percent(page).textContent()) ?? '0')).toBeGreaterThan(100)
    await area.focus()
    await page.keyboard.press('0')
    await expect(percent(page)).toHaveText('100%')
    await page.keyboard.press('+')
    await expect(percent(page)).toHaveText('110%')
    await page.keyboard.press('-')
    await page.keyboard.press('-')
    await expect(percent(page)).toHaveText('90%')
    for (let i = 0; i < 30; i++) await page.keyboard.press('+')
    await expect(percent(page)).toHaveText('1600%')
    for (let i = 0; i < 40; i++) await page.keyboard.press('-')
    await expect(percent(page)).toHaveText('5%')
  })

  test('a picture can be saved from its toolbar, byte for byte', async () => {
    const page = await launch()
    const target = path.join(dir, 'saved-photo.png')
    await stubSave(target)
    await openFile(page, ['assets', 'images'], 'photo.png')
    await toolbar(page).getByRole('button', { name: 'Save As…' }).click()
    await expect(page.getByRole('status')).toContainText('Saved saved-photo.png.')
    const bytes = fs.readFileSync(target)
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(bytes.readUInt32BE(16)).toBe(320)
    expect(bytes.readUInt32BE(20)).toBe(160)
  })
})

test.describe('PDFs', () => {
  test('a PDF opens in a tab, drawn page by page, with its text selectable, and a toolbar', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'handbook.pdf')
    await expect(box(page, 'Page 1')).toBeVisible()
    await expect(box(page, 'Page 12')).toHaveCount(1)
    await expect(toolbar(page).getByLabel('Page', { exact: true })).toHaveValue('1')
    await expect(toolbar(page)).toContainText('of 12')
    // The first page is drawn, with its text in a layer that can be selected and copied.
    await expect.poll(() => page.locator('[data-page="1"] canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0)
    await expect(page.locator('[data-page="1"] .textLayer')).toContainText('Harbor handbook')
    await expect(page.locator('[data-page="1"] .textLayer')).toContainText('Chapter 1')
    // A page far away is not kept drawn.
    expect(await page.locator('[data-page="12"] canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBe(0)
  })

  test('zoom in and out, the zoom box, fit width and actual size change the size of the pages', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'handbook.pdf')
    const first = box(page, 'Page 1')
    await expect(first).toBeVisible()
    const start = await cssWidth(first)
    await page.getByRole('button', { name: 'Zoom In' }).click()
    await expect.poll(() => cssWidth(first)).toBeGreaterThan(start)
    const zoomed = await cssWidth(first)
    await page.getByRole('button', { name: 'Zoom Out' }).click()
    await page.getByRole('button', { name: 'Zoom Out' }).click()
    await expect.poll(() => cssWidth(first)).toBeLessThan(zoomed)
    await page.getByRole('button', { name: 'Actual Size' }).click()
    await expect(percent(page)).toHaveText('100%')
    expect(await cssWidth(first)).toBeCloseTo(595, 0)
    await page.getByRole('combobox', { name: 'Zoom' }).selectOption('2')
    await expect(percent(page)).toHaveText('200%')
    expect(await cssWidth(first)).toBeCloseTo(1190, 0)
    // The canvas is redrawn at the new size, not stretched.
    await expect.poll(() => page.locator('[data-page="1"] canvas').evaluate((c: HTMLCanvasElement) => c.width / parseFloat(c.style.width))).toBeGreaterThanOrEqual(1)
    await page.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-width')
    const scroller = page.getByLabel('handbook.pdf', { exact: true }).first()
    const room = await scroller.evaluate((el) => el.clientWidth)
    expect(await cssWidth(first)).toBeLessThanOrEqual(room)
    // Zoom is kept per tab.
    await page.getByRole('combobox', { name: 'Zoom' }).selectOption('1.5')
    await page.getByRole('tab').first().click()
    await page.getByRole('tab', { name: /handbook.pdf/ }).click()
    await expect(percent(page)).toHaveText('150%')
  })

  test('the page buttons and the page box go to a page, and the page being read is shown; far pages are let go of', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'handbook.pdf')
    await expect(box(page, 'Page 1')).toBeVisible()
    const pageBox = toolbar(page).getByLabel('Page', { exact: true })
    await expect(toolbar(page).getByRole('button', { name: 'Previous Page' })).toBeDisabled()
    await toolbar(page).getByRole('button', { name: 'Next Page' }).click()
    await expect(pageBox).toHaveValue('2')
    await pageBox.fill('12')
    await pageBox.press('Enter')
    await expect(pageBox).toHaveValue('12')
    await expect(toolbar(page).getByRole('button', { name: 'Next Page' })).toBeDisabled()
    await expect.poll(() => page.locator('[data-page="12"] canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0)
    await expect(page.locator('[data-page="12"] .textLayer')).toContainText('Chapter 12')
    expect(await page.locator('[data-page="1"] canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBe(0)
    // A number outside the document goes to the nearest page.
    await pageBox.fill('99')
    await pageBox.press('Enter')
    await expect(pageBox).toHaveValue('12')
    await pageBox.fill('0')
    await pageBox.press('Enter')
    await expect(pageBox).toHaveValue('1')
  })

  test('a PDF can be saved from its toolbar, byte for byte', async () => {
    const page = await launch()
    const target = path.join(dir, 'saved-handbook.pdf')
    await stubSave(target)
    await openFile(page, ['assets', 'files'], 'handbook.pdf')
    await expect(box(page, 'Page 1')).toBeVisible()
    await toolbar(page).getByRole('button', { name: 'Save As…' }).click()
    await expect(page.getByRole('status')).toContainText('Saved saved-handbook.pdf.')
    expect(fs.readFileSync(target).equals(LONG_PDF)).toBe(true)
  })

  test('a PDF that cannot be read says so, and can still be saved', async () => {
    const page = await launch()
    const target = path.join(dir, 'saved-broken.pdf')
    await stubSave(target)
    await openFile(page, ['assets', 'files'], 'broken.pdf')
    await expect(page.getByText('This PDF could not be read. It can still be saved.')).toBeVisible()
    await expect(toolbar(page).getByRole('button', { name: 'Next Page' })).toBeDisabled()
    await toolbar(page).getByRole('button', { name: 'Save As…' }).click()
    await expect(page.getByRole('status')).toContainText('Saved saved-broken.pdf.')
    expect(fs.readFileSync(target).equals(BROKEN_PDF)).toBe(true)
  })

  test('nothing of a PDF reaches the network, and the viewer needs no more than its own files', async () => {
    const page = await launch()
    const failures: string[] = []
    page.on('requestfailed', (request) => failures.push(request.url()))
    page.on('console', (message) => message.type() === 'error' && failures.push(message.text()))
    await openFile(page, ['assets', 'files'], 'handbook.pdf')
    await expect(page.locator('[data-page="1"] .textLayer')).toContainText('Harbor handbook')
    expect(failures.filter((f) => !/woff2|font/i.test(f))).toEqual([])
  })
})
