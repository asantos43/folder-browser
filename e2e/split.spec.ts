import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: two editor groups (Split Right, dragging a tab or a file of the tree to the editor), and the question asked when a text is dropped on another one.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-split-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work)
  fs.writeFileSync(path.join(work, 'a.txt'), 'alpha one\nsecond\nthird\n')
  fs.writeFileSync(path.join(work, 'b.txt'), 'bravo two\nsecond\n3rd\n')
  fs.writeFileSync(path.join(work, 'c.txt'), 'charlie three\n')
  fs.writeFileSync(path.join(work, 'pic.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
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
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
const group = (page: Page, n: 0 | 1) => page.locator(`main[data-group="${n}"]`)
const dialog = (page: Page) => page.getByRole('alertdialog', { name: 'Open the two files' })

async function openKept(page: Page, ...names: string[]) {
  for (const name of names) await item(page, name).dblclick()
}

test('Split Right in the menu of a tab makes a second group on the right with that tab, and the last tab of the group closing ends it', async () => {
  const page = await launch(work)
  await openKept(page, 'a.txt', 'b.txt')
  await expect(group(page, 1)).toHaveCount(0)
  await tab(page, 'b.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Split Right' }).click()
  await expect(group(page, 0).getByRole('tab')).toHaveCount(1)
  await expect(group(page, 1).getByRole('tab')).toHaveCount(1)
  await expect(group(page, 0).locator('.cm-content')).toContainText('alpha one')
  await expect(group(page, 1).locator('.cm-content')).toContainText('bravo two')
  // Typing goes to the group that has the focus, and a click in the other takes it.
  await group(page, 1).locator('.cm-content').click()
  await page.keyboard.type('QQ')
  await expect(group(page, 1).locator('.cm-content')).toContainText('QQ')
  await expect(group(page, 0).locator('.cm-content')).not.toContainText('QQ')
  await expect(tab(page, 'b.txt')).toHaveAttribute('aria-selected', 'true')
  // Closing the only tab of the right group ends it (the question about the change is answered with Don't Save).
  await group(page, 1).getByRole('tab').getByRole('button').click()
  await page.getByRole('alertdialog').getByRole('button', { name: /Don.t Save/ }).click()
  await expect(group(page, 1)).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('.cm-content')).toContainText('alpha one')
})

test('dragging a tab onto the middle of another asks; Open Side by Side puts the first on the left and the second on the right', async () => {
  const page = await launch(work)
  await openKept(page, 'a.txt', 'b.txt')
  await tab(page, 'a.txt').dragTo(tab(page, 'b.txt'))
  await expect(dialog(page)).toContainText('a.txt and b.txt')
  await dialog(page).getByRole('button', { name: 'Open Side by Side' }).click()
  await expect(group(page, 0).locator('.cm-content')).toContainText('alpha one')
  await expect(group(page, 1).locator('.cm-content')).toContainText('bravo two')
  await expect(group(page, 0).getByRole('tab')).toHaveCount(1)
  await expect(group(page, 1).getByRole('tab')).toHaveCount(1)
})

test('the same drop can ask for the diff instead, and Cancel leaves everything as it was', async () => {
  const page = await launch(work)
  await openKept(page, 'a.txt', 'b.txt')
  await tab(page, 'a.txt').dragTo(tab(page, 'b.txt'))
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(group(page, 1)).toHaveCount(0)
  await tab(page, 'a.txt').dragTo(tab(page, 'b.txt'))
  await dialog(page).getByRole('button', { name: 'Compare (Diff)' }).click()
  await expect(tab(page, 'a.txt ↔ b.txt')).toBeVisible()
  await expect(page.getByRole('group', { name: /^Comparison of / })).toBeVisible()
  await expect(page.getByText('2 changes')).toBeVisible()
})

test('dragging a text file of the tree onto another asks the same, and nothing is moved', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dragTo(item(page, 'b.txt'))
  await expect(dialog(page)).toContainText('a.txt and b.txt')
  await dialog(page).getByRole('button', { name: 'Compare (Diff)' }).click()
  await expect(tab(page, 'a.txt ↔ b.txt')).toBeVisible()
  expect(fs.existsSync(path.join(work, 'a.txt'))).toBe(true)
  expect(fs.existsSync(path.join(work, 'b.txt'))).toBe(true)
  await item(page, 'c.txt').dragTo(item(page, 'a.txt'))
  await dialog(page).getByRole('button', { name: 'Open Side by Side' }).click()
  await expect(group(page, 0).locator('.cm-content')).toContainText('charlie three')
  await expect(group(page, 1).locator('.cm-content')).toContainText('alpha one')
})

test('dragging a file of the tree to the right half of the editor opens it in a second group, and to the left half in the first', async () => {
  const page = await launch(work)
  await openKept(page, 'a.txt')
  const editor = page.locator('main[data-group="0"]')
  const box = (await editor.boundingBox())!
  await item(page, 'b.txt').dragTo(editor, { targetPosition: { x: box.width * 0.8, y: box.height * 0.6 } })
  await expect(group(page, 1).locator('.cm-content')).toContainText('bravo two')
  await expect(group(page, 0).locator('.cm-content')).toContainText('alpha one')
  // With two groups the whole group the pointer is over takes it.
  const left = (await group(page, 0).boundingBox())!
  await item(page, 'c.txt').dragTo(group(page, 0), { targetPosition: { x: left.width * 0.8, y: left.height * 0.6 } })
  await expect(group(page, 0).getByRole('tab')).toHaveCount(2)
  await expect(group(page, 1).getByRole('tab')).toHaveCount(1)
  await expect(group(page, 0).locator('.cm-content')).toContainText('charlie three')
})

test('dragging a tab to the editor moves it to the group there, and a picture is dragged too (only texts are asked about)', async () => {
  const page = await launch(work)
  await openKept(page, 'a.txt', 'pic.png')
  const editor = group(page, 0)
  const box = (await editor.boundingBox())!
  await tab(page, 'pic.png').dragTo(editor, { targetPosition: { x: box.width * 0.8, y: box.height * 0.6 } })
  await expect(group(page, 1).getByRole('tab')).toHaveCount(1)
  await expect(group(page, 0).locator('.cm-content')).toContainText('alpha one')
  // On the middle of a text tab a picture only moves.
  await tab(page, 'pic.png').dragTo(tab(page, 'a.txt'))
  await expect(dialog(page)).toHaveCount(0)
  await expect(group(page, 1)).toHaveCount(0)
})

test('Find searches the group that has the focus', async () => {
  const page = await launch(work)
  await openKept(page, 'a.txt', 'b.txt')
  await tab(page, 'b.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Split Right' }).click()
  await group(page, 1).locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByRole('textbox', { name: /Find/ }).fill('bravo')
  await expect(page.getByText(/1 of 1|1\/1/)).toBeVisible()
  await page.keyboard.press('Escape')
  await group(page, 0).locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByRole('textbox', { name: /Find/ }).fill('bravo')
  await expect(page.getByText(/No results|0 of 0|0\/0/)).toBeVisible()
})
