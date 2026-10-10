import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { zipSync } from '../fixtures/zip.ts'

// End-to-end: the box in the title bar (and Ctrl+E) is Go to File: it finds the files of the open folders and ZIP files by part of their names, with no snapshot open; and the tabs of an
// editor group, when there are more than fit, have a thin scroll bar and the wheel moves them.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-goto-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(path.join(work, 'src', 'deep'), { recursive: true })
  fs.mkdirSync(path.join(work, 'node_modules', 'pkg'), { recursive: true })
  fs.writeFileSync(path.join(work, 'readme.txt'), 'the readme of the meadow')
  fs.writeFileSync(path.join(work, 'src', 'deep', 'schedule.txt'), 'ferry at noon')
  fs.writeFileSync(path.join(work, 'src', 'main.ts'), 'export const x = 1\n')
  fs.writeFileSync(path.join(work, '.secret.txt'), 'hidden')
  fs.writeFileSync(path.join(work, 'node_modules', 'pkg', 'schedule-lib.txt'), 'not indexed')
  fs.writeFileSync(path.join(work, 'pack.zip'), zipSync([{ name: 'inside/timetable.txt', data: 'in a zip' }]))
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
const box = (page: Page) => page.getByRole('combobox', { name: 'Go to File' })
const option = (page: Page, name: RegExp | string) => page.getByRole('option', { name })

test('the box of the title bar opens Go to File with only a folder open, and finds a file deep in it by part of its name', async () => {
  const page = await launch(work)
  await page.getByTestId('titlebar').getByRole('button', { name: /Folder Browser|Search|Go to File/ }).first().click()
  await expect(box(page)).toBeVisible()
  await box(page).fill('sched')
  await expect(option(page, /schedule\.txt/)).toBeVisible()
  // Not what is in node_modules, nor what starts with a dot.
  await expect(option(page, /schedule-lib/)).toHaveCount(0)
  await box(page).fill('secret')
  await expect(page.getByText('No matching results')).toBeVisible()
  await box(page).fill('sched')
  await box(page).press('Enter')
  await expect(page.getByRole('tab', { name: /^schedule\.txt/ })).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('ferry at noon')
})

test('Ctrl+E does the same, with the hidden files when they are shown, and the entries of a ZIP root', async () => {
  const page = await launch(work)
  await page.keyboard.press('ControlOrMeta+h')
  await page.keyboard.press('ControlOrMeta+e')
  await box(page).fill('secret')
  await expect(option(page, /\.secret\.txt/)).toBeVisible()
  await box(page).press('Escape')
  await page.keyboard.press('ControlOrMeta+h')
  // A ZIP opened as the root.
  await page.getByRole('button', { name: 'Open ZIP File', exact: true }).first().click({ trial: true }).catch(() => undefined)
  await app!.evaluate(({ dialog }, picked) => void (dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as unknown as typeof dialog.showOpenDialog), path.join(work, 'pack.zip'))
  await page.getByRole('navigation', { name: 'Activity Bar' }).getByRole('button', { name: 'Open ZIP File' }).click()
  await page.keyboard.press('ControlOrMeta+e')
  await box(page).fill('timet')
  await expect(option(page, /timetable\.txt/)).toBeVisible()
  await box(page).press('Enter')
  await expect(page.locator('.cm-content')).toContainText('in a zip')
})

test('Go to File does nothing only when nothing is open', async () => {
  const page = await launch()
  await page.keyboard.press('ControlOrMeta+e')
  await expect(box(page)).toHaveCount(0)
})

test('the tabs that do not fit have a thin scroll bar; the wheel moves them and the tab that comes to the front is brought into view', async () => {
  const many = path.join(dir, 'many')
  fs.mkdirSync(many)
  for (let i = 1; i <= 24; i++) fs.writeFileSync(path.join(many, `file-number-${i}.txt`), `file ${i}\n`)
  const page = await launch(many)
  const item = (name: string) => page.getByRole('tree', { name: 'Files and folders' }).getByRole('treeitem', { name, exact: true })
  for (let i = 1; i <= 24; i++) await item(`file-number-${i}.txt`).dblclick()
  const strip = page.getByRole('tablist')
  const measure = () => strip.evaluate((el) => ({ wide: el.scrollWidth > el.clientWidth + 100, left: el.scrollLeft, bar: getComputedStyle(el, '::-webkit-scrollbar').height }))
  const first = await measure()
  expect(first.wide).toBe(true)
  expect(first.bar).toBe('4px')
  // The last tab is the one in front, so the end of the strip is what is shown; the wheel goes back along it.
  await strip.hover()
  await page.mouse.wheel(0, -600)
  await expect.poll(async () => (await measure()).left).toBeLessThan(first.left - 100)
  // Bringing the first tab to the front shows it.
  await item('file-number-1.txt').dblclick()
  await expect.poll(async () => (await measure()).left).toBeLessThan(50)
  await expect(page.getByRole('tab', { name: /^file-number-1\.txt/ })).toBeInViewport()
})
