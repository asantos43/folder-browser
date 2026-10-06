import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { openZipBuffer } from '../core/zip.ts'
import { zipBuffer } from '../fixtures/zip.ts'

// End-to-end: several rows of the tree marked at once (Ctrl+click, Shift+click, the keyboard), and moved, copied, deleted and compared together.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-multi-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(path.join(work, 'docs'), { recursive: true })
  fs.mkdirSync(path.join(work, 'empty'))
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) fs.writeFileSync(path.join(work, name), `the words of ${name}\n`)
  fs.writeFileSync(path.join(work, 'docs', 'readme.md'), 'plain readme text')
  fs.writeFileSync(path.join(work, 'pack.zip'), await zipBuffer([{ name: 'one.txt', data: '1' }, { name: 'two.txt', data: '2' }, { name: 'three.txt', data: '3' }, { name: 'dir/' }]))
})
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...args: string[]): Promise<Page> {
  // The trash of the test is its own (under XDG_DATA_HOME), never the user's.
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, ...args], env: { ...process.env, XDG_DATA_HOME: path.join(dir, 'data') } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
const item = (page: Page, name: string) => page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name, exact: true })
const onDisk = (...p: string[]) => path.join(work, ...p)
const menu = (page: Page, name: string | RegExp) => page.getByRole('menuitem', { name })
const marked = (page: Page) => page.getByRole('tree', { name: 'Files and folders' }).locator('[role=treeitem][data-marked=true]')
const inZip = async () => (await openZipBuffer(fs.readFileSync(onDisk('pack.zip')))).entries.map((e) => e.name).sort()

test('Ctrl+click and Shift+click mark rows without opening them; a plain click opens one and clears the marks', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').click()
  await expect(page.getByRole('tab', { name: /^a\.txt/ })).toBeVisible()
  await item(page, 'c.txt').click({ modifiers: ['ControlOrMeta'] })
  await expect(marked(page)).toHaveCount(2)
  await expect(page.getByRole('tab', { name: /^c\.txt/ })).toHaveCount(0)
  await item(page, 'd.txt').click({ modifiers: ['Shift'] })
  await expect(marked(page)).toHaveCount(2)
  // (A range starts at the row clicked last: c.txt.)
  await item(page, 'a.txt').click({ modifiers: ['Shift'] })
  await expect(marked(page)).toHaveCount(3)
  await item(page, 'b.txt').click()
  await expect(marked(page)).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /^b\.txt/ })).toBeVisible()
  // The keyboard marks too: Shift+arrows, Esc, Ctrl+A.
  await item(page, 'b.txt').focus()
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(marked(page)).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(marked(page)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+a')
  await expect(marked(page)).toHaveCount(await page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem').count())
})

test('Delete asks once for all the marked rows and moves them to the trash', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').click()
  await item(page, 'b.txt').click({ modifiers: ['ControlOrMeta'] })
  await item(page, 'd.txt').click({ modifiers: ['ControlOrMeta'] })
  await page.keyboard.press('Delete')
  const ask = page.getByRole('alertdialog', { name: 'Move to the trash?' })
  await expect(ask).toContainText('3 items')
  await ask.getByRole('button', { name: 'Move to Trash' }).click()
  // (The test has no trash that can take them: the question is asked again for all of them, for good this time.)
  const forever = page.getByRole('alertdialog', { name: 'Delete permanently?' })
  await expect(forever).toContainText('The trash could not take 3 items')
  await forever.getByRole('button', { name: 'Delete Permanently' }).click()
  await expect(page.getByText('Deleted 3 items.')).toBeVisible()
  for (const gone of ['a.txt', 'b.txt', 'd.txt']) expect(fs.existsSync(onDisk(gone))).toBe(false)
  expect(fs.existsSync(onDisk('c.txt'))).toBe(true)
  await expect(item(page, 'a.txt')).toHaveCount(0)
  await expect(item(page, 'c.txt')).toBeVisible()
})

test('a folder marked with a file in it is deleted once, and Shift+Delete asks for the permanent delete', async () => {
  const page = await launch(work)
  await item(page, 'docs').click()
  await expect(item(page, 'readme.md')).toBeVisible()
  await item(page, 'docs').click({ modifiers: ['ControlOrMeta'] })
  await item(page, 'readme.md').click({ modifiers: ['ControlOrMeta'] })
  await item(page, 'c.txt').click({ modifiers: ['ControlOrMeta'] })
  await page.keyboard.press('Shift+Delete')
  const ask = page.getByRole('alertdialog', { name: 'Delete permanently?' })
  await expect(ask).toContainText('2 items')
  await ask.getByRole('button', { name: 'Delete Permanently' }).click()
  await expect(page.getByText('Deleted 2 items.')).toBeVisible()
  expect(fs.existsSync(onDisk('docs'))).toBe(false)
  expect(fs.existsSync(onDisk('c.txt'))).toBe(false)
})

test('marked rows are dragged together onto a folder, and moved; with Shift they are copied', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').click()
  await item(page, 'c.txt').click({ modifiers: ['Shift'] })
  await expect(marked(page)).toHaveCount(3)
  await item(page, 'b.txt').dragTo(item(page, 'empty'))
  await expect.poll(() => fs.readdirSync(onDisk('empty')).sort()).toEqual(['a.txt', 'b.txt', 'c.txt'])
  for (const gone of ['a.txt', 'b.txt', 'c.txt']) expect(fs.existsSync(onDisk(gone))).toBe(false)
  expect(fs.existsSync(onDisk('d.txt'))).toBe(true)
  await expect(page.getByText('Moved 3 items to empty.')).toBeVisible()
})

test('Move to… in the menu of marked rows moves them all to the folder that is picked', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').click()
  await item(page, 'd.txt').click({ modifiers: ['ControlOrMeta'] })
  await item(page, 'd.txt').click({ button: 'right' })
  await expect(menu(page, /^Rename/)).toHaveCount(0)
  await menu(page, 'Move 2 Items to…').click()
  const dialog = page.getByRole('dialog', { name: 'Move 2 items to…' })
  await dialog.getByRole('treeitem', { name: 'docs' }).click()
  await dialog.getByRole('button', { name: 'Move Here' }).click()
  await expect.poll(() => fs.readdirSync(onDisk('docs')).sort()).toEqual(['a.txt', 'd.txt', 'readme.md'])
  expect(fs.existsSync(onDisk('a.txt'))).toBe(false)
})

test('two marked text files are compared from their menu', async () => {
  const page = await launch(work)
  fs.writeFileSync(onDisk('b.txt'), 'the words of b.txt\nand one more line\n')
  await item(page, 'a.txt').click()
  await item(page, 'b.txt').click({ modifiers: ['ControlOrMeta'] })
  await item(page, 'b.txt').click({ button: 'right' })
  await menu(page, 'Compare Selected').click()
  await expect(page.getByRole('tab', { name: /^a\.txt ↔ b\.txt/ })).toBeVisible()
  await expect(page.getByRole('group', { name: /^Comparison of / })).toBeVisible()
})

test('inside a ZIP, several entries are marked and deleted together (for good, asked at once), and dragged onto a folder of it', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await expect(item(page, 'dir')).toBeVisible()
  await item(page, 'one.txt').click()
  await item(page, 'two.txt').click({ modifiers: ['ControlOrMeta'] })
  await item(page, 'two.txt').dragTo(item(page, 'dir'))
  await expect.poll(inZip).toEqual(['dir/', 'dir/one.txt', 'dir/two.txt', 'three.txt'])
  await expect(page.getByText('Moved 2 items to dir.')).toBeVisible()
  await item(page, 'three.txt').click()
  await item(page, 'dir').click({ modifiers: ['ControlOrMeta'] })
  await page.keyboard.press('Delete')
  const ask = page.getByRole('alertdialog', { name: 'Delete permanently?' })
  await expect(ask).toContainText('2 items')
  await ask.getByRole('button', { name: 'Delete Permanently' }).click()
  await expect.poll(inZip).toEqual([])
})

test('Ctrl+C then Ctrl+V copies the marked rows into the folder that has the focus (numbered, nothing replaced); Ctrl+X then Ctrl+V moves them', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').click()
  await item(page, 'b.txt').click({ modifiers: ['ControlOrMeta'] })
  await page.keyboard.press('ControlOrMeta+c')
  // (The keys go to the row that has the focus: a click that opens a file moves the focus to its editor a moment later.)
  await item(page, 'empty').focus()
  await page.keyboard.press('ControlOrMeta+v')
  await expect.poll(() => fs.readdirSync(onDisk('empty')).sort()).toEqual(['a.txt', 'b.txt'])
  expect(fs.existsSync(onDisk('a.txt'))).toBe(true)
  await expect(page.getByText('Copied 2 items to empty.')).toBeVisible()
  // Pasting again, next to a file of the same folder, makes numbered copies: nothing is replaced.
  await item(page, 'a.txt').last().focus()
  await page.keyboard.press('ControlOrMeta+v')
  await expect.poll(() => fs.readdirSync(onDisk()).filter((n) => n.includes('('))).toEqual(['a (2).txt', 'b (2).txt'])
  // Cut and paste moves, once.
  await item(page, 'c.txt').focus()
  await page.keyboard.press('Escape') // (the marks are let go)
  await page.keyboard.press('ControlOrMeta+x')
  await item(page, 'docs').focus()
  await page.keyboard.press('ControlOrMeta+v')
  await expect.poll(() => fs.existsSync(onDisk('docs', 'c.txt'))).toBe(true)
  expect(fs.existsSync(onDisk('c.txt'))).toBe(false)
  // What was cut is pasted once: another Paste does nothing.
  await item(page, 'empty').focus()
  await page.keyboard.press('ControlOrMeta+v')
  await page.waitForTimeout(500)
  expect(fs.existsSync(onDisk('empty', 'c.txt'))).toBe(false)
  expect(fs.existsSync(onDisk('docs', 'c (2).txt'))).toBe(false)
})

test('Cut, Copy and Paste are in the menu of a file and of a folder; inside a ZIP they work in the same ZIP', async () => {
  const page = await launch(work)
  await item(page, 'd.txt').click({ button: 'right' })
  await expect(menu(page, /^Paste/)).toHaveCount(0)
  await menu(page, /^Cut/).click()
  await item(page, 'empty').click({ button: 'right' })
  await menu(page, /^Paste/).click()
  await expect.poll(() => fs.existsSync(onDisk('empty', 'd.txt'))).toBe(true)
  expect(fs.existsSync(onDisk('d.txt'))).toBe(false)
  // In a ZIP.
  await item(page, 'pack.zip').click()
  await expect(item(page, 'dir')).toBeVisible()
  await item(page, 'one.txt').click({ button: 'right' })
  await menu(page, /^Copy(?! Path| Name)/).click()
  await item(page, 'dir').click({ button: 'right' })
  await menu(page, /^Paste/).click()
  await expect.poll(inZip).toEqual(['dir/', 'dir/one.txt', 'one.txt', 'three.txt', 'two.txt'])
  // From the disk into the ZIP is refused, and both are as they were.
  await item(page, 'c.txt').click({ button: 'right' })
  await menu(page, /^Copy(?! Path| Name)/).click()
  await item(page, 'dir').click({ button: 'right' })
  await menu(page, /^Paste/).click()
  await expect(page.getByText(/Could not copy c\.txt/)).toBeVisible()
  expect(await inZip()).toEqual(['dir/', 'dir/one.txt', 'one.txt', 'three.txt', 'two.txt'])
})
