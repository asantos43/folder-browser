import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: the places of the side bar (a made-up home), the favourites, the recent folders and the trash.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let home: string
let data: string
let app: ElectronApplication | undefined

test.skip(process.platform !== 'linux', 'the trash and the home folders are a Linux layout here (XDG_DATA_HOME, HOME)')

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-places-'))
  home = path.join(dir, 'home')
  data = path.join(dir, 'data')
  for (const name of ['Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'Desktop', path.join('projects', 'alpha')]) fs.mkdirSync(path.join(home, name), { recursive: true })
  // The desktop's own list of the user's folders (without it, Documents and Downloads are the home folder itself).
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'config', 'user-dirs.dirs'), ['DESKTOP', 'DOWNLOAD', 'DOCUMENTS', 'MUSIC', 'PICTURES', 'VIDEOS'].map((k) => `XDG_${k}_DIR="${home}/${{ DESKTOP: 'Desktop', DOWNLOAD: 'Downloads', DOCUMENTS: 'Documents', MUSIC: 'Music', PICTURES: 'Pictures', VIDEOS: 'Videos' }[k]}"`).join('\n'))
  fs.writeFileSync(path.join(home, 'Documents', 'letter.txt'), 'dear meadow')
  fs.writeFileSync(path.join(home, 'projects', 'alpha', 'main.c'), 'int main(void) {}')
  fs.mkdirSync(path.join(data, 'Trash', 'files'), { recursive: true })
  fs.mkdirSync(path.join(data, 'Trash', 'info'))
  fs.writeFileSync(path.join(data, 'Trash', 'files', 'old.txt'), 'thrown away')
  fs.writeFileSync(path.join(data, 'Trash', 'info', 'old.txt.trashinfo'), `[Trash Info]\nPath=${encodeURI(path.join(home, 'Documents', 'old.txt'))}\nDeletionDate=2026-02-03T10:00:00\n`)
})
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...args: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, ...args], env: { ...process.env, HOME: home, XDG_DATA_HOME: data, XDG_CONFIG_HOME: path.join(dir, 'config') } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
const places = (page: Page) => page.getByRole('listbox', { name: 'Places', exact: true }).getByRole('option')
const place = (page: Page, name: string) => places(page).filter({ hasText: new RegExp(`^${name}$`) })
const favorites = (page: Page) => page.getByRole('listbox', { name: 'Favorites' }).getByRole('option')
const recent = (page: Page) => page.getByRole('listbox', { name: 'Recent Folders' }).getByRole('option')
const tree = (page: Page) => page.getByRole('tree', { name: 'Files and folders' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true })

test('the places of the side bar are the folders of the home that are there, in the order of a file manager, with the trash', async () => {
  const page = await launch()
  await expect(places(page)).toHaveText(['Home', 'Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'Trash', 'Computer'])
  await expect(page.getByText('Drop a folder here to pin it.')).toBeVisible()
})

test('a click on a place opens its folder as the root of the tree, and lights it', async () => {
  const page = await launch()
  await place(page, 'Documents').click()
  await expect(item(page, 'letter.txt')).toBeVisible()
  await expect(place(page, 'Documents')).toHaveAttribute('aria-selected', 'true')
  await item(page, 'letter.txt').dblclick()
  await expect(page.locator('.cm-content')).toContainText('dear meadow')
  // The folder that was opened is among the recent ones.
  await expect(recent(page)).toHaveText(['Documents'])
})

test('a folder is pinned from its menu or by dragging it to the favourites, kept for the next start, moved and removed', async () => {
  let page = await launch(path.join(home, 'projects'))
  await item(page, 'alpha').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add to Favorites' }).click()
  await expect(favorites(page)).toHaveText(['alpha'])
  await place(page, 'Documents').click()
  await expect(item(page, 'letter.txt')).toBeVisible()
  await place(page, 'Home').click()
  await item(page, 'Downloads').dragTo(page.getByRole('listbox', { name: 'Favorites' }))
  await expect(favorites(page)).toHaveText(['alpha', 'Downloads'])
  await favorites(page).last().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move Up' }).click()
  await expect(favorites(page)).toHaveText(['Downloads', 'alpha'])
  await app!.close()
  app = undefined
  page = await launch()
  await expect(favorites(page)).toHaveText(['Downloads', 'alpha'])
  await favorites(page).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Remove from Favorites' }).click()
  await expect(favorites(page)).toHaveText(['alpha'])
  await favorites(page).first().click()
  await expect(item(page, 'main.c')).toBeVisible()
})

test('the recent folders are listed, latest first, and can be cleared', async () => {
  const page = await launch()
  await place(page, 'Documents').click()
  await expect(recent(page)).toHaveText(['Documents'])
  await place(page, 'Downloads').click()
  await expect(recent(page)).toHaveText(['Downloads', 'Documents'])
  await recent(page).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Clear Recent Folders' }).click()
  await expect(page.getByRole('listbox', { name: 'Recent Folders' })).toHaveCount(0)
})

test('the trash opens as a folder: an item is put back where it was, and emptying asks first', async () => {
  const page = await launch()
  await place(page, 'Trash').click()
  await expect(item(page, 'old.txt')).toBeVisible()
  await item(page, 'old.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Restore' }).click()
  await expect.poll(() => fs.existsSync(path.join(home, 'Documents', 'old.txt'))).toBe(true)
  expect(fs.readFileSync(path.join(home, 'Documents', 'old.txt'), 'utf8')).toBe('thrown away')
  await expect(item(page, 'old.txt')).toHaveCount(0)
  // Something else in the trash, then Empty Trash: Cancel keeps it, the confirmation deletes it for good.
  fs.writeFileSync(path.join(data, 'Trash', 'files', 'junk.txt'), 'junk')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(item(page, 'junk.txt')).toBeVisible()
  await page.getByRole('button', { name: 'Empty Trash' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Empty the trash?' })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(fs.existsSync(path.join(data, 'Trash', 'files', 'junk.txt'))).toBe(true)
  await page.getByRole('button', { name: 'Empty Trash' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Empty Trash' }).click()
  await expect.poll(() => fs.readdirSync(path.join(data, 'Trash', 'files'))).toEqual([])
  await expect(item(page, 'junk.txt')).toHaveCount(0)
})
