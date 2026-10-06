import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { zipSync } from '../fixtures/zip.ts'

// End-to-end: a folder or a ZIP file opened to browse: the tree that reads a level at a time, the hidden files, files in tabs, ZIP files as folders.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-browse-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(path.join(work, 'docs'), { recursive: true })
  fs.mkdirSync(path.join(work, '.git'))
  fs.writeFileSync(path.join(work, 'a.txt'), 'the ferry leaves at noon')
  fs.writeFileSync(path.join(work, '.env'), 'SECRET=1')
  fs.writeFileSync(path.join(work, 'docs', 'readme.md'), '# Notes\n\nfrom the docs folder')
  fs.writeFileSync(path.join(work, 'pack.zip'), zipSync([{ name: 'src/' }, { name: 'src/main.c', data: 'int main(void) { return 42; }' }, { name: 'top.txt', data: 'top of the zip' }]))
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
const tree = (page: Page) => page.getByRole('tree', { name: 'Files and folders' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true })
const names = (page: Page) => tree(page).getByRole('treeitem').allTextContents()

test('a folder named on the command line opens as a root, with its first level and nothing hidden', async () => {
  const page = await launch(work)
  await expect(page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option')).toHaveText(['work'])
  await expect.poll(() => names(page)).toEqual(['docs', 'a.txt', 'pack.zip'])
  await expect(page.getByRole('contentinfo')).toContainText(`Folder: ${work}`)
})

test('the hidden files appear with Ctrl+H, from the side bar and from the settings, and go again', async () => {
  const page = await launch(work)
  await expect.poll(() => names(page)).toEqual(['docs', 'a.txt', 'pack.zip'])
  await page.keyboard.press('Control+h')
  await expect.poll(() => names(page)).toEqual(['.git', 'docs', '.env', 'a.txt', 'pack.zip'])
  await page.getByRole('button', { name: 'Hide Hidden Files' }).click()
  await expect.poll(() => names(page)).toEqual(['docs', 'a.txt', 'pack.zip'])
  await page.getByRole('button', { name: 'Show Hidden Files' }).first().click()
  await expect(item(page, '.env')).toBeVisible()
})

test('a click opens a preview tab with the file, a double click keeps it, and a folder opens in place', async () => {
  const page = await launch(work)
  await item(page, 'docs').click()
  await expect(item(page, 'readme.md')).toBeVisible()
  await item(page, 'a.txt').click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('a.txt')
  await expect(page.locator('.cm-content')).toContainText('the ferry leaves at noon')
  await item(page, 'readme.md').dblclick()
  await expect(page.getByRole('tab', { selected: true })).toContainText('readme.md')
  await expect(page.getByText('from the docs folder')).toBeVisible()
  // The preview of a.txt was replaced by the file that was kept.
  await expect(page.getByRole('tab')).toHaveCount(1)
})

test('a ZIP file opens like a folder, and a file inside it opens in a tab', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await expect(item(page, 'src')).toBeVisible()
  await item(page, 'src').click()
  await item(page, 'main.c').click()
  await expect(page.locator('.cm-content')).toContainText('int main(void)')
  await expect(page.getByRole('tab', { selected: true })).toContainText('main.c')
})

test('a file named on the command line opens its folder and the file in a tab', async () => {
  const page = await launch(path.join(work, 'docs', 'readme.md'))
  await expect(page.getByRole('tab', { selected: true })).toContainText('readme.md')
  await expect(page.getByText('from the docs folder')).toBeVisible()
  await expect(page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option')).toHaveText(['docs'])
})

test('a ZIP named on the command line is browsed as the root', async () => {
  const page = await launch(path.join(work, 'pack.zip'))
  await expect(page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option')).toHaveText(['pack.zip'])
  await expect.poll(() => names(page)).toEqual(['src', 'top.txt'])
  await item(page, 'top.txt').click()
  await expect(page.locator('.cm-content')).toContainText('top of the zip')
})

test('the open folders and their files come back at the next start', async () => {
  let page = await launch(work)
  await item(page, 'a.txt').dblclick()
  await expect(page.locator('.cm-content')).toContainText('the ferry leaves at noon')
  await app!.close()
  app = undefined
  page = await launch()
  await expect(page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option')).toHaveText(['work'])
  await expect(page.getByRole('tab', { selected: true })).toContainText('a.txt')
})

test('closing the folder takes its tabs with it', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dblclick()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await page.getByRole('option', { name: 'work' }).hover()
  await page.getByRole('button', { name: 'Close Folder' }).click()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByText('No folder is open.')).toBeVisible()
})
