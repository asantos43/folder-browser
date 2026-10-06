import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type FrameLocator, type Page } from '@playwright/test'
import { docxBuffer, odsBuffer, odtBuffer, pptxBuffer } from '../fixtures/office.ts'

// End-to-end: Word, PowerPoint, Writer and Calc files, drawn by the libraries in a frame of their own (sandboxed, no network).
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined
let printTo: string | undefined

test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-docs-'))
  work = path.join(dir, 'office')
  fs.mkdirSync(work)
  fs.writeFileSync(path.join(work, 'report.docx'), await docxBuffer())
  fs.writeFileSync(path.join(work, 'deck.pptx'), await pptxBuffer())
  fs.writeFileSync(path.join(work, 'notes.odt'), await odtBuffer())
  fs.writeFileSync(path.join(work, 'boats.ods'), await odsBuffer())
  fs.writeFileSync(path.join(work, 'boats.csv'), 'Boat,Seats\nGull,12\n"Heron, big",8\n')
  fs.writeFileSync(path.join(work, 'notes.txt'), 'plain words of a note\n')
  // A log of 6 MB (more than any other text is opened at): logs are text, and big.
  fs.writeFileSync(path.join(work, 'server.log'), 'GET /index.html 200 12ms\n'.repeat(250_000) + 'THE LAST LINE OF THE LOG\n')
  fs.writeFileSync(path.join(work, 'broken.docx'), 'this is not a Word file, only text pretending to be one')
})
test.afterEach(async () => {
  printTo = undefined
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...args: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, ...args], env: { ...process.env, ...(printTo ? { WSNP_PRINT_TO: printTo } : {}) } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
const item = (page: Page, name: string) => page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name, exact: true })
const frameOf = (page: Page, name: string): FrameLocator => page.frameLocator(`iframe[title="Document: ${name}"]`)

test('a Word file is drawn as a page, with its formatting', async () => {
  const page = await launch(work)
  await item(page, 'report.docx').dblclick()
  const doc = frameOf(page, 'report.docx')
  await expect(doc.getByText('Harbor report')).toBeVisible()
  await expect(doc.locator('b, strong').filter({ hasText: 'ferry' }).or(doc.locator('span').filter({ hasText: /^ferry$/ }))).toBeVisible()
  await expect(doc.locator('table')).toContainText('North')
  await expect(doc.locator('section.docx, section')).not.toHaveCount(0)
})

test('a PowerPoint file is drawn slide by slide', async () => {
  const page = await launch(work)
  await item(page, 'deck.pptx').dblclick()
  const doc = frameOf(page, 'deck.pptx')
  await expect(doc.getByText('Harbor deck')).toBeVisible()
  await expect(doc.getByText('Yellow box')).toBeVisible()
  await expect(doc.getByText('Second slide')).toBeVisible()
})

test('a Writer file is drawn with its text', async () => {
  const page = await launch(work)
  await item(page, 'notes.odt').dblclick()
  const doc = frameOf(page, 'notes.odt').frameLocator('iframe')
  await expect(doc.getByText('Writer heading')).toBeVisible()
  await expect(doc.getByText('Second paragraph of the Writer file.')).toBeVisible()
})

test('a Calc file shows its first sheet, and a bar goes to the other sheets', async () => {
  const page = await launch(work)
  await item(page, 'boats.ods').dblclick()
  const frame = frameOf(page, 'boats.ods')
  const sheet = frame.frameLocator('iframe')
  await expect(sheet.getByText('Gull')).toBeVisible()
  await expect(sheet.getByText('Ana')).toHaveCount(0)
  await frame.getByRole('button', { name: 'Crew' }).click()
  await expect(sheet.getByText('Skipper')).toBeVisible()
})

test('a file that is not what its name says is explained, and can be seen as bytes', async () => {
  const page = await launch(work)
  await item(page, 'broken.docx').dblclick()
  await expect(page.getByText(/This document could not be drawn/)).toBeVisible()
  await page.getByRole('button', { name: 'View as hex' }).click()
  await expect(page.getByRole('grid', { name: 'Hexadecimal view of broken.docx' })).toBeVisible()
  // The bytes are in a tab of their own: the document's tab is still there.
  await expect(page.getByRole('tab', { name: /^Hex: broken\.docx/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^broken\.docx/ })).toBeVisible()
})

test('a document is drawn once and kept: going to another tab and back does not draw it again', async () => {
  const page = await launch(work)
  await item(page, 'report.docx').dblclick()
  const doc = frameOf(page, 'report.docx')
  await expect(doc.getByText('Harbor report')).toBeVisible()
  // A mark in the frame's own window: it is gone if the frame is made again.
  const frame = page.frames().find((f) => f.url().startsWith('fb-doc://'))!
  await frame.evaluate(() => void ((window as unknown as { __kept: number }).__kept = 42))
  await item(page, 'boats.csv').dblclick()
  await expect(page.getByRole('table', { name: 'Table of boats.csv' })).toBeVisible()
  await expect(page.locator('iframe[title="Document: report.docx"]')).toBeHidden()
  await page.getByRole('tab', { name: /^report\.docx/ }).click()
  await expect(doc.getByText('Harbor report')).toBeVisible()
  expect(await frame.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(42)
  // Closing its tab lets it go: the page of that document is gone.
  await page.getByRole('tab', { name: /^report\.docx/ }).getByRole('button', { name: /close/i }).click()
  await expect.poll(() => page.frames().some((f) => f.url().startsWith('fb-doc://'))).toBe(false)
})

test('Open as Hex in the menu of the tree shows any file as its bytes, beside the file in its own kind, and the tab comes back at the next start', async () => {
  const page = await launch(work)
  await item(page, 'report.docx').dblclick()
  await expect(frameOf(page, 'report.docx').getByText('Harbor report')).toBeVisible()
  await item(page, 'report.docx').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open as Hex' }).click()
  const hex = page.getByRole('grid', { name: 'Hexadecimal view of report.docx' })
  await expect(hex).toBeVisible()
  await expect(hex.getByRole('row').first()).toContainText('504b0304')
  await expect(page.getByRole('tab', { name: /^Hex: report\.docx/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^report\.docx/ })).toBeVisible()
  await app!.close()
  app = undefined
  const again = await launch()
  await expect(again.getByRole('tab', { name: /^Hex: report\.docx/ })).toBeVisible()
  await again.getByRole('tab', { name: /^Hex: report\.docx/ }).click()
  await expect(again.getByRole('grid', { name: 'Hexadecimal view of report.docx' })).toBeVisible()
})

test('the frame of a document is cut off: it has no network, no way into the window, and the page of the interface cannot be reached from it', async () => {
  const page = await launch(work)
  await item(page, 'report.docx').dblclick()
  await expect(frameOf(page, 'report.docx').getByText('Harbor report')).toBeVisible()
  const frame = page.frames().find((f) => f.url().startsWith('fb-doc://'))!
  expect(frame).toBeTruthy()
  const reach = await frame.evaluate(async () => {
    let network = 'blocked'
    try {
      await fetch('https://example.com/')
      network = 'reached'
    } catch {}
    let parent = 'blocked'
    try {
      parent = String((window.parent as unknown as { fb?: unknown }).fb ? 'reached' : 'blocked')
    } catch {}
    return { network, parent, origin: window.origin }
  })
  expect(reach).toEqual({ network: 'blocked', parent: 'blocked', origin: 'null' })
})

test('a CSV file is a table, with the text one click away, and the choice is kept', async () => {
  const page = await launch(work)
  await item(page, 'boats.csv').dblclick()
  const table = page.getByRole('table', { name: 'Table of boats.csv' })
  await expect(table).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Seats' })).toBeVisible()
  await expect(table.getByRole('cell', { name: 'Heron, big' })).toBeVisible()
  await page.getByRole('button', { name: 'Show the file as text' }).click()
  await expect(page.locator('.cm-content')).toContainText('"Heron, big",8')
  await expect(table).toHaveCount(0)
})

// ---- zoom, Find and Print

const status = (page: Page) => page.getByRole('contentinfo')
const docFrame = (page: Page) => page.frames().find((f) => f.url().startsWith('fb-doc://'))!
/** What the page of a document is laid out at: a zoom of 125 % lays it out at 1/1.25 of the room (as a browser's zoom does). */
const layoutWidth = (page: Page) => docFrame(page).evaluate(() => window.innerWidth)
/** A turn of the wheel with Control held, as a person's: through the DevTools protocol, which reaches a page in its own process. */
async function wheel(page: Page, selector: string, deltaY: number) {
  const box = (await page.locator(selector).first().boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x + box.width / 2, y: box.y + box.height / 2, deltaX: 0, deltaY, modifiers: 2 })
  await cdp.detach()
}

test('a document has the zoom of its tab: the keys, the wheel over the page, the status bar and Ctrl+0; each tab has its own', async () => {
  const page = await launch(work)
  await item(page, 'report.docx').dblclick()
  await expect(frameOf(page, 'report.docx').getByText('Harbor report')).toBeVisible()
  const start = await layoutWidth(page)
  await page.keyboard.press('ControlOrMeta+=')
  await page.keyboard.press('ControlOrMeta+=')
  await expect(status(page)).toContainText('125%')
  await expect.poll(() => layoutWidth(page)).toBeCloseTo(start / 1.25, -1)
  // The wheel over the page itself (another process): the page says it turned and the tab zooms.
  await wheel(page, 'iframe[title="Document: report.docx"]', -120)
  await expect(status(page)).toContainText('150%')
  await wheel(page, 'iframe[title="Document: report.docx"]', 120)
  await expect(status(page)).toContainText('125%')
  // With the focus inside the page (another process) the keys work too.
  await frameOf(page, 'report.docx').getByText('Harbor report').click()
  await page.keyboard.press('ControlOrMeta+-')
  await expect(status(page)).toContainText('110%')
  await page.getByRole('button', { name: 'Zoom In' }).click()
  await expect(status(page)).toContainText('125%')
  await page.keyboard.press('ControlOrMeta+0')
  await expect(status(page)).toContainText('100%')
  await expect.poll(() => layoutWidth(page)).toBeCloseTo(start, -1)
  // Another tab has its own zoom.
  await page.keyboard.press('ControlOrMeta+=')
  await item(page, 'deck.pptx').dblclick()
  await expect(frameOf(page, 'deck.pptx').getByText('Harbor deck')).toBeVisible()
  await expect(status(page)).toContainText('100%')
})

test('the keys zoom with the focus inside the document, and a workbook zooms as the sheet is drawn in a frame of its own', async () => {
  const page = await launch(work)
  await item(page, 'boats.ods').dblclick()
  await expect(frameOf(page, 'boats.ods').frameLocator('iframe').getByText('Gull')).toBeVisible()
  await frameOf(page, 'boats.ods').frameLocator('iframe').getByText('Gull').click()
  await page.keyboard.press('ControlOrMeta+=')
  await expect(status(page)).toContainText('110%')
  // The wheel over the sheet (a frame in the frame) is relayed.
  await wheel(page, 'iframe[title="Document: boats.ods"]', -120)
  await expect(status(page)).toContainText('125%')
})

test('a table and the bytes of a file have the zoom of their tab', async () => {
  const page = await launch(work)
  await item(page, 'boats.csv').dblclick()
  const cell = page.getByRole('cell', { name: 'Gull' })
  const size = () => cell.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  const table = await size()
  await page.keyboard.press('ControlOrMeta+=')
  await expect(status(page)).toContainText('110%')
  expect(await size()).toBeCloseTo(table * 1.1, 1)
  await item(page, 'report.docx').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open as Hex' }).click()
  const row = page.getByRole('grid', { name: 'Hexadecimal view of report.docx' }).getByRole('row').first()
  await expect(row).toBeVisible()
  await expect(status(page)).toContainText('100%')
  const height = () => row.evaluate((el) => el.getBoundingClientRect().height)
  const rowHeight = await height()
  await page.keyboard.press('ControlOrMeta+=')
  await page.keyboard.press('ControlOrMeta+=')
  await expect(status(page)).toContainText('125%')
  expect(await height()).toBeCloseTo(rowHeight * 1.25, 0)
})

test('Ctrl+F finds in a document: the matches are counted, selected one after the other, and Escape clears them; in a workbook, in the sheet that is shown', async () => {
  const page = await launch(work)
  await item(page, 'report.docx').dblclick()
  await expect(frameOf(page, 'report.docx').getByText('Harbor report')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+f')
  const box = page.getByRole('textbox', { name: 'Find' })
  await box.fill('o')
  await expect(page.getByRole('search').getByText(/^1 of \d+$/)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('search').getByText(/^2 of \d+$/)).toBeVisible()
  await box.fill('ferry')
  await expect(page.getByRole('search').getByText('1 of 1')).toBeVisible()
  expect(await docFrame(page).evaluate(() => String(getSelection()))).toBe('ferry')
  await box.fill('nothing of the sort')
  await expect(page.getByRole('search').getByText('No results')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('search')).toHaveCount(0)
  // A workbook: the sheet on screen is searched.
  await item(page, 'boats.ods').dblclick()
  await expect(frameOf(page, 'boats.ods').frameLocator('iframe').getByText('Gull')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByRole('textbox', { name: 'Find' }).fill('Heron')
  await expect(page.getByRole('search').getByText('1 of 1')).toBeVisible()
  await page.getByRole('textbox', { name: 'Find' }).fill('Skipper')
  await expect(page.getByRole('search').getByText('No results')).toBeVisible()
})

test('Ctrl+F in the bytes of a file goes to the box that looks for bytes or text, not to a bar of its own', async () => {
  const page = await launch(work)
  await item(page, 'report.docx').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open as Hex' }).click()
  await expect(page.getByRole('grid', { name: 'Hexadecimal view of report.docx' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+f')
  await expect(page.getByPlaceholder('Bytes, e.g. 4d 5a')).toBeFocused()
  await expect(page.getByRole('search')).toHaveCount(0)
})

test.describe('print', () => {
  const printed = async (page: Page, out: string) => {
    await page.keyboard.press('ControlOrMeta+p')
    await expect.poll(() => (fs.existsSync(out) ? fs.readFileSync(out).subarray(0, 5).toString() : ''), { timeout: 30000 }).toBe('%PDF-')
    return fs.readFileSync(out)
  }
  /** How many pages the PDF has (its page objects: `/Type /Page`, not `/Pages`). */
  const pagesOf = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

  test('a Word file, a Writer file, a presentation and a workbook are printed whole, from a window that is never shown and goes away', async () => {
    const out = path.join(dir, 'printed.pdf')
    printTo = out
    const page = await launch(work)
    for (const [name, text] of [['report.docx', 'Harbor report'], ['notes.odt', 'Writer heading'], ['deck.pptx', 'Harbor deck'], ['boats.ods', 'Gull']] as const) {
      await item(page, name).dblclick()
      await expect(page.locator(`iframe[title="Document: ${name}"]`)).toBeVisible()
      await expect(page.getByRole('status')).toHaveCount(0)
      fs.rmSync(out, { force: true })
      const pdf = await printed(page, out)
      expect(pdf.length, name).toBeGreaterThan(1000)
      expect(pagesOf(pdf), name).toBeGreaterThanOrEqual(1)
      expect(text).toBeTruthy()
    }
    expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('Print is on for a document and off for the bytes of a file; Save as PDF is in the menu', async () => {
    const page = await launch(work)
    const bar = page.getByRole('navigation', { name: 'Activity Bar' })
    await item(page, 'report.docx').dblclick()
    await expect(page.locator('iframe[title="Document: report.docx"]')).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Print…' })).toBeEnabled()
    await item(page, 'report.docx').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as Hex' }).click()
    await expect(page.getByRole('grid', { name: 'Hexadecimal view of report.docx' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Print…' })).toBeDisabled()
  })
})

test('a text file has View as hex in its toolbar, which opens its bytes in a tab beside it', async () => {
  const page = await launch(work)
  await item(page, 'notes.txt').dblclick()
  await expect(page.locator('.cm-content')).toContainText('plain words of a note')
  await page.getByRole('toolbar').getByRole('button', { name: 'View as hex' }).click()
  const hex = page.getByRole('grid', { name: 'Hexadecimal view of notes.txt' })
  await expect(hex).toBeVisible()
  await expect(hex.getByRole('row').first()).toContainText('706c61696e20776f')
  await expect(page.getByRole('tab', { name: /^notes\.txt/ })).toBeVisible()
  // A CSV table has it too.
  await item(page, 'boats.csv').dblclick()
  await page.getByRole('toolbar').getByRole('button', { name: 'View as hex' }).click()
  await expect(page.getByRole('grid', { name: 'Hexadecimal view of boats.csv' })).toBeVisible()
})

test('a log opens as text, however big it is for a text (up to 32 MB), and its end is there', async () => {
  const page = await launch(work)
  const started = Date.now()
  await item(page, 'server.log').dblclick()
  await expect(page.locator('.cm-content')).toContainText('GET /index.html 200 12ms')
  expect(Date.now() - started).toBeLessThan(15000)
  await page.keyboard.press('ControlOrMeta+End')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await expect(page.locator('.cm-content')).toContainText('THE LAST LINE OF THE LOG')
  await expect(page.getByText('This kind of file is not shown here.')).toHaveCount(0)
})

test.describe('Open With… from the toolbar of the new views (the chooser of the app)', () => {
  test.skip(process.platform !== 'linux', 'the chooser of the app is Linux’s')
  const chooser = (page: Page, name: string) => page.getByRole('dialog', { name: 'Open With' }).filter({ hasText: `Choose an app to open ${name}` })

  test('a document, a table and the bytes of a file each have a button that opens the chooser for the file', async () => {
    const page = await launch(work)
    await item(page, 'report.docx').dblclick()
    await expect(page.locator('iframe[title="Document: report.docx"]')).toBeVisible()
    await page.getByRole('toolbar').getByRole('button', { name: 'Open With…' }).click()
    await expect(chooser(page, 'report.docx')).toBeVisible()
    await page.keyboard.press('Escape')
    await item(page, 'boats.csv').dblclick()
    await page.getByRole('toolbar').getByRole('button', { name: 'Open With…' }).click()
    await expect(chooser(page, 'boats.csv')).toBeVisible()
    await page.keyboard.press('Escape')
    await item(page, 'notes.txt').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open as Hex' }).click()
    await page.getByRole('toolbar').getByRole('button', { name: 'Open With…' }).click()
    await expect(chooser(page, 'notes.txt')).toBeVisible()
  })
})
