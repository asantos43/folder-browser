import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { zipSync } from '../fixtures/zip.ts'

// End-to-end: a folder of the tree made the root of the Explorer's Files from its menu; and the colour of the line between the Explorer and the editors.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-root-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(path.join(work, 'projects', 'harbor'), { recursive: true })
  fs.writeFileSync(path.join(work, 'projects', 'harbor', 'plan.txt'), 'the plan of the harbor')
  fs.writeFileSync(path.join(work, 'projects', 'notes.txt'), 'notes')
  fs.writeFileSync(path.join(work, 'top.txt'), 'top')
  fs.writeFileSync(path.join(work, 'pack.zip'), zipSync([{ name: 'inside/a.txt', data: 'in a zip' }]))
})
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {})
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
const rowNames = (page: Page) => tree(page).getByRole('treeitem').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')))

test('Open as Explorer Root in the menu of a folder makes it the root of the Files (the folder is opened as a root of its own and chosen); the first folder stays open', async () => {
  const page = await launch(work)
  await item(page, 'projects').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open as Explorer Root' }).click()
  // The Files now start in `projects`: its entries are the top of the tree, and the title says so.
  await expect.poll(() => rowNames(page)).toEqual(['harbor', 'notes.txt'])
  await expect(page.getByText(/FILES — PROJECTS/i)).toBeVisible()
  const open = page.getByRole('listbox', { name: 'Open Folders' })
  await expect(open.getByText('projects')).toBeVisible()
  await expect(open.getByText('work')).toBeVisible()
  // Back to the first folder from the list of the open ones.
  await open.getByText('work').click()
  await expect.poll(() => rowNames(page)).toEqual(['projects', 'pack.zip', 'top.txt'])
})

test('a ZIP file can be made the root of the Files too; a file and an entry of a ZIP have no such item', async () => {
  const page = await launch(work)
  await item(page, 'top.txt').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Open as Explorer Root' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await item(page, 'pack.zip').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open as Explorer Root' }).click()
  await expect.poll(() => rowNames(page)).toEqual(['inside'])
  await item(page, 'inside').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Open as Explorer Root' })).toHaveCount(0)
})

test('the line between the Explorer and the editors is visible in Dark+, and Settings choose its colour', async () => {
  const page = await launch(work)
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Dark+' }).click()
  const line = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--separator-border').trim())
  // The default is a grey that shows on the black, not the colour of the black itself.
  expect(await line()).toBe('#3c3c3c')
  await page.keyboard.press('ControlOrMeta+,')
  const picker = page.getByLabel('Divider Line Colour')
  await picker.fill('#ff8800')
  expect(await line()).toBe('#ff8800')
  // The choice is kept for the next start, and the button gives the theme's colour back.
  await app!.close()
  const again = await launch(work)
  await again.getByRole('button', { name: 'Manage' }).click()
  await again.getByRole('menuitemcheckbox', { name: 'Dark+' }).click()
  expect(await again.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--separator-border').trim())).toBe('#ff8800')
  await again.keyboard.press('ControlOrMeta+,')
  await again.getByRole('button', { name: 'Use the theme’s colour' }).click()
  expect(await again.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--separator-border').trim())).toBe('#3c3c3c')
})
