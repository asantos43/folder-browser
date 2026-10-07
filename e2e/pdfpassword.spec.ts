import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { makeEncryptedPdf, makePdf } from '../fixtures/pdf.ts'

// End-to-end: a PDF with a password asks for it in its tab (the real pdf.js decrypts the fixture), and a PDF with none opens as before.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-pdfpw-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'secret.pdf'), makeEncryptedPdf([{ lines: ['the secret page'] }, { lines: ['page two'] }], 'harbor'))
  fs.writeFileSync(path.join(work, 'open.pdf'), makePdf([{ lines: ['nothing secret'] }]))
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
const item = (page: Page, name: string) => page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name, exact: true })

test('a PDF with a password asks for it; a wrong one asks again, the right one draws the pages', async () => {
  const page = await launch(work)
  await item(page, 'secret.pdf').dblclick()
  const field = page.getByLabel('Password', { exact: true })
  await expect(page.getByText(/protected with a password/)).toBeVisible()
  await expect(page.getByRole('img', { name: 'Page 1' })).toHaveCount(0)
  await field.fill('wrong one')
  await field.press('Enter')
  await expect(page.getByRole('alert')).toHaveText('That password is not right. Try again.')
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  await field.fill('harbor')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Page 2' })).toBeVisible()
  await expect(page.getByText('of 2')).toBeVisible()
  await expect(field).toHaveCount(0)
  // A PDF with none opens at once.
  await item(page, 'open.pdf').dblclick()
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)
})

test('the characters of the zoom keys can be typed in a password', async () => {
  const page = await launch(work)
  await item(page, 'secret.pdf').dblclick()
  const field = page.getByLabel('Password', { exact: true })
  await field.click()
  await page.keyboard.type('+-0=')
  await expect(field).toHaveValue('+-0=')
})
