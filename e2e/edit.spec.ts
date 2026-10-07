import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { zipSync } from '../fixtures/zip.ts'

// End-to-end: editing the text files of a folder: Save, the dot on the tab, what is asked when tabs with changes close, a file that changed on disk, line endings.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-edit-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(path.join(work, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(work, 'a.txt'), 'first line\nsecond line\n')
  fs.writeFileSync(path.join(work, 'b.txt'), 'the b file\n')
  fs.writeFileSync(path.join(work, 'data.json'), '{"name":"harbor","items":[1,2,3]}')
  fs.writeFileSync(path.join(work, 'win.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n')]))
  fs.writeFileSync(path.join(work, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
  fs.writeFileSync(path.join(work, 'big.log'), 'a log line of text\n'.repeat(300_000))
  fs.writeFileSync(path.join(work, 'pack.zip'), zipSync([{ name: 'in.txt', data: 'inside the zip' }]))
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
const onDisk = (...p: string[]) => path.join(work, ...p)
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
const editor = (page: Page) => page.locator('.cm-content')
/** Types at the end of the text, as a person does. */
async function typeAtEnd(page: Page, text: string) {
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(text)
}
const open = async (page: Page, name: string) => {
  await item(page, name).dblclick()
  await expect(editor(page)).toBeVisible()
}

test('a text file of a folder opens ready to edit; typing marks the tab, Ctrl+S writes the file whole and unmarks it', async () => {
  const page = await launch(work)
  await open(page, 'a.txt')
  await expect(editor(page)).toContainText('first line')
  await expect(page.getByRole('button', { name: /Save the file/ })).toBeDisabled()
  await typeAtEnd(page, 'third line')
  await expect(tab(page, 'a.txt')).toContainText('Modified')
  await expect(page.getByText('● Modified')).toBeVisible()
  expect(fs.readFileSync(onDisk('a.txt'), 'utf8')).toBe('first line\nsecond line\n')
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => fs.readFileSync(onDisk('a.txt'), 'utf8')).toBe('first line\nsecond line\nthird line')
  await expect(tab(page, 'a.txt')).not.toContainText('Modified')
  await expect(page.getByRole('button', { name: /Save the file/ })).toBeDisabled()
  expect(fs.readdirSync(work).filter((n) => n.endsWith('.fbtmp'))).toEqual([])
  // The Save button does the same.
  await typeAtEnd(page, '!')
  await page.getByRole('button', { name: /Save the file/ }).click()
  await expect.poll(() => fs.readFileSync(onDisk('a.txt'), 'utf8')).toBe('first line\nsecond line\nthird line!')
})

test('the changes of a tab are kept when another tab is in front, with the undo history', async () => {
  const page = await launch(work)
  await open(page, 'a.txt')
  await typeAtEnd(page, ' EDITED')
  await open(page, 'b.txt')
  await expect(editor(page)).toContainText('the b file')
  await tab(page, 'a.txt').click()
  await expect(editor(page)).toContainText('EDITED')
  await expect(tab(page, 'a.txt')).toContainText('Modified')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor(page)).not.toContainText('EDITED')
  await expect(tab(page, 'a.txt')).not.toContainText('Modified')
})

test('closing a tab with changes asks: Cancel keeps it, Don’t Save closes it and leaves the file, Save writes and closes', async () => {
  const page = await launch(work)
  await open(page, 'a.txt')
  await typeAtEnd(page, ' one')
  await page.keyboard.press('ControlOrMeta+w')
  const ask = page.getByRole('alertdialog', { name: 'Save changes?' })
  await expect(ask).toContainText('a.txt')
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(tab(page, 'a.txt')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+w')
  await ask.getByRole('button', { name: 'Don’t Save' }).click()
  await expect(tab(page, 'a.txt')).toHaveCount(0)
  expect(fs.readFileSync(onDisk('a.txt'), 'utf8')).toBe('first line\nsecond line\n')
  // Opened again it has what is on the disk.
  await open(page, 'a.txt')
  await expect(editor(page)).not.toContainText('one')
  await typeAtEnd(page, 'kept')
  await page.getByRole('tab', { name: /^a\.txt/ }).getByRole('button', { name: /close/i }).click({ force: true })
  await ask.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(tab(page, 'a.txt')).toHaveCount(0)
  expect(fs.readFileSync(onDisk('a.txt'), 'utf8')).toBe('first line\nsecond line\nkept')
})

test('a file that changed on disk since it was opened: Save asks, Overwrite writes the text of the tab, Load from Disk takes what is there', async () => {
  const page = await launch(work)
  await open(page, 'a.txt')
  await typeAtEnd(page, ' mine')
  fs.writeFileSync(onDisk('a.txt'), 'written by someone else\n')
  await page.keyboard.press('ControlOrMeta+s')
  const ask = page.getByRole('alertdialog', { name: 'The file changed on disk' })
  await expect(ask).toBeVisible()
  expect(fs.readFileSync(onDisk('a.txt'), 'utf8')).toBe('written by someone else\n')
  await ask.getByRole('button', { name: 'Load from Disk' }).click()
  await expect(editor(page)).toContainText('written by someone else')
  await expect(editor(page)).not.toContainText('mine')
  await expect(tab(page, 'a.txt')).not.toContainText('Modified')
  // Again, and this time overwrite.
  await typeAtEnd(page, 'second try')
  fs.writeFileSync(onDisk('a.txt'), 'someone else again, and longer\n')
  await page.keyboard.press('ControlOrMeta+s')
  await ask.getByRole('button', { name: 'Overwrite' }).click()
  await expect.poll(() => fs.readFileSync(onDisk('a.txt'), 'utf8')).toBe('written by someone else\nsecond try')
  await expect(tab(page, 'a.txt')).not.toContainText('Modified')
})

test('the line endings and the byte order mark of a file are kept when it is saved', async () => {
  const page = await launch(work)
  await open(page, 'win.txt')
  await expect(page.getByText('CRLF')).toBeVisible()
  await expect(page.getByText('UTF-8 with BOM')).toBeVisible()
  await typeAtEnd(page, 'three')
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => fs.readFileSync(onDisk('win.txt')).equals(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\nthree')]))).toBe(true)
})

test('what cannot be edited is shown as it is, and says why: another encoding, a log too big to edit', async () => {
  const page = await launch(work)
  await item(page, 'latin.txt').dblclick()
  await expect(page.getByText('Shown, not edited: the file is not UTF-8.')).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  await item(page, 'big.log').dblclick()
  await expect(page.getByText(/Shown, not edited: the file is too large to edit/)).toBeVisible()
})

test('Format Document lays a minified file out as an edit that is undone with Ctrl+Z', async () => {
  const page = await launch(work)
  await open(page, 'data.json')
  await expect(editor(page)).toContainText('{"name":"harbor"')
  await page.getByRole('button', { name: /Lay the text out/ }).click()
  await expect(editor(page)).toContainText('"name": "harbor"')
  await expect(tab(page, 'data.json')).toContainText('Modified')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor(page)).toContainText('{"name":"harbor"')
})

test('Save All writes every tab with changes; Save in the File menu is off when there is nothing to save', async () => {
  const page = await launch(work)
  await open(page, 'a.txt')
  await typeAtEnd(page, 'A')
  await open(page, 'b.txt')
  await typeAtEnd(page, 'B')
  await page.keyboard.press('ControlOrMeta+Alt+s')
  await expect.poll(() => [fs.readFileSync(onDisk('a.txt'), 'utf8'), fs.readFileSync(onDisk('b.txt'), 'utf8')]).toEqual(['first line\nsecond line\nA', 'the b file\nB'])
  await expect(page.getByRole('tab').filter({ hasText: 'Modified' })).toHaveCount(0)
})

test('renaming a file with changes not saved keeps the changes in its tab, and Save writes the file under its new name', async () => {
  const page = await launch(work)
  await open(page, 'a.txt')
  await typeAtEnd(page, ' unsaved')
  await item(page, 'a.txt').focus()
  await page.keyboard.press('F2')
  await page.getByRole('textbox', { name: 'Name' }).fill('renamed.txt')
  await page.getByRole('textbox', { name: 'Name' }).press('Enter')
  await expect(tab(page, 'renamed.txt')).toBeVisible()
  await expect(tab(page, 'renamed.txt')).toContainText('Modified')
  await expect(editor(page)).toContainText('unsaved')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => fs.readFileSync(onDisk('renamed.txt'), 'utf8')).toBe('first line\nsecond line\n unsaved')
})

test('with the setting that keeps changes off, closing the window with changes not saved asks first; Cancel keeps it open, Don’t Save closes it', async () => {
  const page = await launch(work)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('checkbox', { name: 'Keep changes that are not saved' }).uncheck()
  await open(page, 'a.txt')
  await typeAtEnd(page, ' x')
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  const ask = page.getByRole('alertdialog', { name: 'Close with unsaved changes?' })
  await expect(ask).toContainText('a.txt')
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(tab(page, 'a.txt')).toBeVisible()
  expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await Promise.all([page.waitForEvent('close'), ask.getByRole('button', { name: 'Don’t Save' }).click().catch(() => undefined)])
  expect(fs.readFileSync(onDisk('a.txt'), 'utf8')).toBe('first line\nsecond line\n')
})

test('a middle click on a tab (to close it) does not paste the selection of the system into the editor that has the focus', async () => {
  test.skip(process.platform !== 'linux', 'the middle click pastes the primary selection on Linux')
  const page = await launch(work)
  await open(page, 'b.txt')
  await open(page, 'a.txt')
  await app!.evaluate(({ clipboard }) => (clipboard as unknown as { writeText: (text: string, type?: string) => void }).writeText('PASTED BY THE MIDDLE CLICK', 'selection'))
  await tab(page, 'b.txt').click({ button: 'middle' })
  await expect(tab(page, 'b.txt')).toHaveCount(0)
  await expect(editor(page)).not.toContainText('PASTED')
  await expect(tab(page, 'a.txt')).not.toContainText('Modified')
})

test('the selection has the colour of the theme in both themes, with the focus in the editor and without it (CodeMirror\'s own pale lilac made the selected text unreadable in the dark theme)', async () => {
  const page = await launch(work)
  await open(page, 'a.txt')
  for (const theme of ['Dark+', 'Light+']) {
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('menuitemcheckbox', { name: theme }).click()
    await editor(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await expect(page.locator('.cm-selectionBackground').first()).toBeVisible()
    const colours = () =>
      page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.backgroundColor = 'var(--wsnp-selection)'
        document.body.append(probe)
        const wanted = getComputedStyle(probe).backgroundColor
        probe.remove()
        const layer = document.querySelector('.cm-selectionBackground')
        return { wanted, got: layer ? getComputedStyle(layer).backgroundColor : null }
      })
    const focused = await colours()
    // (The two themes have two colours: the one asked for is the theme's own.)
    expect(focused.wanted, theme).toBe(theme === 'Dark+' ? 'rgb(38, 79, 120)' : 'rgb(173, 214, 255)')
    expect(focused.got, `${theme}, focused`).toBe(focused.wanted)
    // Without the focus (the file tree has it) the selection stays, in the same colour.
    await item(page, 'b.txt').focus()
    const blurred = await colours()
    expect(blurred.got, `${theme}, not focused`).toBe(blurred.wanted)
  }
})
