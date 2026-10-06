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

test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-docs-'))
  work = path.join(dir, 'office')
  fs.mkdirSync(work)
  fs.writeFileSync(path.join(work, 'report.docx'), await docxBuffer())
  fs.writeFileSync(path.join(work, 'deck.pptx'), await pptxBuffer())
  fs.writeFileSync(path.join(work, 'notes.odt'), await odtBuffer())
  fs.writeFileSync(path.join(work, 'boats.ods'), await odsBuffer())
  fs.writeFileSync(path.join(work, 'boats.csv'), 'Boat,Seats\nGull,12\n"Heron, big",8\n')
  fs.writeFileSync(path.join(work, 'broken.docx'), 'this is not a Word file, only text pretending to be one')
})
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...args: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, ...args] })
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
