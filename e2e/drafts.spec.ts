import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: the changes of a text that are not saved are kept for the next start (a hot exit), and come back in their tab.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined
const profile = () => path.join(dir, 'profile')
const drafts = () => path.join(profile(), 'drafts')
const draftFiles = () => (fs.existsSync(drafts()) ? fs.readdirSync(drafts()).filter((n) => n.endsWith('.json')) : [])

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-drafts-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'a.txt'), 'first line\nsecond line\n')
  fs.writeFileSync(path.join(work, 'b.txt'), 'the b file\n')
})
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {})
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...args: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile()}`, ...noSandbox, ...args], env: { ...process.env, XDG_DATA_HOME: path.join(dir, 'data') } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
/** Closes the window as a person does (the application goes away when its window does). */
async function quit(page: Page) {
  await Promise.all([page.waitForEvent('close'), app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())])
  await app!.close().catch(() => {})
  app = undefined
}
const item = (page: Page, name: string) => page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name, exact: true })
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
const editor = (page: Page) => page.locator('.cm-content')
async function typeAtEnd(page: Page, text: string) {
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(text)
}
const onDisk = (name: string) => fs.readFileSync(path.join(work, name), 'utf8')

test('closing the application with changes not saved asks nothing, and the next start shows the file with its changes, still not saved', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dblclick()
  await typeAtEnd(page, 'unsaved third line')
  // A draft is written a moment after the changes pause.
  await expect.poll(draftFiles).toHaveLength(1)
  await quit(page)
  expect(onDisk('a.txt')).toBe('first line\nsecond line\n')

  const again = await launch()
  await expect(tab(again, 'a.txt')).toBeVisible()
  await expect(tab(again, 'a.txt')).toContainText('Modified')
  await expect(editor(again)).toContainText('unsaved third line')
  await expect(again.getByText('Changes of a.txt that were not saved were restored.')).toBeVisible()
  expect(onDisk('a.txt')).toBe('first line\nsecond line\n')
  // And it is saved as any other change.
  await again.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => onDisk('a.txt')).toBe('first line\nsecond line\nunsaved third line')
  await expect(tab(again, 'a.txt')).not.toContainText('Modified')
  await expect.poll(draftFiles).toHaveLength(0)
})

test('the changes made in the last moments before the window closes are kept too (they are written when it closes)', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dblclick()
  await typeAtEnd(page, ' last words')
  await quit(page)
  const again = await launch()
  await expect(editor(again)).toContainText('last words')
})

test('closing a tab and choosing Don’t Save forgets its changes for good: the next start does not bring it back', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dblclick()
  await typeAtEnd(page, ' to be thrown away')
  await expect.poll(draftFiles).toHaveLength(1)
  await page.keyboard.press('ControlOrMeta+w')
  await page.getByRole('alertdialog', { name: 'Save changes?' }).getByRole('button', { name: 'Don’t Save' }).click()
  await expect.poll(draftFiles).toHaveLength(0)
  await quit(page)
  const again = await launch()
  await expect(again.getByRole('tab')).toHaveCount(0)
})

test('undoing every change leaves no draft, and a saved file leaves none', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dblclick()
  await typeAtEnd(page, 'xyz')
  await expect.poll(draftFiles).toHaveLength(1)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(tab(page, 'a.txt')).not.toContainText('Modified')
  await expect.poll(draftFiles).toHaveLength(0)
})

test('a file that changed on disk while the application was closed: the changes come back, and Save asks before it overwrites', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dblclick()
  await typeAtEnd(page, ' mine')
  await expect.poll(draftFiles).toHaveLength(1)
  await quit(page)
  fs.writeFileSync(path.join(work, 'a.txt'), 'written by something else meanwhile\n')
  const again = await launch()
  await expect(editor(again)).toContainText('first line')
  await expect(editor(again)).toContainText('mine')
  await again.keyboard.press('ControlOrMeta+s')
  const ask = again.getByRole('alertdialog', { name: 'The file changed on disk' })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Load from Disk' }).click()
  await expect(editor(again)).toContainText('written by something else meanwhile')
  await expect.poll(draftFiles).toHaveLength(0)
})

test('with the setting off, closing the window asks as before and nothing is kept for the next start', async () => {
  const page = await launch(work)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('checkbox', { name: 'Keep changes that are not saved' }).uncheck()
  await item(page, 'a.txt').dblclick()
  await typeAtEnd(page, ' x')
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect(page.getByRole('alertdialog', { name: 'Close with unsaved changes?' })).toBeVisible()
  expect(draftFiles()).toHaveLength(0)
})
