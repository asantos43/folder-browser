import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: editing the bytes of a file in the hexadecimal view: digits, text, insert, delete, undo, Save, a file that changed on disk, and the draft kept for the next start.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined
const profile = () => path.join(dir, 'profile')
const draftFiles = () => (fs.existsSync(path.join(profile(), 'drafts')) ? fs.readdirSync(path.join(profile(), 'drafts')).filter((n) => n.endsWith('.json')) : [])

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-hexedit-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'prog.bin'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02, 0x03, 0x41, 0x42, 0x43, 0x44]))
  fs.chmodSync(path.join(work, 'prog.bin'), 0o755)
  fs.writeFileSync(path.join(work, 'notes.txt'), 'plain text\n')
})
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {})
  // (In a whole run of the suite the application sometimes did not quit after its windows were destroyed, and the test waited two minutes for it: after fifteen seconds it is ended.)
  const child = app?.process()
  await Promise.race([app?.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 15_000))])
  if (child && child.exitCode === null) child.kill('SIGKILL')
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...args: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile()}`, ...noSandbox, ...args], env: { ...process.env, XDG_DATA_HOME: path.join(dir, 'data') } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
const item = (page: Page, name: string) => page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name, exact: true })
const grid = (page: Page, name: string) => page.getByRole('grid', { name: `Hexadecimal view of ${name}` })
const bytesOnDisk = (name: string) => [...fs.readFileSync(path.join(work, name))]
const size = (page: Page, n: number) => page.getByRole('toolbar').getByText(`${n} B`, { exact: true })
const cell = (page: Page, n: number) => grid(page, 'prog.bin').getByRole('gridcell').nth(n)
async function openBytes(page: Page) {
  await item(page, 'prog.bin').dblclick()
  await expect(grid(page, 'prog.bin')).toBeVisible()
  await page.getByRole('button', { name: /^Edit the bytes/ }).click()
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })

test('typing hex digits overwrites bytes (two digits to a byte), the bytes changed are marked, the tab has the dot, and Ctrl+S writes the file keeping its permissions', async () => {
  const page = await launch(work)
  await openBytes(page)
  await cell(page, 4).click()
  await page.keyboard.type('aabb')
  await expect(cell(page, 4)).toHaveText('aa')
  await expect(cell(page, 5)).toHaveText('bb')
  await expect(cell(page, 4)).toHaveClass(/font-bold/)
  await expect(cell(page, 0)).not.toHaveClass(/font-bold/)
  await expect(page.getByText('● Modified')).toBeVisible()
  await expect(tab(page, 'prog.bin')).toContainText('Modified')
  expect(bytesOnDisk('prog.bin').slice(4, 6)).toEqual([0, 1])
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => bytesOnDisk('prog.bin')).toEqual([0x7f, 0x45, 0x4c, 0x46, 0xaa, 0xbb, 0x02, 0x03, 0x41, 0x42, 0x43, 0x44])
  expect(fs.statSync(path.join(work, 'prog.bin')).mode & 0o777).toBe(0o755)
  await expect(tab(page, 'prog.bin')).not.toContainText('Modified')
  expect(fs.readdirSync(work).filter((n) => n.endsWith('.fbtmp'))).toEqual([])
})

test('the text column writes characters, Insert makes the file longer, Delete and Backspace make it shorter, and Ctrl+Z takes it all back', async () => {
  const page = await launch(work)
  await openBytes(page)
  // The text column: the byte 0x41 is "A" at offset 8.
  await grid(page, 'prog.bin').getByRole('row').first().locator(':scope > span.flex').nth(1).locator('span').nth(8).click()
  await page.keyboard.type('Z')
  await expect(cell(page, 8)).toHaveText('5a')
  await cell(page, 0).click()
  await page.keyboard.press('Insert')
  await expect(page.getByText('INS')).toBeVisible()
  await page.keyboard.type('00')
  await expect(size(page, 13)).toBeVisible()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Delete')
  await expect(size(page, 11)).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(size(page, 13)).toBeVisible()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+z')
  await expect(size(page, 12)).toBeVisible()
  await expect(tab(page, 'prog.bin')).not.toContainText('Modified')
  expect(bytesOnDisk('prog.bin')[8]).toBe(0x41)
})

test('bytes can be added after the last one', async () => {
  const page = await launch(work)
  await openBytes(page)
  await cell(page, 11).click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('ee')
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => bytesOnDisk('prog.bin').length).toBe(13)
  expect(bytesOnDisk('prog.bin').at(-1)).toBe(0xee)
})

test('a file that changed on disk since it was opened: Save asks, and Load from Disk brings what is there', async () => {
  const page = await launch(work)
  await openBytes(page)
  await cell(page, 0).click()
  await page.keyboard.type('00')
  fs.writeFileSync(path.join(work, 'prog.bin'), Buffer.from([9, 9, 9]))
  await page.keyboard.press('ControlOrMeta+s')
  const ask = page.getByRole('alertdialog', { name: 'The file changed on disk' })
  await expect(ask).toBeVisible()
  expect(bytesOnDisk('prog.bin')).toEqual([9, 9, 9])
  await ask.getByRole('button', { name: 'Load from Disk' }).click()
  await expect(size(page, 3)).toBeVisible()
  await expect(tab(page, 'prog.bin')).not.toContainText('Modified')
})

test('the changes of the bytes are kept for the next start when the application closes, and come back marked', async () => {
  const page = await launch(work)
  await openBytes(page)
  await cell(page, 2).click()
  await page.keyboard.type('99')
  await expect.poll(draftFiles).toHaveLength(1)
  await Promise.all([page.waitForEvent('close'), app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())])
  await app!.close().catch(() => {})
  app = undefined
  expect(bytesOnDisk('prog.bin')[2]).toBe(0x4c)
  const again = await launch()
  await expect(grid(again, 'prog.bin')).toBeVisible()
  await expect(tab(again, 'prog.bin')).toContainText('Modified')
  await expect(cell(again, 2)).toHaveText('99')
  await expect(cell(again, 2)).toHaveClass(/font-bold/)
  await expect(again.getByText('Changes of prog.bin that were not saved were restored.')).toBeVisible()
  await again.locator('[role=grid]').focus()
  await again.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => bytesOnDisk('prog.bin')[2]).toBe(0x99)
  await expect.poll(draftFiles).toHaveLength(0)
})

test('a text file in the hexadecimal view is edited as bytes too, and its text tab is a separate buffer', async () => {
  const page = await launch(work)
  await item(page, 'notes.txt').dblclick()
  await expect(page.locator('.cm-content')).toContainText('plain text')
  await page.getByRole('toolbar').getByRole('button', { name: 'View as hex' }).click()
  await expect(grid(page, 'notes.txt')).toBeVisible()
  await page.getByRole('button', { name: /^Edit the bytes/ }).click()
  await grid(page, 'notes.txt').getByRole('gridcell').nth(0).click()
  await page.keyboard.type('50')
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => fs.readFileSync(path.join(work, 'notes.txt'), 'utf8')).toBe('Plain text\n')
})
