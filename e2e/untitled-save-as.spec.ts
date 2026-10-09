import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: a new text (Ctrl+N) that is saved becomes the file (issue #70): its name, its language from the extension, one tab with the tree, Ctrl+S writes the file, no old draft comes back.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-untitled-save-as-'))
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
/** The save dialog is answered by the main process: it chooses `to` (null: the user cancels) and counts how many times it was asked. */
async function answerSave(to: string | null) {
  await app!.evaluate(({ dialog }, target) => {
    const g = globalThis as unknown as { __saveAsked: number }
    g.__saveAsked = 0
    dialog.showSaveDialog = (async () => {
      g.__saveAsked++
      return target ? { canceled: false, filePath: target } : { canceled: true, filePath: undefined }
    }) as unknown as typeof dialog.showSaveDialog
  }, to)
}
const asked = () => app!.evaluate(() => (globalThis as unknown as { __saveAsked: number }).__saveAsked)
const status = (page: Page) => page.locator('footer button[title="Select Language Mode"]')
const tab = (page: Page, name: RegExp | string) => page.getByRole('tab', { name })
const tree = (page: Page) => page.getByRole('tree', { name: 'Files and folders' })
const openFolders = (page: Page) => page.getByRole('listbox', { name: 'Open Folders' }).getByRole('option')
const draftFolder = () => path.join(dir, 'profile', 'drafts')
const draftTexts = () => (fs.existsSync(draftFolder()) ? fs.readdirSync(draftFolder()).filter((n) => n.endsWith('.json')).map((n) => fs.readFileSync(path.join(draftFolder(), n), 'utf8')) : [])

/** A new text with this text pasted in it, and saved to `to`. */
async function newTextSavedAs(page: Page, text: string, to: string): Promise<void> {
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await page.evaluate((t) => (window as unknown as { fb: { copyText(t: string): Promise<void> } }).fb.copyText(t), text)
  await page.keyboard.press('Control+v')
  await answerSave(to)
  await page.keyboard.press('Control+s')
}

const HTML = '<!doctype html>\n<html>\n<head><title>Hi</title></head>\n<body><p>Hello, world</p></body>\n</html>\n'
const JSON_TEXT = '{"name": "folder-browser", "list": [1, 2, 3], "nested": {"a": true}}\n'
const MARKDOWN = '# Title\n\nSome *words* and a [link](https://example.org).\n\n- one\n- two\n'
const PLAIN = 'just a few words\nin two lines\n'

test('saving a new text as page.html: the tab is page.html (HTML), the tree opens the same tab, and the next Ctrl+S writes the file with no dialog', async () => {
  const page = await launch(work)
  const file = path.join(work, 'page.html')
  await newTextSavedAs(page, HTML, file)
  await expect(tab(page, /^page\.html/)).toHaveAttribute('aria-selected', 'true')
  await expect(tab(page, /^Untitled-1/)).toHaveCount(0)
  expect(fs.readFileSync(file, 'utf8')).toBe(HTML)
  // The name with its extension decides the language: no "(detected)".
  await expect(status(page)).toHaveText('HTML')
  await expect(page.getByText('● Modified')).toHaveCount(0)
  expect(await asked()).toBe(1)

  // The same file from the tree is the same tab.
  await page.getByRole('button', { name: 'Refresh' }).click()
  await tree(page).getByRole('treeitem', { name: 'page.html', exact: true }).dblclick()
  await expect(tab(page, /^page\.html/)).toHaveCount(1)
  await expect(tab(page, /^page\.html/)).toHaveAttribute('aria-selected', 'true')

  // The next Ctrl+S saves the file: no dialog, and the disk changes.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('<!-- more -->')
  await page.keyboard.press('Control+s')
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('<!-- more -->')
  expect(await asked()).toBe(1)
  await expect(page.getByText('● Modified')).toHaveCount(0)
})

test('the language follows the extension (.json, .md); a name with no extension keeps the detected language and the tab is still the file', async () => {
  const page = await launch(work)
  await newTextSavedAs(page, JSON_TEXT, path.join(work, 'data.json'))
  await expect(tab(page, /^data\.json/)).toHaveAttribute('aria-selected', 'true')
  await expect(status(page)).toHaveText('JSON')

  await newTextSavedAs(page, MARKDOWN, path.join(work, 'notes.md'))
  await expect(tab(page, /^notes\.md/)).toHaveAttribute('aria-selected', 'true')
  await expect(status(page)).toHaveText('Markdown')

  // No extension: the HTML that was detected stays HTML, and the tab is the file.
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await page.evaluate((t) => (window as unknown as { fb: { copyText(t: string): Promise<void> } }).fb.copyText(t), HTML)
  await page.keyboard.press('Control+v')
  await expect(status(page)).toHaveText('HTML (detected)')
  const bare = path.join(work, 'page')
  await answerSave(bare)
  await page.keyboard.press('Control+s')
  await expect(tab(page, /^page(?!\.)/)).toHaveAttribute('aria-selected', 'true')
  await expect(status(page)).toContainText('HTML')
  expect(fs.readFileSync(bare, 'utf8')).toBe(HTML)
})

test('cancelling the dialog changes nothing: the tab is still Untitled-1, with its changes, and nothing is written', async () => {
  const page = await launch(work)
  await page.keyboard.press('Control+n')
  await page.locator('.cm-content').click()
  await page.evaluate((t) => (window as unknown as { fb: { copyText(t: string): Promise<void> } }).fb.copyText(t), PLAIN)
  await page.keyboard.press('Control+v')
  await answerSave(null)
  await page.keyboard.press('Control+s')
  await expect.poll(() => asked()).toBe(1)
  await expect(tab(page, /^Untitled-1/)).toHaveAttribute('aria-selected', 'true')
  await expect(tab(page, /^Untitled-1/)).toContainText('Modified')
  await expect(page.locator('.cm-content')).toContainText('in two lines')
  expect(fs.readdirSync(work)).toEqual(['a.txt'])
})

test('saved outside the open folders: its folder is opened as a root and the tab is the file', async () => {
  const page = await launch(work)
  const elsewhere = path.join(dir, 'elsewhere')
  fs.mkdirSync(elsewhere)
  await expect(openFolders(page)).toHaveText(['work'])
  await newTextSavedAs(page, PLAIN, path.join(elsewhere, 'saved.txt'))
  await expect(openFolders(page)).toHaveText(['work', 'elsewhere'])
  await expect(tab(page, /^saved\.txt/)).toHaveAttribute('aria-selected', 'true')
  await expect(tab(page, /^Untitled-1/)).toHaveCount(0)
  expect(fs.readFileSync(path.join(elsewhere, 'saved.txt'), 'utf8')).toBe(PLAIN)
  await expect(page.getByText('● Modified')).toHaveCount(0)
})

test('after a restart nothing of the old draft comes back: the saved file opens, the text typed after the save does not reappear as a new text', async () => {
  const page = await launch(work)
  const file = path.join(work, 'kept.txt')
  await newTextSavedAs(page, PLAIN, file)
  await expect(tab(page, /^kept\.txt/)).toHaveAttribute('aria-selected', 'true')
  // The draft of the new text is let go at once.
  await expect.poll(() => draftTexts().some((t) => t.includes('in two lines'))).toBe(false)
  // Text typed after the save is a change of the file (a draft of the file), never of a new text.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('after the save')
  await Promise.all([page.waitForEvent('close'), app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())])
  await app!.close().catch(() => {})
  app = undefined

  const again = await launch(work)
  await expect(tab(again, /^Untitled/)).toHaveCount(0)
  await expect(again.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name: 'kept.txt', exact: true })).toBeVisible()
  // The file is on the disk as it was saved.
  expect(fs.readFileSync(file, 'utf8')).toBe(PLAIN)
  await again.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name: 'kept.txt', exact: true }).dblclick()
  await expect(tab(again, /^kept\.txt/)).toBeVisible()
  await expect(again.locator('.cm-content')).toContainText('in two lines')
})
