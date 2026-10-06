import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { zipSync } from '../fixtures/zip.ts'

// End-to-end: a program, a library or any file of bytes opens in the hexadecimal view; a document can be shown that way too; a big file is read a window at a time.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

/** A 64-bit ELF shared object's header, then bytes that run from 0 to 255 over and over. */
const elfFile = (length: number): Buffer => {
  const bytes = Buffer.alloc(length)
  for (let i = 0; i < length; i++) bytes[i] = i & 255
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0)
  bytes[16] = 3
  bytes[17] = 0
  bytes[18] = 62
  bytes[19] = 0
  return bytes
}

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-hex-'))
  work = path.join(dir, 'bin')
  fs.mkdirSync(work)
  fs.writeFileSync(path.join(work, 'libdemo.so'), elfFile(4096))
  fs.writeFileSync(path.join(work, 'blob.xyz'), Buffer.from([1, 2, 0, 3, 4, 0xff]))
  fs.writeFileSync(path.join(work, 'report.pages'), zipSync([{ name: '[Content_Types].xml', data: '<x/>' }]))
  // Text, but too large to open in a tab: it is not shown, and can be seen as bytes.
  fs.writeFileSync(path.join(work, 'huge.txt'), 'line of a text\n'.repeat(450_000))
  fs.writeFileSync(path.join(work, 'notes.txt'), 'text stays text')
  // Over what is read whole into the interface (16 MiB): read by windows.
  fs.writeFileSync(path.join(work, 'big.iso'), elfFile(17 * 2 ** 20))
})
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...args: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, ...args] })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
const item = (page: Page, name: string) => page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name, exact: true })
const grid = (page: Page, name: string) => page.getByRole('grid', { name: `Hexadecimal view of ${name}` })

test('a library opens in hexadecimal, says what its header is, and its bytes can be selected, copied, found and gone to', async () => {
  const page = await launch(work)
  await item(page, 'libdemo.so').dblclick()
  const view = grid(page, 'libdemo.so')
  await expect(view).toBeVisible()
  await expect(page.getByText('ELF 64-bit LSB shared object, x86-64')).toBeVisible()
  await expect(view.getByRole('row').first()).toContainText('00000000')
  await expect(view.getByRole('row').first()).toContainText('7f454c46')
  await expect(view.getByRole('row').first()).toContainText('.ELF')

  // Go to an offset far down, in hex.
  await page.getByLabel('Go to offset').fill('0x800')
  await page.getByLabel('Go to offset').press('Enter')
  await expect(page.getByText('Offset 0x800 (2048)')).toBeVisible()
  // (Two rows of what comes before are drawn above it.)
  await expect(view.getByRole('row').nth(2)).toContainText('00000800')

  // Find bytes: 0xfe 0xff 0x00 first appears at 254.
  await page.getByPlaceholder('Bytes, e.g. 4d 5a').fill('fe ff 00')
  await page.getByPlaceholder('Bytes, e.g. 4d 5a').press('Enter')
  await expect(page.getByText('3 bytes selected')).toBeVisible()

  // Copy what is selected.
  await page.getByRole('button', { name: 'Copy as hex' }).click()
  await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toBe('fe ff 00')
})

test('a file of an unknown type that is not text opens in hexadecimal, and a text file stays text', async () => {
  const page = await launch(work)
  await item(page, 'blob.xyz').dblclick()
  await expect(grid(page, 'blob.xyz')).toBeVisible()
  await expect(grid(page, 'blob.xyz').getByRole('row')).toContainText('0102000304ff')
  await item(page, 'notes.txt').dblclick()
  await expect(page.locator('.cm-content')).toContainText('text stays text')
})

test('a file of an unknown type that is a ZIP is shown in hexadecimal, and a text file too large to open offers "View as hex"', async () => {
  const page = await launch(work)
  await item(page, 'report.pages').dblclick()
  await expect(grid(page, 'report.pages')).toBeVisible()
  await expect(page.getByText('ZIP archive')).toBeVisible()
  await item(page, 'huge.txt').dblclick()
  await expect(page.getByText('This kind of file is not shown here.')).toBeVisible()
  await page.getByRole('button', { name: 'View as hex' }).click()
  await expect(page.getByRole('tab', { name: /^Hex: huge\.txt/ })).toBeVisible()
  await expect(grid(page, 'huge.txt')).toBeVisible()
  await expect(grid(page, 'huge.txt').getByRole('row').first()).toContainText('6c696e65206f66')
})

test('a file over what is read whole is read a window at a time: the end of it is there', async () => {
  const page = await launch(work)
  await item(page, 'big.iso').dblclick()
  await expect(grid(page, 'big.iso')).toBeVisible()
  await expect(grid(page, 'big.iso').getByRole('row').first()).toContainText('7f454c46')
  const last = 17 * 2 ** 20 - 1
  await page.getByLabel('Go to offset').fill(last.toString(16))
  await page.getByLabel('Go to offset').press('Enter')
  await expect(page.getByText(`Offset 0x${last.toString(16)} (${last})`)).toBeVisible()
  await expect(grid(page, 'big.iso').getByRole('row').last()).toContainText('ff')
})
