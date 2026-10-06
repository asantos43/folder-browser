import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeSampleWsnp, writeViewerWsnp } from '../fixtures/build.ts'
import { zipSync } from '../fixtures/zip.ts'

// End-to-end: a folder or a ZIP file opened to browse: the tree that reads a level at a time, the hidden files, files in tabs, ZIP files as folders.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-browse-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(path.join(work, 'docs'), { recursive: true })
  fs.mkdirSync(path.join(work, '.git'))
  fs.writeFileSync(path.join(work, 'a.txt'), 'the ferry leaves at noon')
  fs.writeFileSync(path.join(work, '.env'), 'SECRET=1')
  fs.writeFileSync(path.join(work, 'docs', 'readme.md'), '# Notes\n\nfrom the docs folder')
  await writeViewerWsnp(path.join(work, 'harbor.wsnp'), { title: 'Harbor Times', url: 'https://harbortimes.example/' })
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
const names = (page: Page) => tree(page).getByRole('treeitem').evaluateAll((rows) => rows.map((r) => r.querySelector('span.truncate')?.textContent ?? ''))

test('a folder named on the command line opens as a root, with its first level and nothing hidden', async () => {
  const page = await launch(work)
  await expect(page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option')).toHaveText(['work'])
  await expect.poll(() => names(page)).toEqual(['docs', 'a.txt', 'harbor.wsnp', 'pack.zip'])
  await expect(page.getByRole('contentinfo')).toContainText(`Folder: ${work}`)
})

test('the hidden files appear with Ctrl+H, from the side bar and from the settings, and go again', async () => {
  const page = await launch(work)
  await expect.poll(() => names(page)).toEqual(['docs', 'a.txt', 'harbor.wsnp', 'pack.zip'])
  await page.keyboard.press('Control+h')
  await expect.poll(() => names(page)).toEqual(['.git', 'docs', '.env', 'a.txt', 'harbor.wsnp', 'pack.zip'])
  await page.getByRole('button', { name: 'Hide Hidden Files' }).click()
  await expect.poll(() => names(page)).toEqual(['docs', 'a.txt', 'harbor.wsnp', 'pack.zip'])
  await page.getByRole('button', { name: 'Show Hidden Files' }).first().click()
  await expect(item(page, '.env')).toBeVisible()
})

test('a click opens a preview tab with the file, a double click keeps it, and a folder opens in place', async () => {
  const page = await launch(work)
  await item(page, 'docs').click()
  await expect(item(page, 'readme.md')).toBeVisible()
  await item(page, 'a.txt').click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('a.txt')
  await expect(page.getByRole('tab', { selected: true }).locator('span.italic')).toHaveCount(1)
  await expect(page.locator('.cm-content')).toContainText('the ferry leaves at noon')
  await item(page, 'readme.md').dblclick()
  await expect(page.getByRole('tab', { selected: true })).toContainText('readme.md')
  // Kept: not in italics, as a preview is.
  await expect(page.getByRole('tab', { selected: true }).locator('span.italic')).toHaveCount(0)
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
  await page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option', { name: 'work' }).hover()
  await page.getByRole('button', { name: 'Close Folder' }).click()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByText('No folder is open.')).toBeVisible()
})

test('a click on a .wsnp shows its page in a preview tab, as a picture would be shown; the next preview takes its place, and nothing of snapshots is on screen', async () => {
  const page = await launch(work)
  await expect(item(page, 'harbor.wsnp')).toBeVisible()
  // No icon of its own, and no section of snapshots.
  await expect(item(page, 'harbor.wsnp').locator('.codicon-browser')).toHaveCount(0)
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Open File/ })).toHaveCount(0)
  await item(page, 'harbor.wsnp').click()
  const tab = page.getByRole('tab', { selected: true })
  await expect(tab).toContainText('harbor.wsnp')
  await expect(tab.locator('span.italic')).toHaveCount(1)
  await expect(page.frameLocator('iframe[title="Snapshot: harbor.wsnp"]').locator('#ext')).toBeVisible()
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' })).toHaveCount(0)
  await expect(page.getByText('Files — work')).toBeVisible()
  await expect(item(page, 'a.txt')).toBeVisible()
  // The next preview takes its place, and the snapshot is closed with it.
  await item(page, 'a.txt').click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { selected: true })).toContainText('a.txt')
  await expect(page.locator('iframe')).toHaveCount(0)
})

test('a double click on a .wsnp keeps its page in a tab of its own, as for any file: no list of open snapshots, and the side bar stays on the folder', async () => {
  await writeSampleWsnp(path.join(work, 'second.wsnp'), { title: 'Second page', url: 'https://second.example/' })
  const page = await launch(work)
  const heading = page.getByText(/^Files — /).first()
  await item(page, 'harbor.wsnp').dblclick()
  const tab = page.getByRole('tab', { selected: true })
  await expect(tab).toContainText('harbor.wsnp')
  await expect(tab.locator('span.italic')).toHaveCount(0)
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' })).toHaveCount(0)
  await expect(heading).toHaveText('Files — work')
  // Another one in another tab; the first stays.
  await item(page, 'second.wsnp').dblclick()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { selected: true })).toContainText('second.wsnp')
  await expect(heading).toHaveText('Files — work')
  await expect(page.locator('iframe')).toHaveCount(2)
  // The same file again shows the tab it has, and no second one.
  await item(page, 'harbor.wsnp').dblclick()
  await expect(page.getByRole('tab', { selected: true })).toContainText('harbor.wsnp')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(heading).toHaveText('Files — work')
  await page.getByRole('tab', { selected: true }).getByRole('button', { name: /Close/ }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('iframe')).toHaveCount(1)
})

test('the side bar never leaves the folder for a .wsnp: not by a click, a double click, a click on the tab, or the same file again', async () => {
  await writeSampleWsnp(path.join(work, 'second.wsnp'), { title: 'Second page', url: 'https://second.example/' })
  const page = await launch(work)
  const heading = page.getByText(/^Files — /).first()
  await item(page, 'harbor.wsnp').dblclick()
  await item(page, 'second.wsnp').click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('second.wsnp')
  await expect(heading).toHaveText('Files — work')
  await item(page, 'harbor.wsnp').click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('harbor.wsnp')
  await expect(heading).toHaveText('Files — work')
  await page.getByRole('tab', { name: /second.wsnp/ }).click()
  await expect(heading).toHaveText('Files — work')
  await page.getByRole('tab', { name: /harbor.wsnp/ }).dblclick()
  await expect(heading).toHaveText('Files — work')
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Information' })).toHaveCount(0)
})

test('two .wsnp files of the same page and the same address, saved at two times, are told apart by the name of the file: tabs, pages and the one that is previewed', async () => {
  await writeViewerWsnp(path.join(work, 'harbor-2026-03.wsnp'), { title: 'Harbor Times', url: 'https://harbortimes.example/' })
  await writeViewerWsnp(path.join(work, 'harbor-2026-04.wsnp'), { title: 'Harbor Times', url: 'https://harbortimes.example/' })
  const page = await launch(work)
  await item(page, 'harbor-2026-03.wsnp').dblclick()
  await item(page, 'harbor-2026-04.wsnp').dblclick()
  await expect(page.getByRole('tab')).toHaveText(['harbor-2026-03.wsnp', 'harbor-2026-04.wsnp'])
  await expect(page.locator('iframe')).toHaveCount(2)
  await expect(page.locator('iframe[title="Snapshot: harbor-2026-03.wsnp"]')).toHaveCount(1)
  await expect(page.locator('iframe[title="Snapshot: harbor-2026-04.wsnp"]')).toHaveCount(1)
  // Each click lands on its own file: the one that is open comes to the front, the other is the one previewed.
  await page.getByRole('tab', { name: 'harbor-2026-03.wsnp' }).click()
  await expect(page.getByRole('tab', { selected: true })).toHaveText('harbor-2026-03.wsnp')
  await item(page, 'harbor-2026-04.wsnp').click()
  await expect(page.getByRole('tab', { selected: true })).toHaveText('harbor-2026-04.wsnp')
  await expect(page.getByRole('tab')).toHaveCount(2)
  // The tooltip says where the file is and the address the page came from.
  await expect(page.getByRole('tab', { name: 'harbor-2026-03.wsnp' })).toHaveAttribute('title', `${path.join(work, 'harbor-2026-03.wsnp')}\nhttps://harbortimes.example/`)
})

test('the page of a .wsnp is checked like any snapshot, and its metadata are in the menu of its tab', async () => {
  const page = await launch(work)
  await item(page, 'harbor.wsnp').dblclick()
  await expect(page.getByRole('contentinfo')).toBeVisible()
  await page.getByRole('tab', { selected: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show Metadata' }).click()
  await expect(page.getByRole('tab', { name: /Metadata/ })).toBeVisible()
  await expect(page.getByText('Files — work')).toBeVisible()
})

test('a .wsnp of the folder can be opened as a ZIP: its entries are listed, not shown as a page', async () => {
  const page = await launch(work)
  await item(page, 'harbor.wsnp').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open as ZIP' }).click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('harbor.wsnp')
  await expect(page.getByText('manifest.json').first()).toBeVisible()
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' }).getByRole('option')).toHaveCount(0)
})

test('every file of a folder can be opened in another application (a copy, read-only), and has its properties', async () => {
  const log = path.join(dir, 'open-with.log')
  const tmp = path.join(dir, 'tmp')
  fs.mkdirSync(tmp)
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, work], env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, WSNP_OPEN_WITH_LOG: log } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  await item(page, 'a.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open With…' }).click()
  await expect.poll(() => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '')).toContain('a.txt')
  const copy = fs.readFileSync(log, 'utf8').trim().split('\n').at(-1)!
  expect(fs.readFileSync(copy, 'utf8')).toBe('the ferry leaves at noon')
  expect(copy.startsWith(tmp)).toBe(true)
  // The original is untouched, and the same goes for a file in a ZIP.
  expect(fs.readFileSync(path.join(work, 'a.txt'), 'utf8')).toBe('the ferry leaves at noon')
  await item(page, 'pack.zip').click()
  await item(page, 'top.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open with Default Application' }).click()
  await expect.poll(() => fs.readFileSync(log, 'utf8').trim().split('\n').length).toBe(2)
  expect(fs.readFileSync(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1)!, 'utf8')).toBe('top of the zip')
  await item(page, 'a.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Properties' }).click()
  const dialog = page.getByRole('dialog', { name: 'Properties' })
  await expect(dialog).toContainText(path.join(work, 'a.txt'))
  await expect(dialog).toContainText('24 B')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('Open ZIP File… (the side bar, the File menu) asks for a ZIP file and opens it as the root, to browse; Open Folder… opens a folder', async () => {
  const page = await launch()
  // (The system's file dialog cannot be driven: it answers with the file chosen.)
  const choose = (file: string) => app!.evaluate(({ dialog }, picked) => void (dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as unknown as typeof dialog.showOpenDialog), file)
  await choose(path.join(work, 'pack.zip'))
  await page.getByRole('button', { name: 'Open ZIP File', exact: true }).click()
  await expect(item(page, 'src')).toBeVisible()
  await expect(item(page, 'top.txt')).toBeVisible()
  await expect(page.getByRole('listbox', { name: 'Open Folders' }).getByText('pack.zip')).toBeVisible()
  // The File menu has it too.
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Open ZIP File…' })).toBeVisible()
  await page.keyboard.press('Escape')
  // And the folder picker still opens a folder.
  await choose(work)
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Open Folders' }).getByText('work')).toBeVisible()
})
