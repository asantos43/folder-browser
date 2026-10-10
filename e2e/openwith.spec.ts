import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { RICH_PDF, writeViewerWsnp } from '../fixtures/build.ts'
import { goToFile } from './helpers.ts'

// End-to-end: the context menu of the tree offers Open With…, which hands a read-only copy to the application the system lets the user choose.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-with-'))
  fs.mkdirSync(path.join(dir, 'tmp'))
})
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const log = () => path.join(dir, 'handed-over.log')
const staged = () => fs.readdirSync(path.join(dir, 'tmp')).filter((n) => n.startsWith('wsnp-open-'))
const handedOver = () => (fs.existsSync(log()) ? fs.readFileSync(log(), 'utf8').split('\n').filter(Boolean) : [])
/** The folder for temporary files is the test's own, so the copies can be counted; the system's chooser is replaced by a log. */
async function launch(extraEnv: Record<string, string> = {}, logHandOver = true): Promise<Page> {
  const file = path.join(dir, 'viewer.wsnp')
  await writeViewerWsnp(file, { title: 'Meadow Times', url: 'https://meadowtimes.example/' })
  const tmp = path.join(dir, 'tmp')
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, file], env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, ...(logHandOver ? { WSNP_OPEN_WITH_LOG: log() } : {}), ...extraEnv } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByRole('tab').first().waitFor()
  return page
}
/** A file of the snapshot opens in a tab (as a link in its page would open it), and the menu of that tab is asked for Open With…. */
async function openWithOf(page: Page, name: string) {
  await goToFile(page, name)
  await page.getByRole('tab', { selected: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open With…' }).click()
}

test('the menu of the tab of a file offers Open With…; the tab of the page of the snapshot has none', async () => {
  const page = await launch()
  await goToFile(page, 'report.pdf')
  await page.getByRole('tab', { selected: true }).click({ button: 'right' })
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Open With…' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('tab').first().click({ button: 'right' })
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Open With…' })).toHaveCount(0)
})

test('Open With… hands over a read-only copy of the file, under its own name, and the copy is gone when the application quits', async () => {
  const page = await launch()
  await openWithOf(page, 'report.pdf')
  await expect.poll(handedOver).toHaveLength(1)
  const [copy] = handedOver()
  expect(path.basename(copy)).toBe('report.pdf')
  expect(path.basename(path.dirname(copy)).startsWith('wsnp-open-')).toBe(true)
  expect(fs.realpathSync(path.dirname(path.dirname(copy)))).toBe(fs.realpathSync(path.join(dir, 'tmp')))
  expect(fs.readFileSync(copy).equals(RICH_PDF)).toBe(true)
  if (process.platform !== 'win32') expect(fs.statSync(copy).mode & 0o777).toBe(0o400)
  // Nothing more was opened in the viewer (the tab of the file is the one it was asked from), and nothing is said.
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(staged()).toHaveLength(1)
  await app!.close()
  app = undefined
  expect(staged()).toEqual([])
})

test('a file that could run as a program is not handed over: it is said, and nothing is written', async () => {
  const page = await launch()
  await openWithOf(page, 'setup.exe')
  await expect(page.getByRole('status')).toContainText('setup.exe is a kind of file that can run as a program')
  expect(handedOver()).toEqual([])
  expect(staged()).toEqual([])
})

test('the copies an earlier session left, a day old or more, are removed at start, and a young one is not', async () => {
  const old = path.join(dir, 'tmp', 'wsnp-open-old')
  const young = path.join(dir, 'tmp', 'wsnp-open-young')
  for (const d of [old, young]) {
    fs.mkdirSync(d)
    fs.writeFileSync(path.join(d, 'a.txt'), 'a')
  }
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3_600_000)
  fs.utimesSync(old, twoDaysAgo, twoDaysAgo)
  await launch()
  await expect.poll(staged).toEqual(['wsnp-open-young'])
})

/** Linux: the viewer shows the choice itself, from the applications of a desktop that the test makes up (its own data folders), and `gio` launches the one picked. */
test.describe('the chooser of the viewer (Linux)', () => {
  test.skip(process.platform !== 'linux' || spawnSync('gio', ['--version']).status !== 0, 'needs Linux and gio')

  const opened = () => path.join(dir, 'opened.log')
  const handedOver2 = () => (fs.existsSync(opened()) ? fs.readFileSync(opened(), 'utf8').split('\n').filter(Boolean) : [])
  function fakeDesktop(): Record<string, string> {
    const apps = path.join(dir, 'share/applications')
    fs.mkdirSync(apps, { recursive: true })
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
    const script = path.join(dir, 'record.sh')
    fs.writeFileSync(script, `#!/bin/sh\necho "$1" >> "${opened()}"\n`, { mode: 0o755 })
    const entry = (name: string, mime: string) => `[Desktop Entry]\nType=Application\nName=${name}\nExec=${script} %f\nMimeType=${mime};\nTerminal=false\n`
    fs.writeFileSync(path.join(apps, 'fake-pdf.desktop'), entry('Fake PDF Viewer', 'application/pdf'))
    fs.writeFileSync(path.join(apps, 'fake-other.desktop'), entry('Fake Other Program', 'text/plain'))
    fs.writeFileSync(path.join(apps, 'mimeinfo.cache'), '[MIME Cache]\napplication/pdf=fake-pdf.desktop;\ntext/plain=fake-other.desktop;\n')
    return { XDG_DATA_HOME: path.join(dir, 'data'), XDG_DATA_DIRS: `${path.join(dir, 'share')}:/usr/share`, XDG_CONFIG_HOME: path.join(dir, 'config'), LANG: 'en_US.UTF-8', LC_ALL: '' }
  }
  async function ask(page: Page) {
    await openWithOf(page, 'report.pdf')
    return page.getByRole('dialog', { name: 'Open With' })
  }

  test('shows the dialog in front of the window, with the file, the applications of the type first, and the others', async () => {
    const page = await launch(fakeDesktop(), false)
    const dialog = await ask(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Choose an app to open report.pdf')
    await expect(dialog).toContainText('PDF document')
    await expect(dialog.getByRole('option', { name: 'Fake PDF Viewer' })).toBeVisible()
    const names = await dialog.getByRole('option').allTextContents()
    expect(names).toContain('Fake Other Program')
    // The one registered for the type is among the recommended ones, which come first.
    expect(names.indexOf('Fake PDF Viewer')).toBeLessThan(names.indexOf('Fake Other Program'))
    await expect(dialog.getByText('Recommended Apps')).toBeVisible()
    await expect(dialog.getByText('Other Apps')).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Search apps' })).toBeFocused()
    // It is the topmost thing on the page: a click at its middle lands in it.
    const box = (await dialog.boundingBox())!
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role=dialog]') !== null, [box.x + box.width / 2, box.y + box.height / 2])
    expect(top).toBe(true)
  })

  test('opens a read-only copy with the application picked, through the desktop, and the copy goes at quit', async () => {
    const page = await launch(fakeDesktop(), false)
    const dialog = await ask(page)
    await dialog.getByRole('textbox', { name: 'Search apps' }).fill('fake pdf')
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Open' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(handedOver2).toHaveLength(1)
    const [copy] = handedOver2()
    expect(path.basename(copy)).toBe('report.pdf')
    expect(fs.readFileSync(copy).equals(RICH_PDF)).toBe(true)
    expect(fs.statSync(copy).mode & 0o777).toBe(0o400)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(staged()).toHaveLength(1)
    await app!.close()
    app = undefined
    expect(staged()).toEqual([])
  })

  test('"Always use for this file type" makes it the default of the desktop', async () => {
    const page = await launch(fakeDesktop(), false)
    const dialog = await ask(page)
    await dialog.getByRole('option', { name: 'Fake PDF Viewer' }).click()
    await dialog.getByRole('switch', { name: 'Always use for this file type' }).check()
    await dialog.getByRole('button', { name: 'Open' }).click()
    await expect.poll(() => (fs.existsSync(path.join(dir, 'config/mimeapps.list')) ? fs.readFileSync(path.join(dir, 'config/mimeapps.list'), 'utf8') : '')).toContain('application/pdf=fake-pdf.desktop')
  })

  test('Cancel, Escape and a click outside open nothing and remove the copy made for the dialog', async () => {
    const page = await launch(fakeDesktop(), false)
    for (const how of ['button', 'escape', 'outside'] as const) {
      const dialog = await ask(page)
      await expect(dialog).toBeVisible()
      await expect.poll(staged).toHaveLength(1)
      if (how === 'button') await dialog.getByRole('button', { name: 'Cancel' }).click()
      else if (how === 'escape') await page.keyboard.press('Escape')
      else await page.mouse.click(5, 400)
      await expect(dialog).toHaveCount(0)
      await expect.poll(staged).toEqual([])
    }
    expect(handedOver2()).toEqual([])
  })

  test('a file that could run as a program never gets as far as the dialog', async () => {
    const page = await launch(fakeDesktop(), false)
    await openWithOf(page, 'setup.exe')
    await expect(page.getByRole('status')).toContainText('setup.exe is a kind of file that can run as a program')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(staged()).toEqual([])
  })
})
