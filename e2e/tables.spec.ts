import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: a CSV as a table: sort, filter, search, a SQL query in a worker, editing cells (saved into the file, kept for the next start), and a file of a hundred thousand rows.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined
const profile = () => path.join(dir, 'profile')
const draftFiles = () => (fs.existsSync(path.join(profile(), 'drafts')) ? fs.readdirSync(path.join(profile(), 'drafts')).filter((n) => n.endsWith('.json')) : [])

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-tables-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'boats.csv'), '﻿Boat,Seats,Kind\r\nGull,12,sail\r\n"Heron, big",8,motor\r\nTern,100,sail\r\nAuk,,motor\r\n')
  const big = ['id,name,value', ...Array.from({ length: 100_000 }, (_, i) => `${i + 1},item ${i + 1},${(i * 7) % 1000}`)]
  fs.writeFileSync(path.join(work, 'big.csv'), big.join('\n') + '\n')
})
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {})
  await app?.close().catch(() => {})
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
const table = (page: Page, name = 'boats.csv') => page.getByRole('table', { name: `Table of ${name}` })
const firstColumn = async (page: Page) => (await table(page).locator('tbody td[data-c="0"]').allInnerTexts()).map((t) => t.trim())
async function openBoats(page: Page) {
  await item(page, 'boats.csv').dblclick()
  await expect(table(page)).toBeVisible()
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
const run = async (page: Page, sql: string) => {
  await page.getByLabel('SQL query').fill(sql)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
}

test('sorts by a column (numbers as numbers), filters by a condition and by ticked values, and the file is not touched', async () => {
  const page = await launch(work)
  await openBoats(page)
  expect(await firstColumn(page)).toEqual(['Gull', 'Heron, big', 'Tern', 'Auk'])
  await page.getByRole('columnheader', { name: 'Seats' }).hover()
  await page.getByRole('button', { name: 'Sort by Seats' }).click()
  expect(await firstColumn(page)).toEqual(['Heron, big', 'Gull', 'Tern', 'Auk'])
  await page.getByRole('button', { name: 'Sort by Seats' }).click()
  expect(await firstColumn(page)).toEqual(['Tern', 'Gull', 'Heron, big', 'Auk'])
  await page.getByRole('button', { name: 'Show every row again' }).click()
  await page.getByRole('columnheader', { name: 'Kind' }).hover()
  await page.getByRole('button', { name: 'Filter Kind' }).click()
  const panel = page.getByRole('dialog', { name: 'Filter Kind' })
  await panel.getByRole('checkbox', { name: /motor/ }).check()
  await panel.getByRole('button', { name: 'Apply' }).click()
  expect(await firstColumn(page)).toEqual(['Heron, big', 'Auk'])
  await expect(page.getByText('2 of 4 rows, 3 columns')).toBeVisible()
  await page.getByRole('columnheader', { name: 'Seats' }).hover()
  await page.getByRole('button', { name: 'Filter Seats' }).click()
  const seats = page.getByRole('dialog', { name: 'Filter Seats' })
  await seats.getByLabel('Condition').selectOption('not-empty')
  await seats.getByRole('button', { name: 'Apply' }).click()
  expect(await firstColumn(page)).toEqual(['Heron, big'])
  expect(fs.readFileSync(path.join(work, 'boats.csv'), 'utf8')).toBe('﻿Boat,Seats,Kind\r\nGull,12,sail\r\n"Heron, big",8,motor\r\nTern,100,sail\r\nAuk,,motor\r\n')
})

test('Ctrl+F marks the cells with the text and steps through them', async () => {
  const page = await launch(work)
  await openBoats(page)
  await page.locator('body').click()
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByRole('textbox', { name: /^Find/ }).fill('sail')
  await expect(page.getByText('1 of 2')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByText('2 of 2')).toBeVisible()
  await expect(table(page).locator('td[data-c="2"][class*="wsnp-find"]')).toHaveCount(2)
})

test('the query box runs one SELECT in a worker, shows the result in the table, refuses the rest, and Show All Rows goes back', async () => {
  const page = await launch(work)
  await openBoats(page)
  await page.getByRole('button', { name: 'Ask the table a question in SQL' }).click()
  await run(page, 'SELECT Kind, count(*) AS boats, sum(Seats) AS seats FROM t GROUP BY Kind ORDER BY Kind')
  const result = page.getByRole('table', { name: 'Result of the query' })
  await expect(result).toBeVisible()
  await expect(result.locator('tbody tr')).toHaveCount(2)
  await expect(result.getByRole('cell', { name: 'motor' })).toBeVisible()
  await expect(result.locator('tbody tr').first().getByRole('cell').nth(2)).toHaveText('8')
  await run(page, 'DELETE FROM t')
  await expect(page.getByRole('alert')).toContainText('Only SELECT queries can be run')
  await run(page, 'SELECT 1; SELECT 2')
  await expect(page.getByRole('alert')).toContainText('Only one statement')
  await run(page, 'SELECT nope FROM t')
  await expect(page.getByRole('alert')).toContainText('no such column')
  await run(page, 'SELECT Boat FROM t WHERE Seats > 10 ORDER BY Seats')
  await expect(result.locator('tbody tr')).toHaveCount(2)
  await page.getByRole('button', { name: 'Show All Rows' }).click()
  await expect(table(page)).toBeVisible()
  expect(await firstColumn(page)).toEqual(['Gull', 'Heron, big', 'Tern', 'Auk'])
  expect(fs.readFileSync(path.join(work, 'boats.csv'), 'utf8')).toContain('Gull,12,sail')
})

test('a query that never ends is stopped, and the box works again', async () => {
  test.setTimeout(60_000)
  const page = await launch(work)
  await openBoats(page)
  await page.getByRole('button', { name: 'Ask the table a question in SQL' }).click()
  await run(page, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c')
  await expect(page.getByRole('alert')).toContainText('took too long', { timeout: 25_000 })
  await run(page, 'SELECT count(*) AS n FROM t')
  await expect(page.getByRole('table', { name: 'Result of the query' }).getByRole('cell', { name: '4' })).toBeVisible()
})

test('a cell is edited in the table: the tab is marked, Ctrl+S writes only that cell (quotes, line endings and byte order mark kept), and undo works', async () => {
  const page = await launch(work)
  await openBoats(page)
  await table(page).getByRole('cell', { name: 'Gull' }).dblclick()
  const box = page.getByRole('textbox', { name: 'Edit cell' })
  await box.fill('Gull, grey')
  await box.press('Enter')
  await expect(tab(page, 'boats.csv')).toContainText('Modified')
  await expect(table(page).getByRole('cell', { name: 'Gull, grey' })).toBeVisible()
  expect(fs.readFileSync(path.join(work, 'boats.csv'), 'utf8')).toContain('Gull,12')
  // Down from the cell edited, then type to replace the cell: 8 seats become 9.
  await table(page).getByRole('cell', { name: '8', exact: true }).click()
  await page.keyboard.type('9')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(table(page).getByRole('cell', { name: '8', exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => fs.readFileSync(path.join(work, 'boats.csv'), 'utf8')).toBe('﻿Boat,Seats,Kind\r\n"Gull, grey",12,sail\r\n"Heron, big",8,motor\r\nTern,100,sail\r\nAuk,,motor\r\n')
  await expect(tab(page, 'boats.csv')).not.toContainText('Modified')
})

test('rows and columns are added and deleted, and the text view shows the same text', async () => {
  const page = await launch(work)
  await openBoats(page)
  await table(page).getByRole('cell', { name: 'Tern' }).click()
  await page.getByRole('button', { name: 'Delete the selected row' }).click()
  await page.getByRole('button', { name: /Add an empty row/ }).click()
  await table(page).getByRole('cell', { name: 'Gull' }).click()
  await page.getByRole('button', { name: 'Delete the selected column' }).click()
  await page.getByRole('button', { name: 'Show the file as text' }).click()
  await expect(page.locator('.cm-content')).toContainText('Seats,Kind')
  await expect(page.locator('.cm-content')).not.toContainText('Tern')
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => fs.readFileSync(path.join(work, 'boats.csv'), 'utf8')).toBe('﻿Seats,Kind\r\n12,sail\r\n8,motor\r\n,motor\r\n,\r\n')
})

test('the cells edited are kept for the next start, and come back marked', async () => {
  const page = await launch(work)
  await openBoats(page)
  await table(page).getByRole('cell', { name: 'Auk' }).dblclick()
  await page.getByRole('textbox', { name: 'Edit cell' }).fill('Skua')
  await page.getByRole('textbox', { name: 'Edit cell' }).press('Enter')
  await expect.poll(draftFiles).toHaveLength(1)
  await Promise.all([page.waitForEvent('close'), app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())])
  await app!.close().catch(() => {})
  app = undefined
  expect(fs.readFileSync(path.join(work, 'boats.csv'), 'utf8')).toContain('Auk')
  const again = await launch()
  await expect(table(again)).toBeVisible()
  await expect(table(again).getByRole('cell', { name: 'Skua' })).toBeVisible()
  await expect(tab(again, 'boats.csv')).toContainText('Modified')
})

test('a file of a hundred thousand rows scrolls, sorts and is queried, drawing only the rows in view', async () => {
  test.setTimeout(90_000)
  const page = await launch(work)
  await item(page, 'big.csv').dblclick()
  const big = table(page, 'big.csv')
  await expect(big).toBeVisible()
  await expect(page.getByText('100001 rows, 3 columns')).toBeVisible()
  expect(await big.locator('tbody td[data-c="0"]').count()).toBeLessThan(150)
  await big.evaluate((el) => (el.parentElement!.scrollTop = el.parentElement!.scrollHeight))
  await expect(big.getByRole('cell', { name: '100000', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Ask the table a question in SQL' }).click()
  await run(page, 'SELECT count(*) AS n, max(value) AS top FROM t WHERE value > 990')
  await expect(page.getByRole('table', { name: 'Result of the query' }).getByRole('cell', { name: '999', exact: true })).toBeVisible({ timeout: 20_000 })
})
