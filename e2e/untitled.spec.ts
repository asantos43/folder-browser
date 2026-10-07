import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: a new text file that exists only in the window (Ctrl+N): text pasted in it, compared with a file, put beside one, and asked about when it closes.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-untitled-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\ntwo\nthree\n')
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
const tab = (page: Page, name: RegExp | string) => page.getByRole('tab', { name })
const editorText = (page: Page) => page.locator('.cm-content')

test('Ctrl+N opens Untitled-1 (also from File ▸ New Text File), empty; a text pasted in it is only in the window, and the tab says it has changes', async () => {
  const page = await launch(work)
  await page.keyboard.press('Control+n')
  await expect(tab(page, /^Untitled-1/)).toHaveAttribute('aria-selected', 'true')
  await expect(editorText(page)).toHaveText('')
  // A text copied elsewhere is pasted with the keys.
  await page.evaluate(() => (window as unknown as { fb: { copyText(t: string): Promise<void> } }).fb.copyText('pasted\nfrom elsewhere'))
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+v')
  await expect(editorText(page)).toContainText('from elsewhere')
  await expect(page.getByText('● Modified')).toBeVisible()
  await expect(page.getByText('2 lines')).toBeVisible()
  // Another new text is numbered on (this one from the File menu, where the shortcut is written).
  if (process.platform !== 'darwin') {
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click()
    await expect(page.getByRole('menuitem', { name: /New Text File/ })).toContainText('Ctrl+N')
    await page.getByRole('menuitem', { name: /New Text File/ }).click()
  } else await page.keyboard.press('Meta+n')
  await expect(tab(page, /^Untitled-2/)).toHaveAttribute('aria-selected', 'true')
  // Back to the first one: its text is kept.
  await tab(page, /^Untitled-1/).click()
  await expect(editorText(page)).toContainText('pasted')
  // Nothing was written to the folder.
  expect(fs.readdirSync(work)).toEqual(['a.txt'])
})

test('a new text is compared with a file from the menu of its tab (Select for Compare, then Compare with Selected on the file), and the other way round', async () => {
  const page = await launch(work)
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await page.keyboard.type('one\n2\nthree')
  await tab(page, /^Untitled-1/).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Select for Compare' }).click()
  await page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name: 'a.txt', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compare with Selected' }).click()
  const diff = page.getByRole('group', { name: /^Comparison of / })
  await expect(diff).toBeVisible()
  await expect(tab(page, /Untitled-1 ↔ a\.txt/)).toBeVisible()
  await expect(diff.locator('.cm-merge-a')).toContainText('2')
  await expect(diff.locator('.cm-merge-b')).toContainText('two')
  // The other way round: a file chosen in the tree, compared from the new text's tab.
  await page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name: 'a.txt', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Select for Compare' }).click()
  await tab(page, /^Untitled-1(?! ↔)/).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compare with Selected' }).click()
  await expect(tab(page, /a\.txt ↔ Untitled-1/)).toBeVisible()
  // Closing the new text closes the comparisons that have it: its text is gone.
  await tab(page, /^Untitled-1(?! ↔)/).click()
  await page.keyboard.press('Control+w')
  await page.getByRole('alertdialog', { name: 'Save changes?' }).getByRole('button', { name: 'Don’t Save' }).click()
  await expect(tab(page, /Untitled-1/)).toHaveCount(0)
})

test('a new text goes beside a file (Split Right), and closing one that has text asks first', async () => {
  const page = await launch(work)
  await page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name: 'a.txt', exact: true }).dblclick()
  await expect(tab(page, /^a\.txt/)).toBeVisible()
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await page.keyboard.type('mine')
  await tab(page, /^Untitled-1/).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Split Right' }).click()
  await expect(page.getByRole('tablist', { name: 'Open editors' })).toHaveCount(2)
  await expect(page.locator('.cm-content').filter({ hasText: 'mine' })).toBeVisible()
  await expect(page.locator('.cm-content').filter({ hasText: 'one' })).toBeVisible()
  // Closing it asks, and Cancel keeps it.
  await tab(page, /^Untitled-1/).click()
  await page.keyboard.press('Control+w')
  const ask = page.getByRole('alertdialog', { name: 'Save changes?' })
  await expect(ask).toContainText('“Untitled-1”')
  await page.keyboard.press('Escape')
  await expect(tab(page, /^Untitled-1/)).toBeVisible()
  // An empty one closes without asking.
  await page.keyboard.press('Control+n')
  await expect(tab(page, /^Untitled-2/)).toBeVisible()
  await page.keyboard.press('Control+w')
  await expect(tab(page, /^Untitled-2/)).toHaveCount(0)
  await expect(ask).toHaveCount(0)
})

const draftFiles = () => {
  const folder = path.join(dir, 'profile', 'drafts')
  return fs.existsSync(folder) ? fs.readdirSync(folder).filter((n) => n.endsWith('.json')).length : 0
}
const dialog = (page: Page) => page.getByRole('alertdialog')
const group = (page: Page, n: 0 | 1) => page.getByRole('tablist', { name: 'Open editors' }).nth(n)

test('a new text dragged onto the middle of a text tab asks what to do with the two: side by side, or the diff', async () => {
  const page = await launch(work)
  await page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name: 'a.txt', exact: true }).dblclick()
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await page.keyboard.type('one\n2\nthree')
  await tab(page, /^Untitled-1/).dragTo(tab(page, /^a\.txt/))
  await expect(dialog(page)).toContainText('Untitled-1 and a.txt')
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('tablist', { name: 'Open editors' })).toHaveCount(1)
  // Side by side: the first on the left, the second on the right.
  await tab(page, /^Untitled-1/).dragTo(tab(page, /^a\.txt/))
  await dialog(page).getByRole('button', { name: 'Open Side by Side' }).click()
  await expect(page.getByRole('tablist', { name: 'Open editors' })).toHaveCount(2)
  await expect(group(page, 0).getByRole('tab', { name: /^Untitled-1/ })).toBeVisible()
  await expect(group(page, 1).getByRole('tab', { name: /^a\.txt/ })).toBeVisible()
  // The diff, dragging the other way round (the file onto the new text).
  await tab(page, /^a\.txt/).dragTo(tab(page, /^Untitled-1/))
  await dialog(page).getByRole('button', { name: 'Compare (Diff)' }).click()
  await expect(tab(page, /a\.txt ↔ Untitled-1/)).toBeVisible()
  await expect(page.getByRole('group', { name: /^Comparison of / }).locator('.cm-merge-b')).toContainText('2')
})

test('a file of the tree dropped on the tab of a new text asks the same', async () => {
  const page = await launch(work)
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await page.keyboard.type('mine')
  await page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name: 'a.txt', exact: true }).dragTo(tab(page, /^Untitled-1/))
  await expect(dialog(page)).toContainText('a.txt and Untitled-1')
  await dialog(page).getByRole('button', { name: 'Compare (Diff)' }).click()
  await expect(tab(page, /a\.txt ↔ Untitled-1/)).toBeVisible()
})

test('a new text with text is kept for the next start: it comes back with its number and text, and an empty one does not', async () => {
  const page = await launch(work)
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await page.keyboard.type('kept between starts')
  await page.keyboard.press('Control+n')
  await expect(tab(page, /^Untitled-2/)).toBeVisible()
  await expect.poll(() => draftFiles()).toBe(1)
  // The window closes without asking, as it does for a file.
  await Promise.all([page.waitForEvent('close'), app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())])
  await app!.close().catch(() => {})
  app = undefined
  expect(fs.readdirSync(work)).toEqual(['a.txt'])

  const again = await launch()
  await expect(tab(again, /^Untitled-1/)).toBeVisible()
  await expect(tab(again, /^Untitled-2/)).toHaveCount(0)
  await expect(tab(again, /^Untitled-1/)).toContainText('Modified')
  await expect(again.locator('.cm-content')).toContainText('kept between starts')
  // Emptied, it has no draft any more.
  await again.locator('.cm-content').click()
  await again.keyboard.press('Control+a')
  await again.keyboard.press('Delete')
  await expect.poll(() => draftFiles()).toBe(0)
})
