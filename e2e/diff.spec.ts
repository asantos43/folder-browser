import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { zipSync } from '../fixtures/zip.ts'

// End-to-end: two text files of a folder, or of a ZIP in it, are compared in a tab (Select for Compare, then Compare with Selected, in the tree's menu).
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-diff-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work)
  fs.writeFileSync(path.join(work, 'a.txt'), 'first\nsecond\nthird\n')
  fs.writeFileSync(path.join(work, 'b.txt'), 'first\n2nd\nthird\nfourth\n')
  fs.writeFileSync(path.join(work, 'pic.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  fs.writeFileSync(path.join(work, 'blob.bin'), Buffer.from([0, 1, 2, 3]))
  fs.writeFileSync(path.join(work, 'pack.zip'), zipSync([{ name: 'in.txt', data: 'first\nsecond\n3rd\n' }]))
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
const menu = (page: Page, name: string | RegExp) => page.getByRole('menuitem', { name })
const diffGroup = (page: Page) => page.getByRole('group', { name: /^Comparison of / })

async function compare(page: Page, left: string, right: string) {
  await item(page, left).click({ button: 'right' })
  await menu(page, 'Select for Compare').click()
  await item(page, right).click({ button: 'right' })
  await menu(page, 'Compare with Selected').click()
}

test('compares two files of a folder side by side, with the changes marked and counted, and the other layout one click away', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').click({ button: 'right' })
  await expect(menu(page, 'Compare with Selected')).toHaveCount(0)
  await menu(page, 'Select for Compare').click()
  await expect(page.getByText('"a.txt" is selected for compare', { exact: false })).toBeVisible()
  await item(page, 'b.txt').click({ button: 'right' })
  await menu(page, 'Compare with Selected').click()

  await expect(page.getByRole('tab', { name: /^a\.txt ↔ b\.txt/ })).toBeVisible()
  await expect(diffGroup(page)).toBeVisible()
  await expect(page.getByText('2 changes')).toBeVisible()
  const left = diffGroup(page).locator('.cm-merge-a')
  const right = diffGroup(page).locator('.cm-merge-b')
  await expect(left).toContainText('second')
  await expect(right).toContainText('fourth')
  await expect(left.locator('.cm-changedLine')).toHaveCount(1)
  await expect(right.locator('.cm-changedLine')).toHaveCount(2)
  // Nothing in it can be typed.
  await expect(left.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')

  await page.getByRole('button', { name: 'Show the two files in one column, the removed lines above the added ones' }).click()
  await expect(diffGroup(page).locator('.cm-editor')).toHaveCount(1)
  await expect(diffGroup(page).locator('.cm-deletedChunk').first()).toContainText('second')
  await expect(page.getByText('2 changes')).toBeVisible()
  await page.getByRole('button', { name: 'Swap Sides' }).click()
  await expect(diffGroup(page).locator('.cm-deletedChunk').first()).toContainText('2nd')
  await page.getByRole('button', { name: 'Show the two files next to each other' }).click()
  await expect(diffGroup(page).locator('.cm-editor')).toHaveCount(2)

  // The files are the same on disk: nothing was written.
  expect(fs.readFileSync(path.join(work, 'a.txt'), 'utf8')).toBe('first\nsecond\nthird\n')
  expect(fs.readFileSync(path.join(work, 'b.txt'), 'utf8')).toBe('first\n2nd\nthird\nfourth\n')
})

test('compares a file of the disk with an entry of a ZIP, and the same pair shows its tab again instead of opening a second', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await expect(item(page, 'in.txt')).toBeVisible()
  await compare(page, 'a.txt', 'in.txt')
  await expect(page.getByRole('tab', { name: /^a\.txt ↔ in\.txt/ })).toBeVisible()
  await expect(diffGroup(page).locator('.cm-merge-b')).toContainText('3rd')
  await expect(page.getByText('1 change', { exact: true })).toBeVisible()
  // The choice is kept: another file can be compared with it, and the same pair again is the same tab.
  await item(page, 'in.txt').click({ button: 'right' })
  await menu(page, 'Compare with Selected').click()
  await expect(page.getByRole('tab', { name: /↔/ })).toHaveCount(1)
})

test('is offered only for text files, and the tab follows a rename of a side and closes when a side goes', async () => {
  const page = await launch(work)
  for (const name of ['pic.png', 'blob.bin', 'pack.zip']) {
    await item(page, name).click({ button: 'right' })
    await expect(menu(page, 'Select for Compare'), name).toHaveCount(0)
    await page.keyboard.press('Escape')
  }
  await compare(page, 'a.txt', 'b.txt')
  await expect(page.getByRole('tab', { name: /^a\.txt ↔ b\.txt/ })).toBeVisible()
  await item(page, 'b.txt').click()
  await item(page, 'b.txt').press('F2')
  await page.getByRole('textbox', { name: 'Name' }).fill('c.txt')
  await page.getByRole('textbox', { name: 'Name' }).press('Enter')
  await expect(page.getByRole('tab', { name: /^a\.txt ↔ c\.txt/ })).toBeVisible()
  await page.getByRole('tab', { name: /^a\.txt ↔ c\.txt/ }).click()
  await expect(diffGroup(page).locator('.cm-merge-b')).toContainText('fourth')
  await item(page, 'a.txt').focus()
  await page.keyboard.press('Delete')
  await page.getByRole('alertdialog', { name: 'Move to the trash?' }).getByRole('button', { name: 'Move to Trash' }).click()
  // Where the system has no trash it asks again, for good; the answer is the same here.
  await expect(item(page, 'a.txt')).toHaveCount(0, { timeout: 3000 }).catch(async () => {
    await page.getByRole('alertdialog', { name: 'Delete permanently?' }).getByRole('button', { name: 'Delete Permanently' }).click()
  })
  await expect(item(page, 'a.txt')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /↔/ })).toHaveCount(0)
})

test('says why a side cannot be compared when it is not text', async () => {
  const page = await launch(work)
  // A file the tree takes for text by its name, which is not (a NUL byte), is refused with its name.
  fs.writeFileSync(path.join(work, 'fake.txt'), Buffer.from([104, 0, 105]))
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(item(page, 'fake.txt')).toBeVisible()
  await compare(page, 'a.txt', 'fake.txt')
  await expect(page.getByRole('alert')).toContainText('fake.txt is not a text file')
})
