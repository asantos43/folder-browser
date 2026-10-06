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

test('a click on a .wsnp only previews it, as it would a picture: the tab is in italics, the side bar stays on the folder, and the next preview takes its place', async () => {
  const page = await launch(work)
  await expect(item(page, 'harbor.wsnp')).toBeVisible()
  // No icon of its own, and no section of snapshots until one is opened.
  await expect(item(page, 'harbor.wsnp').locator('.codicon-browser')).toHaveCount(0)
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Open File/ })).toHaveCount(0)
  await item(page, 'harbor.wsnp').click()
  const tab = page.getByRole('tab', { selected: true })
  await expect(tab).toContainText('Harbor Times')
  await expect(tab.locator('span.italic')).toHaveCount(1)
  await expect(page.frameLocator('iframe[title="Snapshot: Harbor Times"]').locator('#ext')).toBeVisible()
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: /files/i }).or(page.getByText('Files — work'))).toBeVisible()
  await expect(item(page, 'a.txt')).toBeVisible()
  // The next preview takes its place, and the snapshot is closed with it.
  await item(page, 'a.txt').click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { selected: true })).toContainText('a.txt')
  await expect(page.locator('iframe')).toHaveCount(0)
})

test('a double click opens the .wsnp as a snapshot for good: kept, listed under Open Snapshots, the side bar goes to its files; it is the same snapshot when opened again', async () => {
  const page = await launch(work)
  await item(page, 'harbor.wsnp').dblclick()
  const tab = page.getByRole('tab', { selected: true })
  await expect(tab).toContainText('Harbor Times')
  await expect(tab.locator('span.italic')).toHaveCount(0)
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' }).getByRole('option')).toHaveCount(1)
  await expect(page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option')).toHaveCount(1)
  await expect(page.getByText('Files — harbor.wsnp')).toBeVisible()
  await expect(page.frameLocator('iframe[title="Snapshot: Harbor Times"]').locator('#ext')).toBeVisible()
  // Back to the folder; opened again it is the same snapshot, its tab comes to the front.
  await page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option', { name: 'work' }).click()
  await item(page, 'harbor.wsnp').dblclick()
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' }).getByRole('option')).toHaveCount(1)
  await expect(page.locator('iframe')).toHaveCount(1)
  // The section goes with the last snapshot.
  await page.getByRole('tab', { selected: true }).getByRole('button', { name: /Close/ }).click()
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' })).toHaveCount(0)
})

test('a previewed .wsnp is opened for good from its tab too (a double click on the tab), and from the menu of the row', async () => {
  const page = await launch(work)
  await item(page, 'harbor.wsnp').click()
  await expect(page.getByRole('tab', { selected: true }).locator('span.italic')).toHaveCount(1)
  await page.getByRole('tab', { selected: true }).dblclick()
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' }).getByRole('option')).toHaveCount(1)
  await page.getByRole('tab', { selected: true }).getByRole('button', { name: /Close/ }).click()
  await item(page, 'harbor.wsnp').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' }).getByRole('option')).toHaveCount(1)
})

test('the files can be ordered by name, by date and by size, either way, from the button and from the View menu; the choice is kept and the details are small and to the right', async () => {
  const day = (y: number) => new Date(y, 5, 15, 12, 0, 0)
  fs.utimesSync(path.join(work, 'a.txt'), day(2020), day(2020))
  fs.utimesSync(path.join(work, 'pack.zip'), day(2022), day(2022))
  fs.utimesSync(path.join(work, 'harbor.wsnp'), day(2024), day(2024))
  const bySize = ['a.txt', 'pack.zip', 'harbor.wsnp'].sort((x, y) => fs.statSync(path.join(work, x)).size - fs.statSync(path.join(work, y)).size)
  let page = await launch(work)
  const sortButton = () => page.getByRole('button', { name: /^Sort:/ })
  await expect.poll(() => names(page)).toEqual(['docs', 'a.txt', 'harbor.wsnp', 'pack.zip'])
  await expect(sortButton()).toHaveAttribute('title', 'Sort: Name, ascending')
  // The size and the date of a file, small and to the right (this window is narrow: the one the order is by).
  const detail = (name: string, text: string) => item(page, name).locator('span.tabular-nums', { hasText: text })
  await expect(detail('a.txt', '24 B')).toBeVisible()
  await expect(detail('a.txt', '2020')).toBeHidden()
  await sortButton().click()
  await page.getByRole('menuitemcheckbox', { name: 'Size' }).click()
  await expect.poll(() => names(page)).toEqual(['docs', ...bySize])
  await expect(sortButton()).toHaveAttribute('title', 'Sort: Size, ascending')
  await sortButton().click()
  await page.getByRole('menuitemcheckbox', { name: 'Descending' }).click()
  await expect.poll(() => names(page)).toEqual(['docs', ...[...bySize].reverse()])
  await sortButton().click()
  await page.getByRole('menuitemcheckbox', { name: 'Date Modified' }).click()
  await expect.poll(() => names(page)).toEqual(['docs', 'harbor.wsnp', 'pack.zip', 'a.txt'])
  await expect(detail('a.txt', '2020')).toBeVisible()
  await expect(detail('a.txt', '24 B')).toBeHidden()
  // The View menu has the same choices, and the choice is kept for the next start.
  await page.getByRole('menuitem', { name: 'View' }).click()
  await page.getByRole('menuitem', { name: 'Sort Files By' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Ascending' }).click()
  await expect.poll(() => names(page)).toEqual(['docs', 'a.txt', 'pack.zip', 'harbor.wsnp'])
  await app!.close()
  app = undefined
  page = await launch(work)
  await expect.poll(() => names(page)).toEqual(['docs', 'a.txt', 'pack.zip', 'harbor.wsnp'])
  await expect(sortButton()).toHaveAttribute('title', 'Sort: Date Modified, ascending')
})

test('clicking in the folder never takes the side bar to a snapshot, even for one that is open already; only its entry in the list of open snapshots does', async () => {
  await writeSampleWsnp(path.join(work, 'second.wsnp'), { title: 'Second page', url: 'https://second.example/' })
  const page = await launch(work)
  const heading = () => page.getByText(/^Files — /).first()
  const snapshots = page.getByRole('listbox', { name: 'Open Snapshots' }).getByRole('option')
  const folder = () => page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option', { name: 'work' }).click()
  await item(page, 'harbor.wsnp').dblclick()
  await expect(heading()).toHaveText('Files — harbor.wsnp')
  await folder()
  await expect(heading()).toHaveText('Files — work')
  // Another snapshot: only previewed, the side bar stays on the folder, and the one that is open stays where it is.
  await item(page, 'second.wsnp').click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('Second page')
  await expect(heading()).toHaveText('Files — work')
  await expect(snapshots).toHaveText(['Harbor Times'])
  // The one that is open already: its page comes to the front (it is the same snapshot), and the side bar still stays on the folder.
  await item(page, 'harbor.wsnp').click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('Harbor Times')
  await expect(heading()).toHaveText('Files — work')
  await expect(page.getByRole('tab')).toHaveCount(1 + 1)
  await expect(snapshots).toHaveCount(1)
  // A plain file after that: previewed too, the side bar still on the folder.
  await item(page, 'a.txt').click()
  await expect(page.getByRole('tab', { selected: true })).toContainText('a.txt')
  await expect(heading()).toHaveText('Files — work')
  // The list of open snapshots is what changes to the view of a snapshot.
  await snapshots.filter({ hasText: 'Harbor Times' }).click()
  await expect(heading()).toHaveText('Files — harbor.wsnp')
  await expect(page.getByRole('tab', { selected: true })).toContainText('Harbor Times')
  // And a double click on a file of the folder that is open already does take it there.
  await folder()
  await expect(heading()).toHaveText('Files — work')
  await item(page, 'harbor.wsnp').dblclick()
  await expect(heading()).toHaveText('Files — harbor.wsnp')
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
