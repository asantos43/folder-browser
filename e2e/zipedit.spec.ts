import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { openZipBuffer } from '../core/zip.ts'
import { zipBuffer } from '../fixtures/zip.ts'

// End-to-end: change what is inside a ZIP, in the tree and in the editor, and read the ZIP file back from the disk to see what it holds.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-zipedit-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work, { recursive: true })
  const inner = await zipBuffer([{ name: 'deep.txt', data: 'deep in a ZIP in a ZIP' }])
  fs.writeFileSync(
    path.join(work, 'pack.zip'),
    await zipBuffer([{ name: 'in.txt', data: 'inside the zip' }, { name: 'docs/' }, { name: 'docs/readme.md', data: '# readme' }, { name: 'docs/note.txt', data: 'a note' }, { name: 'nested.zip', data: inner }]),
  )
  fs.writeFileSync(path.join(work, 'other.txt'), 'on the disk')
})
test.afterEach(async () => {
  // (A window with changes not saved asks before it closes: the test does not answer, it takes the window down.)
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
const item = (page: Page, name: string) => page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name, exact: true })
const field = (page: Page) => page.getByRole('textbox', { name: 'Name' })
const menu = (page: Page, name: string | RegExp) => page.getByRole('menuitem', { name })
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
const editor = (page: Page) => page.locator('.cm-content')

/** What the ZIP file on the disk holds now: the names, and the text of the files. */
async function held(file = path.join(work, 'pack.zip')) {
  const zip = await openZipBuffer(fs.readFileSync(file))
  const files: Record<string, string> = {}
  for (const entry of zip.entries) if (!entry.directory) files[entry.name] = (await zip.read(entry.name, 1 << 20)).toString('utf8')
  return { names: zip.entries.map((e) => e.name).sort(), files, zip }
}
const noTemporaries = () => expect(fs.readdirSync(work).filter((n) => n.endsWith('.fbtmp'))).toEqual([])

test('a text file in a ZIP is edited like any other: typing marks the tab, Ctrl+S writes the ZIP again with the rest as it was', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await item(page, 'in.txt').dblclick()
  await expect(editor(page)).toContainText('inside the zip')
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(', and more')
  await expect(tab(page, 'in.txt')).toContainText('Modified')
  expect((await held()).files['in.txt']).toBe('inside the zip')
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(async () => (await held()).files['in.txt']).toBe('inside the zip, and more')
  await expect(tab(page, 'in.txt')).not.toContainText('Modified')
  const { names, files } = await held()
  expect(names).toEqual(['docs/', 'docs/note.txt', 'docs/readme.md', 'in.txt', 'nested.zip'])
  expect(files['docs/readme.md']).toBe('# readme')
  noTemporaries()
  // A second save of the same entry, and of another entry of the same ZIP, are not conflicts.
  await page.keyboard.type('!')
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(async () => (await held()).files['in.txt']).toBe('inside the zip, and more!')
  await item(page, 'docs').click()
  await item(page, 'note.txt').dblclick()
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' to self')
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(async () => (await held()).files['docs/note.txt']).toBe('a note to self')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
})

test('a file in a ZIP in a ZIP is edited, and the ZIP file keeps its other entries', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await item(page, 'nested.zip').click()
  await item(page, 'deep.txt').dblclick()
  await expect(editor(page)).toContainText('deep in a ZIP in a ZIP')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' (edited)')
  await page.keyboard.press('ControlOrMeta+s')
  await expect
    .poll(async () => {
      const outer = await held()
      const inner = await openZipBuffer(await outer.zip.read('nested.zip', 1 << 20))
      return (await inner.read('deep.txt', 1000)).toString()
    })
    .toBe('deep in a ZIP in a ZIP (edited)')
  expect((await held()).files['in.txt']).toBe('inside the zip')
  noTemporaries()
})

test('a ZIP is changed from the tree: new file and folder, rename, move by dragging, and delete (for good: a ZIP has no trash)', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await expect(item(page, 'docs')).toBeVisible()
  // New file in the top of the ZIP, from the menu of the ZIP, and a new folder in a folder of it.
  await item(page, 'pack.zip').click({ button: 'right' })
  await menu(page, 'New File…').click()
  await field(page).fill('top.txt')
  await field(page).press('Enter')
  await expect(item(page, 'top.txt')).toBeVisible()
  await item(page, 'docs').click({ button: 'right' })
  await menu(page, 'New Folder…').click()
  await field(page).fill('sub')
  await field(page).press('Enter')
  await expect(item(page, 'sub')).toBeVisible()
  await expect.poll(async () => (await held()).names).toEqual(['docs/', 'docs/note.txt', 'docs/readme.md', 'docs/sub/', 'in.txt', 'nested.zip', 'top.txt'])
  // Rename with F2: the text of the entry goes with its new name.
  await item(page, 'in.txt').focus()
  await page.keyboard.press('F2')
  await field(page).fill('first.txt')
  await field(page).press('Enter')
  await expect(item(page, 'first.txt')).toBeVisible()
  await expect(item(page, 'in.txt')).toHaveCount(0)
  expect((await held()).files['first.txt']).toBe('inside the zip')
  // Drag onto a folder of the same ZIP.
  await item(page, 'first.txt').dragTo(item(page, 'sub'))
  await expect.poll(async () => (await held()).names).toContain('docs/sub/first.txt')
  expect((await held()).names).not.toContain('first.txt')
  // Delete: the question is the permanent one at once.
  await item(page, 'note.txt').focus()
  await page.keyboard.press('Delete')
  const ask = page.getByRole('alertdialog', { name: 'Delete permanently?' })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Delete Permanently' }).click()
  await expect.poll(async () => (await held()).names).not.toContain('docs/note.txt')
  expect((await held()).files['docs/readme.md']).toBe('# readme')
  noTemporaries()
})

test('the tab of a file in a ZIP follows its rename and closes when it is deleted', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await item(page, 'in.txt').dblclick()
  await expect(tab(page, 'in.txt')).toBeVisible()
  await item(page, 'in.txt').focus()
  await page.keyboard.press('F2')
  await field(page).fill('renamed.txt')
  await field(page).press('Enter')
  await expect(tab(page, 'renamed.txt')).toBeVisible()
  await expect(editor(page)).toContainText('inside the zip')
  await item(page, 'renamed.txt').focus()
  await page.keyboard.press('Delete')
  await page.getByRole('alertdialog', { name: 'Delete permanently?' }).getByRole('button', { name: 'Delete Permanently' }).click()
  await expect(tab(page, 'renamed.txt')).toHaveCount(0)
})

test('a ZIP opened as the root is changed too', async () => {
  const page = await launch(path.join(work, 'pack.zip'))
  await item(page, 'in.txt').dblclick()
  await expect(editor(page)).toContainText('inside the zip')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('!')
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(async () => (await held()).files['in.txt']).toBe('inside the zip!')
  await page.getByRole('button', { name: 'New Folder…' }).click()
  await field(page).fill('made')
  await field(page).press('Enter')
  await expect.poll(async () => (await held()).names).toContain('made/')
  noTemporaries()
})

test('nothing moves between the disk and a ZIP: the drop is refused, and both are as they were', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await expect(item(page, 'docs')).toBeVisible()
  await item(page, 'other.txt').dragTo(item(page, 'docs'))
  await expect(page.getByText(/Could not move other\.txt/)).toBeVisible()
  expect(fs.readFileSync(path.join(work, 'other.txt'), 'utf8')).toBe('on the disk')
  expect((await held()).names).toEqual(['docs/', 'docs/note.txt', 'docs/readme.md', 'in.txt', 'nested.zip'])
})

test('a file changed in the ZIP by someone else since it was opened: Save asks, and the answer is the user\'s', async () => {
  const page = await launch(work)
  await item(page, 'pack.zip').click()
  await item(page, 'in.txt').dblclick()
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' mine')
  fs.writeFileSync(path.join(work, 'pack.zip'), await zipBuffer([{ name: 'in.txt', data: 'written by someone else' }, { name: 'docs/' }, { name: 'docs/readme.md', data: '# readme' }, { name: 'docs/note.txt', data: 'a note' }]))
  await page.keyboard.press('ControlOrMeta+s')
  const ask = page.getByRole('alertdialog', { name: 'The file changed on disk' })
  await expect(ask).toBeVisible()
  expect((await held()).files['in.txt']).toBe('written by someone else')
  await ask.getByRole('button', { name: 'Overwrite' }).click()
  await expect.poll(async () => (await held()).files['in.txt']).toBe('inside the zip mine')
  expect((await held()).files['docs/readme.md']).toBe('# readme')
})

test('a ZIP that cannot be written back faithfully is shown, not edited, and says why', async () => {
  const bytes = await zipBuffer([{ name: 'ok.txt', data: 'readable text' }, { name: 'secret.txt', data: 'zzzz'.repeat(30) }])
  // The last entry of the directory is marked as encrypted (a bit of its flags).
  const central = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8)
  fs.writeFileSync(path.join(work, 'locked.zip'), bytes)
  const page = await launch(work)
  await item(page, 'locked.zip').click()
  await item(page, 'ok.txt').dblclick()
  await expect(page.getByText(/Shown, not edited: the ZIP it is in cannot be changed/)).toBeVisible()
  await expect(editor(page)).toContainText('readable text')
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false')
  await item(page, 'locked.zip').click({ button: 'right' })
  await menu(page, 'New File…').click()
  await field(page).fill('x.txt')
  await field(page).press('Enter')
  await expect(page.getByRole('alert')).toContainText('cannot be changed')
})
