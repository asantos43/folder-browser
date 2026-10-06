import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { zipSync } from '../fixtures/zip.ts'

// End-to-end: make, rename, move and delete files and folders of a folder that was opened, in the tree; the tabs follow what moves and close with what goes.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-ops-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(path.join(work, 'docs', 'deep'), { recursive: true })
  fs.mkdirSync(path.join(work, 'empty'))
  fs.writeFileSync(path.join(work, 'a.txt'), 'the words of a')
  fs.writeFileSync(path.join(work, 'b.txt'), 'the words of b')
  fs.writeFileSync(path.join(work, 'docs', 'readme.md'), 'plain readme text')
  fs.writeFileSync(path.join(work, 'docs', 'deep', 'n.txt'), 'deep note')
  fs.writeFileSync(path.join(work, 'pack.zip'), zipSync([{ name: 'in.txt', data: 'inside the zip' }]))
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
const tree = (page: Page) => page.getByRole('tree', { name: 'Files and folders' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true })
const field = (page: Page) => page.getByRole('textbox', { name: 'Name' })
const onDisk = (...p: string[]) => path.join(work, ...p)
const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name: typeof name === 'string' ? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : name })
const menu = (page: Page, name: string | RegExp) => page.getByRole('menuitem', { name })

test('New File in the header makes an empty file where the focus is, named in the row; a taken or a bad name is said, and Escape gives up', async () => {
  const page = await launch(work)
  await item(page, 'docs').click()
  await expect(item(page, 'docs')).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'New File…' }).click()
  await expect(field(page)).toBeFocused()
  await field(page).fill('a/b')
  await field(page).press('Enter')
  await expect(page.getByRole('alert')).toContainText('cannot contain')
  await field(page).fill('readme.md')
  await field(page).press('Enter')
  await expect(page.getByRole('alert')).toContainText('already exists')
  await field(page).fill('notes.txt')
  await field(page).press('Enter')
  await expect(item(page, 'notes.txt')).toBeVisible()
  expect(fs.readFileSync(onDisk('docs', 'notes.txt'), 'utf8')).toBe('')
  // Escape leaves nothing behind.
  await page.getByRole('button', { name: 'New Folder…' }).click()
  await field(page).fill('never')
  await field(page).press('Escape')
  await expect(field(page)).toHaveCount(0)
  expect(fs.existsSync(onDisk('docs', 'never'))).toBe(false)
})

test('New Folder from the menu of a folder, and from the empty part of the tree (in the root)', async () => {
  const page = await launch(work)
  await item(page, 'empty').click({ button: 'right' })
  await menu(page, 'New Folder…').click()
  await field(page).fill('inner')
  await field(page).press('Enter')
  await expect(item(page, 'inner')).toBeVisible()
  expect(fs.statSync(onDisk('empty', 'inner')).isDirectory()).toBe(true)
  await tree(page).locator('[data-blank]').click({ button: 'right' })
  await menu(page, 'New File…').click()
  await field(page).fill('top.txt')
  await field(page).press('Enter')
  await expect(item(page, 'top.txt')).toBeVisible()
  expect(fs.existsSync(onDisk('top.txt'))).toBe(true)
})

test('F2 renames in the row; the tab of the file follows it and still shows it; a name that is taken is refused', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dblclick()
  await expect(page.locator('.cm-content')).toContainText('the words of a')
  await item(page, 'a.txt').focus()
  await page.keyboard.press('F2')
  await expect(field(page)).toHaveValue('a.txt')
  await field(page).fill('b.txt')
  await field(page).press('Enter')
  await expect(page.getByRole('alert')).toContainText('already exists')
  expect(fs.existsSync(onDisk('a.txt'))).toBe(true)
  await field(page).fill('renamed.txt')
  await field(page).press('Enter')
  await expect(item(page, 'renamed.txt')).toBeVisible()
  await expect(item(page, 'a.txt')).toHaveCount(0)
  expect(fs.readFileSync(onDisk('renamed.txt'), 'utf8')).toBe('the words of a')
  expect(fs.existsSync(onDisk('a.txt'))).toBe(false)
  await expect(tab(page, 'renamed.txt')).toBeVisible()
  await expect(tab(page, 'a.txt')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('the words of a')
})

test('renaming a folder takes the tabs of what is in it, and the folder stays open', async () => {
  const page = await launch(work)
  await item(page, 'docs').click()
  await item(page, 'readme.md').dblclick()
  await expect(page.locator('.cm-content, .markdown-body').first()).toContainText('plain readme text')
  await item(page, 'docs').click({ button: 'right' })
  await menu(page, /^Rename/).click()
  await field(page).fill('papers')
  await field(page).press('Enter')
  await expect(item(page, 'papers')).toBeVisible()
  await expect(item(page, 'readme.md')).toBeVisible()
  expect(fs.existsSync(onDisk('papers', 'readme.md'))).toBe(true)
  await expect(tab(page, 'readme.md')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toBeVisible()
  await page.getByRole('tab', { name: /^readme\.md/ }).hover()
  await expect(page.getByRole('tab', { name: /^readme\.md/ })).toHaveAttribute('title', /papers/)
})

test('Delete asks, and moves the file to the trash: it is gone from the folder, its tab closes, and Cancel leaves everything', async () => {
  const page = await launch(work)
  await item(page, 'b.txt').dblclick()
  await expect(page.locator('.cm-content')).toContainText('the words of b')
  await item(page, 'b.txt').focus()
  await page.keyboard.press('Delete')
  const ask = page.getByRole('alertdialog', { name: 'Move to the trash?' })
  await expect(ask).toContainText('b.txt')
  await ask.getByRole('button', { name: 'Cancel' }).click()
  expect(fs.existsSync(onDisk('b.txt'))).toBe(true)
  await item(page, 'b.txt').focus()
  await page.keyboard.press('Delete')
  await ask.getByRole('button', { name: 'Move to Trash' }).click()
  // Where the system has no trash it asks again, for good; the answer is the same here.
  const forever = page.getByRole('alertdialog', { name: 'Delete permanently?' })
  await expect(item(page, 'b.txt')).toHaveCount(0, { timeout: 3000 }).catch(async () => {
    await forever.getByRole('button', { name: 'Delete Permanently' }).click()
  })
  await expect(item(page, 'b.txt')).toHaveCount(0)
  expect(fs.existsSync(onDisk('b.txt'))).toBe(false)
  await expect(tab(page, 'b.txt')).toHaveCount(0)
  expect(fs.existsSync(onDisk('a.txt'))).toBe(true)
})

test('deleting a folder takes everything in it and the tabs of it; the message says so', async () => {
  const page = await launch(work)
  await item(page, 'docs').click()
  await item(page, 'readme.md').dblclick()
  await expect(tab(page, 'readme.md')).toBeVisible()
  await item(page, 'docs').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Delete/ }).click()
  const ask = page.getByRole('alertdialog', { name: 'Move to the trash?' })
  await expect(ask).toContainText('and everything in it')
  await ask.getByRole('button', { name: 'Move to Trash' }).click()
  await page.getByRole('alertdialog', { name: 'Delete permanently?' }).getByRole('button', { name: 'Delete Permanently' }).click({ timeout: 3000 }).catch(() => undefined)
  await expect(item(page, 'docs')).toHaveCount(0)
  expect(fs.existsSync(onDisk('docs'))).toBe(false)
  await expect(tab(page, 'readme.md')).toHaveCount(0)
})

test('Move to… asks for a folder (never the one it is in, nor, for a folder, itself or what is in it) and moves; the tab follows', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dblclick()
  await expect(page.locator('.cm-content')).toContainText('the words of a')
  await item(page, 'a.txt').click({ button: 'right' })
  await menu(page, 'Move to…').click()
  const dialog = page.getByRole('dialog', { name: /^Move “a.txt” to/ })
  await expect(dialog).toBeVisible()
  const move = dialog.getByRole('button', { name: 'Move Here' })
  await expect(move).toBeDisabled()
  await dialog.getByRole('treeitem', { name: 'docs' }).click()
  await expect(move).toBeEnabled()
  await move.click()
  await expect(dialog).toHaveCount(0)
  expect(fs.readFileSync(onDisk('docs', 'a.txt'), 'utf8')).toBe('the words of a')
  expect(fs.existsSync(onDisk('a.txt'))).toBe(false)
  await expect(page.getByText(/Moved a\.txt to docs/)).toBeVisible()
  await expect(tab(page, 'a.txt')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('the words of a')
  // A folder is not offered itself, nor what is in it.
  await item(page, 'docs').click({ button: 'right' })
  await menu(page, 'Move to…').click()
  const second = page.getByRole('dialog', { name: /^Move “docs” to/ })
  await expect(second.getByRole('treeitem', { name: 'empty' })).toBeVisible()
  await expect(second.getByRole('treeitem', { name: 'docs' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(second).toHaveCount(0)
})

test('dragging a file onto a folder moves it, and dragging onto the empty part moves it to the root', async () => {
  const page = await launch(work)
  await item(page, 'docs').click()
  await item(page, 'b.txt').dragTo(item(page, 'empty'))
  await expect.poll(() => fs.existsSync(onDisk('empty', 'b.txt'))).toBe(true)
  expect(fs.existsSync(onDisk('b.txt'))).toBe(false)
  await item(page, 'empty').click()
  // (Onto a file that is not a text, it goes to the folder that file is in; onto a text it asks what to do with the two: e2e/split.spec.ts.)
  await item(page, 'b.txt').dragTo(item(page, 'pack.zip'))
  await expect.poll(() => fs.existsSync(onDisk('b.txt'))).toBe(true)
  expect(fs.existsSync(onDisk('empty', 'b.txt'))).toBe(false)
})

test('a move onto a name that is taken is refused, and both files are as they were', async () => {
  const page = await launch(work)
  // A move onto a name that is taken is refused, and both files are as they were.
  fs.writeFileSync(onDisk('docs', 'a.txt'), 'other a')
  await item(page, 'docs').click()
  await item(page, 'a.txt').first().dragTo(item(page, 'docs'))
  await expect(page.getByText(/Could not move a\.txt/)).toBeVisible()
  expect(fs.readFileSync(onDisk('a.txt'), 'utf8')).toBe('the words of a')
  expect(fs.readFileSync(onDisk('docs', 'a.txt'), 'utf8')).toBe('other a')
})

test('Shift+Delete asks for the permanent delete at once; Shift held while the question about the trash is on screen turns it into the same', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').focus()
  await page.keyboard.press('Shift+Delete')
  const forever = page.getByRole('alertdialog', { name: 'Delete permanently?' })
  await expect(forever).toContainText('This cannot be undone')
  await forever.getByRole('button', { name: 'Cancel' }).click()
  expect(fs.existsSync(onDisk('a.txt'))).toBe(true)
  // The question about the trash, and Shift held.
  await item(page, 'b.txt').focus()
  await page.keyboard.press('Delete')
  const trash = page.getByRole('alertdialog', { name: 'Move to the trash?' })
  await expect(trash).toContainText('Hold Shift')
  await page.keyboard.down('Shift')
  await expect(forever).toBeVisible()
  await expect(forever.getByRole('button', { name: 'Delete Permanently' })).toBeVisible()
  await page.keyboard.up('Shift')
  await expect(trash).toBeVisible()
  await page.keyboard.down('Shift')
  await forever.getByRole('button', { name: 'Delete Permanently' }).click()
  await page.keyboard.up('Shift')
  await expect(item(page, 'b.txt')).toHaveCount(0)
  expect(fs.existsSync(onDisk('b.txt'))).toBe(false)
  // Gone for good: nothing of it in the trash.
  const trashed = path.join(dir, 'data', 'Trash', 'files')
  expect(fs.existsSync(trashed) ? fs.readdirSync(trashed) : []).not.toContain('b.txt')
  expect(fs.existsSync(onDisk('a.txt'))).toBe(true)
})

/**
 * Drags a row onto another with Shift pressed during the drag, as a person does (Chromium does not start a drag when the mouse goes down with Shift already held: Shift
 * and a click select, so the key is pressed after the drag has begun).
 */
async function dragWithShift(page: Page, from: ReturnType<typeof item>, to: ReturnType<typeof item>) {
  const middle = async (row: typeof from) => {
    const box = (await row.boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const a = await middle(from)
  const b = await middle(to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + 6, a.y + 6, { steps: 3 })
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.keyboard.down('Shift')
  await page.mouse.move(b.x + 2, b.y + 1, { steps: 2 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
}

test('dragging with Shift held copies instead of moving: a copy in the folder, a duplicate in the same folder, and the original stays', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dragTo(item(page, 'empty'))
  await expect.poll(() => fs.existsSync(onDisk('empty', 'a.txt'))).toBe(true)
  expect(fs.existsSync(onDisk('a.txt'))).toBe(false)
  await item(page, 'empty').click()
  await dragWithShift(page, item(page, 'b.txt'), item(page, 'empty'))
  await expect.poll(() => fs.existsSync(onDisk('empty', 'b.txt'))).toBe(true)
  expect(fs.readFileSync(onDisk('b.txt'), 'utf8')).toBe('the words of b')
  await expect(page.getByText(/Copied b\.txt to empty/)).toBeVisible()
  // A copy of a folder, with all that is in it.
  await dragWithShift(page, item(page, 'docs'), item(page, 'empty'))
  await expect.poll(() => fs.existsSync(onDisk('empty', 'docs', 'deep', 'n.txt'))).toBe(true)
  expect(fs.existsSync(onDisk('docs', 'deep', 'n.txt'))).toBe(true)
  // A copy into another folder, then a duplicate in its own folder (dropped on a row of the folder it is in): numbered.
  await item(page, 'empty').click()
  await expect(item(page, 'n.txt')).toHaveCount(0)
  await dragWithShift(page, item(page, 'b.txt'), item(page, 'docs'))
  await expect.poll(() => fs.existsSync(onDisk('docs', 'b.txt'))).toBe(true)
  await dragWithShift(page, item(page, 'b.txt'), item(page, 'pack.zip'))
  await expect.poll(() => fs.existsSync(onDisk('b (2).txt'))).toBe(true)
  expect(fs.readFileSync(onDisk('b (2).txt'), 'utf8')).toBe('the words of b')
  await expect(page.getByText(/Copied b\.txt to .* as b \(2\)\.txt/)).toBeVisible()
})

test('a dragged item resting on a closed folder opens it, and again one level down, to be dropped where it is wanted', async () => {
  const page = await launch(work)
  const center = async (name: string) => {
    const box = (await item(page, name).boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  await expect(item(page, 'deep')).toHaveCount(0)
  const from = await center('b.txt')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 5, from.y + 5, { steps: 3 })
  const docs = await center('docs')
  await page.mouse.move(docs.x, docs.y, { steps: 8 })
  // Still closed at first; after a moment it opens.
  await expect(item(page, 'deep')).toBeVisible({ timeout: 4000 })
  const deep = await center('deep')
  await page.mouse.move(deep.x, deep.y, { steps: 6 })
  await expect(item(page, 'n.txt')).toBeVisible({ timeout: 4000 })
  await page.mouse.up()
  await expect.poll(() => fs.existsSync(onDisk('docs', 'deep', 'b.txt'))).toBe(true)
  expect(fs.existsSync(onDisk('b.txt'))).toBe(false)
})

test('Shift held while choosing Delete in the menu asks for the permanent delete (Shift already down when the question opens)', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').click({ button: 'right' })
  await page.keyboard.down('Shift')
  await page.getByRole('menuitem', { name: /^Delete/ }).click()
  const forever = page.getByRole('alertdialog', { name: 'Delete permanently?' })
  await expect(forever).toBeVisible()
  await expect(forever.getByRole('button', { name: 'Delete Permanently' })).toBeVisible()
  // Let go of Shift: it is the question about the trash again.
  await page.keyboard.up('Shift')
  await expect(page.getByRole('alertdialog', { name: 'Move to the trash?' })).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  expect(fs.existsSync(onDisk('a.txt'))).toBe(true)
  // And without Shift, the menu asks about the trash as before.
  await item(page, 'a.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Delete/ }).click()
  await expect(page.getByRole('alertdialog', { name: 'Move to the trash?' })).toBeVisible()
})
