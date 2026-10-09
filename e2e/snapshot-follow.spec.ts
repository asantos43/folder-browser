import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeRichWsnp } from '../fixtures/build.ts'

// End-to-end (issue #58): bringing the tab of a snapshot to the front takes the Files area to the folder that contains the `.wsnp`, with its row highlighted; the snapshot is still a page in a tab and never lists its own files.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let alpha: string
let beta: string
let app: ElectronApplication | undefined

test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-follow-'))
  alpha = path.join(dir, 'alpha')
  beta = path.join(dir, 'beta')
  fs.mkdirSync(alpha)
  fs.mkdirSync(path.join(beta, 'saved'), { recursive: true })
  fs.writeFileSync(path.join(alpha, 'notes.txt'), 'notes of alpha')
  fs.writeFileSync(path.join(beta, 'other.txt'), 'other')
  await writeRichWsnp(path.join(beta, 'saved', 'harbor.wsnp'), { title: 'Harbor Times', url: 'https://harbortimes.example/' })
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
const tree = (page: Page) => page.getByRole('tree', { name: 'Files and folders' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true })
const rowNames = (page: Page) => tree(page).getByRole('treeitem').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')))

test('the tab of a snapshot takes the Files to the folder that contains the .wsnp and highlights its row; the tab of a text takes them back', async () => {
  const page = await launch(alpha, beta)
  const open = page.getByRole('listbox', { name: 'Open Folders' })
  // A text of alpha: the Files show alpha.
  await open.getByText('alpha', { exact: true }).click()
  await item(page, 'notes.txt').dblclick()
  const textTab = page.getByRole('tab', { name: /notes\.txt/ })
  await expect(textTab).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => rowNames(page)).toEqual(['notes.txt'])
  // The snapshot of beta, opened from its tree (a folder below the root): the Files show beta.
  await open.getByText('beta', { exact: true }).click()
  await item(page, 'saved').click()
  await item(page, 'harbor.wsnp').dblclick()
  const snapshotTab = page.getByRole('tab', { name: /harbor\.wsnp/ })
  await expect(snapshotTab).toHaveAttribute('aria-selected', 'true')
  await expect(item(page, 'harbor.wsnp')).toHaveAttribute('aria-selected', 'true')
  // Back to the text: the Files are alpha's again.
  await textTab.click()
  await expect.poll(() => rowNames(page)).toEqual(['notes.txt'])
  await expect(item(page, 'notes.txt')).toHaveAttribute('aria-selected', 'true')
  // To the snapshot: beta, the folder open down to the .wsnp, whose row is the highlighted one. The files of the snapshot are not listed.
  await snapshotTab.click()
  await expect.poll(() => rowNames(page)).toEqual(['saved', 'harbor.wsnp', 'other.txt'])
  await expect(item(page, 'harbor.wsnp')).toHaveAttribute('aria-selected', 'true')
  await expect(item(page, 'manifest.json')).toHaveCount(0)
})
