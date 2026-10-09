import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: the Explorer "New Folder…" button (the side bar header) creates a folder where the user asked it to: in the **last row the user has marked** when something is marked, else in the root; the name field's `placeholder` and `title` say where. The request is one-shot — switching roots does not re-fire it (issue #71).
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let other: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-newfolder-'))
  work = path.join(dir, 'work')
  other = path.join(dir, 'other')
  fs.mkdirSync(path.join(work, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(work, 'a.txt'), 'the words of a')
  fs.writeFileSync(path.join(work, 'docs', 'readme.md'), 'plain readme')
  fs.mkdirSync(other)
  fs.writeFileSync(path.join(other, 'note.txt'), 'a note')
})
test.afterEach(async () => {
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
const tree = (page: Page) => page.getByRole('tree', { name: 'Files and folders' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true })
const field = (page: Page) => page.getByRole('textbox', { name: 'Name' })
const onDisk = (...p: string[]) => path.join(work, ...p)
const onOther = (...p: string[]) => path.join(other, ...p)
const openFolders = (page: Page) => page.getByRole('listbox', { name: 'Open Folders' })

test('New Folder from the header: a marked folder makes the new folder inside it, the field says where; cleared marks put it in the root; switching roots leaves no field behind (issue #71)', async () => {
  const page = await launch(work, other)
  // Two roots are open and the last one is the one shown: bring `work` to the front first.
  await openFolders(page).getByRole('option', { name: 'work' }).click()
  await expect(openFolders(page).getByRole('option', { name: 'work' })).toHaveAttribute('aria-selected', 'true')
  // (i) A folder marked in the tree is the target: the name field says "New folder in <name>" and the new folder is created inside it on the disk.
  await item(page, 'docs').click({ modifiers: ['ControlOrMeta'] })
  await expect(tree(page).locator('[role=treeitem][data-marked=true]')).toHaveCount(1)
  await page.getByRole('button', { name: 'New Folder…' }).click()
  await expect(field(page)).toBeFocused()
  await expect(field(page)).toHaveAttribute('placeholder', 'New folder in docs')
  await expect(field(page)).toHaveAttribute('title', 'New folder in docs')
  await field(page).fill('made-in-docs')
  await field(page).press('Enter')
  await expect(item(page, 'made-in-docs')).toBeVisible()
  expect(fs.statSync(onDisk('docs', 'made-in-docs')).isDirectory()).toBe(true)
  expect(fs.existsSync(onDisk('made-in-docs'))).toBe(false)
  // (ii) With no marks (Escape clears them) New Folder goes to the root: the field says "in the root" and the new folder is at the top of the disk.
  await page.keyboard.press('Escape')
  await expect(tree(page).locator('[role=treeitem][data-marked=true]')).toHaveCount(0)
  await page.getByRole('button', { name: 'New Folder…' }).click()
  await expect(field(page)).toHaveAttribute('placeholder', 'New folder in the root')
  await expect(field(page)).toHaveAttribute('title', 'New folder in the root')
  await field(page).fill('top-folder')
  await field(page).press('Enter')
  await expect(item(page, 'top-folder')).toBeVisible()
  expect(fs.statSync(onDisk('top-folder')).isDirectory()).toBe(true)
  // (iii) Switching roots does not re-fire the create request: the name field is gone on the way out and stays gone on the way back.
  await expect(field(page)).toHaveCount(0)
  await openFolders(page).getByRole('option', { name: 'other' }).click()
  await expect(openFolders(page).getByRole('option', { name: 'other' })).toHaveAttribute('aria-selected', 'true')
  await expect(field(page)).toHaveCount(0)
  await openFolders(page).getByRole('option', { name: 'work' }).click()
  await expect(openFolders(page).getByRole('option', { name: 'work' })).toHaveAttribute('aria-selected', 'true')
  await expect(field(page)).toHaveCount(0)
  await expect(item(page, 'top-folder')).toBeVisible()
  await expect(item(page, 'a.txt')).toBeVisible()
  // The listing is drawn now: a replayed request would have opened its field by this time.
  await page.waitForTimeout(500)
  await expect(field(page)).toHaveCount(0)
  // The second root was never touched.
  expect(fs.readFileSync(onOther('note.txt'), 'utf8')).toBe('a note')
})

test('a click on the name of a folder opens it and never closes it; the chevron closes it; a double click on the name closes an open folder (issue #71, part c)', async () => {
  const page = await launch(work)
  const docs = item(page, 'docs')
  await expect(docs).toHaveAttribute('aria-expanded', 'false')
  await docs.click()
  await expect(docs).toHaveAttribute('aria-expanded', 'true')
  // The name again: it stays open (it is the row the next New Folder… will use).
  await docs.click()
  await expect(docs).toHaveAttribute('aria-expanded', 'true')
  // The chevron closes it, and opens it again.
  await docs.locator('[data-chevron]').click()
  await expect(docs).toHaveAttribute('aria-expanded', 'false')
  await docs.locator('[data-chevron]').click()
  await expect(docs).toHaveAttribute('aria-expanded', 'true')
  // A double click on the name of an open folder closes it; on a closed one it ends open.
  await docs.dblclick()
  await expect(docs).toHaveAttribute('aria-expanded', 'false')
  await docs.dblclick()
  await expect(docs).toHaveAttribute('aria-expanded', 'true')
})
