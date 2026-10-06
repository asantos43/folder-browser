import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { networkProbeFiles, PNG_1X1, RICH_PDF, RICH_ZIP, richFiles, writeRichWsnp, writeSampleWsnp, writeWsnp } from '../fixtures/build.ts'
import { writeApplication, writeManifestEdited, writeManifestSizeEdited, writeNewer, writeNotAZip, writeProtected, writeTampered } from '../fixtures/hostile.ts'
import { startProbeServer } from './probe-server.ts'

// End-to-end: opening files and working with them in the real app. Files are synthetic and made in a folder of each test.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
const htmlMenu = process.platform !== 'darwin'
let dir: string
let app: ElectronApplication | undefined

test.beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-snap-'))))
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const profile = () => path.join(dir, 'profile')
async function launch(...files: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile()}`, ...noSandbox, ...files] })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
async function harbor(name = 'harbor.wsnp', title = 'Harbor Times') {
  const file = path.join(dir, name)
  await writeRichWsnp(file, { title, url: 'https://harbortimes.example/' })
  return file
}
const frameOf = (page: Page, title: string) => page.frameLocator(`iframe[title="Snapshot: ${title}"]`)
const tabs = (page: Page) => page.getByRole('tab')
const tabNames = (page: Page) => tabs(page).evaluateAll((els) => els.map((e) => e.querySelector('span.truncate')?.textContent ?? ''))
const activeTab = (page: Page) => page.locator('[role=tab][aria-selected=true]')

/** The Save As dialog and the browser cannot be driven: the main process answers for them, and keeps what it was asked. */
async function stubDialogs(saveTo: string) {
  await app!.evaluate(({ dialog, shell }, target) => {
    const g = globalThis as unknown as { __external: string[]; __saveAsked: number }
    g.__external = []
    g.__saveAsked = 0
    dialog.showSaveDialog = (async () => ((g.__saveAsked += 1), { canceled: false, filePath: target })) as unknown as typeof dialog.showSaveDialog
    shell.openExternal = (async (url: string) => void g.__external.push(url)) as unknown as typeof shell.openExternal
  }, saveTo)
}
const external = () => app!.evaluate(() => (globalThis as unknown as { __external: string[] }).__external)

test('the files named on the command line open, each in a tab of its own, and the page works', async () => {
  const a = await harbor()
  const b = path.join(dir, 'second.wsnp')
  await writeSampleWsnp(b, { title: 'Second page', url: 'https://second.example/' })
  const page = await launch(a, b)
  await expect(tabs(page)).toHaveCount(2)
  expect(await tabNames(page)).toEqual(['Harbor Times', 'Second page'])
  await expect(activeTab(page)).toContainText('Second page')
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' }).getByRole('option')).toHaveCount(2)
  await expect(frameOf(page, 'Second page').locator('h2')).toHaveText('Item 1')
  // (The page's own script has to have run before the button does anything.)
  await expect(frameOf(page, 'Second page').locator('html')).toHaveAttribute('data-offline', 'ready')
  await frameOf(page, 'Second page').getByRole('button', { name: 'Next' }).click()
  await expect(frameOf(page, 'Second page').locator('h2')).toHaveText('Item 2')
  // Another tab shows another snapshot; the first keeps its own state.
  await tabs(page).first().click()
  await expect(frameOf(page, 'Harbor Times').locator('h2')).toHaveText('Item 1')
  await tabs(page).nth(1).click()
  await expect(frameOf(page, 'Second page').locator('h2')).toHaveText('Item 2')
  // The status bar is about the selected snapshot, and its integrity is checked in the background.
  await expect(page.getByRole('contentinfo')).toContainText('second.example')
  await expect(page.getByRole('contentinfo')).toContainText('Intact')
})

test('the breadcrumbs and the information view say what the snapshot is', async () => {
  const page = await launch(await harbor())
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toHaveText('Harbor Times')
  await page.getByRole('button', { name: 'Information' }).click()
  const info = page.locator('aside dl')
  await expect(info).toContainText('https://harbortimes.example/')
  await expect(info).toContainText('folder-browser fixtures 0.0.0')
  await expect(info).toContainText('1280 × 800')
  await page.getByRole('button', { name: 'Integrity' }).click()
  await expect(page.getByText('All 11 files are intact.')).toBeVisible()
})

test('a single click on a file opens a preview tab, the next click replaces it, a double click keeps it', async () => {
  const page = await launch(await harbor())
  await page.getByRole('treeitem', { name: 'assets', exact: true }).click()
  await page.getByRole('treeitem', { name: 'files', exact: true }).click()
  await page.getByRole('treeitem', { name: 'data.json' }).click()
  await expect(tabs(page)).toHaveCount(2)
  await expect(activeTab(page)).toContainText('data.json')
  await expect(activeTab(page).locator('span.truncate').first()).toHaveClass(/italic/)
  // A one-line JSON is shown laid out (the file itself is not changed).
  await expect(page.locator('.cm-content')).toContainText('"items": [1, 2, 3]')
  await page.getByRole('treeitem', { name: 'bundle.zip' }).click()
  await expect(tabs(page)).toHaveCount(2)
  expect(await tabNames(page)).toEqual(['Harbor Times', 'bundle.zip'])
  await page.getByRole('treeitem', { name: 'data.json' }).dblclick()
  expect(await tabNames(page)).toEqual(['Harbor Times', 'data.json'])
  await expect(activeTab(page).locator('span.truncate').first()).not.toHaveClass(/italic/)
  await page.getByRole('treeitem', { name: 'report.pdf' }).click()
  expect(await tabNames(page)).toEqual(['Harbor Times', 'data.json', 'report.pdf'])
  await expect(activeTab(page)).toContainText('report.pdf')
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toHaveText('Harbor Timesassetsfilesreport.pdf')
})

test('source is coloured, a picture is shown with its size, and the arrows walk the tree', async () => {
  const page = await launch(await harbor())
  const tree = page.getByRole('tree')
  await page.getByRole('treeitem', { name: 'index.html' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-content')).toContainText('<h2 id="item">Item 1</h2>')
  // A tag has the colour of a tag in the theme (a variable, not a fixed colour).
  const tagColour = await page.locator('.cm-content span').filter({ hasText: 'h2' }).first().evaluate((el) => getComputedStyle(el).color)
  expect(tagColour).not.toBe(await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).color))
  await page.getByRole('treeitem', { name: 'assets', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect(tree.getByRole('treeitem', { name: 'files' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(tree.getByRole('treeitem', { name: 'mimetype' })).toBeFocused()
  await page.keyboard.type('mar')
  await page.getByRole('treeitem', { name: 'images', exact: true }).click()
  await page.getByRole('treeitem', { name: 'logo.png' }).dblclick()
  await expect(page.getByRole('img', { name: 'logo.png' })).toBeVisible()
  await expect(page.getByText('1 × 1 pixels')).toBeVisible()
})

test('a file that cannot be shown is offered with Save As, from its tab and from the tree, and saved byte for byte', async () => {
  const page = await launch(await harbor())
  const clip = path.join(dir, 'saved-clip.mp4')
  await stubDialogs(clip)
  await page.getByRole('treeitem', { name: 'assets', exact: true }).click()
  await page.getByRole('treeitem', { name: 'media', exact: true }).click()
  await page.getByRole('treeitem', { name: 'clip.mp4' }).dblclick()
  // (A video is played; this one is not a video the player can decode, and says so, with Save As as the way out.)
  await expect(page.getByRole('alert')).toContainText('does not know its format')
  await page.getByRole('button', { name: 'Save As…' }).click()
  await expect(page.getByRole('status')).toContainText('Saved saved-clip.mp4.')
  expect(fs.readFileSync(clip).equals(Buffer.alloc(2048, 1))).toBe(true)
  await page.getByRole('treeitem', { name: 'files', exact: true }).click()
  // The tree's context menu has it for every file, a PDF (which a tab can show) included.
  const pdf = path.join(dir, 'saved-report.pdf')
  await stubDialogs(pdf)
  await page.getByRole('treeitem', { name: 'report.pdf' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Save As…' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved saved-report.pdf.' })).toBeVisible()
  expect(fs.readFileSync(pdf).equals(RICH_PDF)).toBe(true)
})

test('a click on a link to a ZIP lists it in a tab, and it can be saved from there; to a PDF, a picture or text opens a tab; a #link stays in the page', async () => {
  const page = await launch(await harbor())
  const target = path.join(dir, 'from-link.zip')
  await stubDialogs(target)
  const frame = frameOf(page, 'Harbor Times')
  await frame.locator('#zip').click()
  await expect(tabs(page)).toHaveCount(2)
  await expect(activeTab(page)).toContainText('bundle.zip')
  await expect(page.getByRole('table', { name: /Files in the ZIP/ })).toBeVisible()
  // The file is written before the app says so: wait for that, not for the file to appear.
  await page.getByRole('button', { name: 'Save As…' }).click()
  await expect(page.getByRole('status')).toContainText('Saved from-link.zip.')
  expect(fs.readFileSync(target).equals(RICH_ZIP)).toBe(true)
  await tabs(page).first().click()
  // The ZIP's tab was a preview: the next file replaces it.
  await frame.locator('#pdf').click()
  await expect(tabs(page)).toHaveCount(2)
  await expect(activeTab(page)).toContainText('report.pdf')
  await expect(page.locator('canvas').first()).toBeVisible()
  await tabs(page).first().click()
  await frame.locator('#pic').click()
  await expect(activeTab(page)).toContainText('mark.svg')
  await tabs(page).first().click()
  await frame.locator('#hash').click()
  await expect(frame.locator('#end')).toBeVisible()
  expect(await tabNames(page)).toEqual(['Harbor Times', 'mark.svg'])
  expect(await external()).toEqual([])
})

test('a link to a file with target=_blank or download opens its tab as a plain link does', async () => {
  const page = await launch(await harbor())
  await stubDialogs(path.join(dir, 'unused'))
  const frame = frameOf(page, 'Harbor Times')
  for (const id of ['#zipblank', '#zipdl']) {
    await frame.locator(id).click()
    await expect(tabs(page)).toHaveCount(2)
    await expect(activeTab(page)).toContainText('bundle.zip')
    await tabs(page).first().click()
  }
  expect(await tabNames(page)).toEqual(['Harbor Times', 'bundle.zip'])
  expect(await external()).toEqual([])
})

test('a click on a web link opens the default browser and nothing else; no tab, and the page stays', async () => {
  const page = await launch(await harbor())
  await stubDialogs(path.join(dir, 'unused'))
  await frameOf(page, 'Harbor Times').locator('#ext').click()
  await expect.poll(external).toEqual(['https://example.com/more'])
  await expect(tabs(page)).toHaveCount(1)
  await expect(frameOf(page, 'Harbor Times').locator('h2')).toHaveText('Item 1')
})

test('nothing reaches the network from a snapshot in a tab', async () => {
  const server = await startProbeServer()
  try {
    const file = path.join(dir, 'probe.wsnp')
    await writeWsnp(file, networkProbeFiles(server.origin), { title: 'Probe' })
    const page = await launch(file)
    await expect(frameOf(page, 'Probe').locator('html')).toHaveAttribute('data-probe', 'ran')
    await page.waitForTimeout(1000)
    expect(server.hits).toEqual([])
    // The integrity pass reports what the page tried to bring in from the network.
    await page.getByRole('button', { name: 'Integrity' }).click()
    await expect(page.getByText(/refers to something on the internet/).first()).toBeVisible()
  } finally {
    await server.close()
  }
})

test('files that cannot be opened are refused in plain words, and the newer, the application and the protected ones gently', async () => {
  const files = { bad: path.join(dir, 'Bad.wsnp'), newer: path.join(dir, 'Newer.wsnp'), app: path.join(dir, 'App.wsnp'), locked: path.join(dir, 'Locked.wsnp'), missing: path.join(dir, 'Missing.wsnp') }
  await writeNotAZip(files.bad)
  await writeNewer(files.newer)
  await writeApplication(files.app)
  await writeProtected(files.locked)
  const page = await launch(files.bad, files.newer, files.app, files.locked, await harbor())
  await expect(tabs(page)).toHaveCount(1)
  await expect(page.getByRole('alert')).toContainText('Could not open Bad.wsnp: This is not a WSNP file: it is not a ZIP archive.')
  const notes = page.getByRole('status')
  await expect(notes.filter({ hasText: 'Newer.wsnp can’t be opened' })).toContainText('newer version')
  await expect(notes.filter({ hasText: 'App.wsnp can’t be opened' })).toContainText('application this viewer can’t run yet')
  await expect(notes.filter({ hasText: 'Locked.wsnp can’t be opened' })).toContainText('password-protected')
  await expect(page.getByText(/broken/i)).toHaveCount(0)
})

test('a file that was changed after it was saved is not valid: its page is held back until the user insists', async () => {
  const file = path.join(dir, 'tampered.wsnp')
  await writeTampered(file)
  const page = await launch(file)
  const invalid = page.getByRole('alert').filter({ hasText: 'This snapshot is not valid' })
  await expect(invalid).toBeVisible()
  await expect(invalid).toContainText('assets/styles/site.css')
  await expect(page.getByRole('contentinfo')).toContainText('Invalid')
  await expect(page.locator('iframe[title^="Snapshot:"]')).toBeHidden()
  // The user can see why, close it, or look at the page anyway.
  await page.getByRole('button', { name: 'Integrity' }).click()
  await expect(page.getByRole('button', { name: 'assets/styles/site.css has changed since it was saved.' })).toBeVisible()
  await invalid.getByRole('button', { name: 'Show Anyway' }).click()
  await expect(invalid).toBeHidden()
  await expect(frameOf(page, 'Tampered page').locator('h2')).toHaveText('Item 1')
  await page.getByRole('button', { name: 'assets/styles/site.css has changed since it was saved.' }).click()
  await expect(activeTab(page)).toContainText('site.css')
  await expect(page.locator('.cm-content')).toContainText(/rgb\(0,\s*128,\s*127\)/)
})

test('editing the manifest of a file makes it not valid: a changed hash is caught, a changed size refuses the file', async () => {
  const edited = path.join(dir, 'Edited.wsnp')
  const resized = path.join(dir, 'Resized.wsnp')
  await writeManifestEdited(edited)
  await writeManifestSizeEdited(resized)
  const page = await launch(resized, edited)
  await expect(page.getByRole('alert').filter({ hasText: 'Could not open Resized.wsnp' })).toContainText('index.html is not the size the manifest says.')
  await expect(tabs(page)).toHaveCount(1)
  const invalid = page.getByRole('alert').filter({ hasText: 'This snapshot is not valid' })
  await expect(invalid).toBeVisible()
  await expect(invalid).toContainText('index.html')
  await invalid.getByRole('button', { name: 'Close Snapshot' }).click()
  await expect(tabs(page)).toHaveCount(0)
})

test('the metadata of a snapshot is shown in a tab: what the manifest says, what was checked, and the manifest itself', async () => {
  const page = await launch(await harbor())
  // The View menu is in the window on Windows and Linux only (macOS has a native one), so the test goes through the tab's own menu.
  await tabs(page).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show Metadata' }).click()
  await expect(activeTab(page)).toContainText('Metadata: Harbor Times')
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toHaveText('Harbor TimesMetadata')
  const view = page.getByLabel('Metadata', { exact: true })
  await expect(view).toContainText('folder-browser fixtures 0.0.0')
  await expect(view).toContainText('https://harbortimes.example/')
  await expect(view).toContainText('1280 × 800')
  await expect(view).toContainText('The file follows the format')
  await expect(view).toContainText('All 11 files are intact.')
  await expect(view).toContainText('Not signed.')
  // The tab of the snapshot is the page, and closing the metadata leaves it open.
  await page.getByRole('tab', { name: /Metadata/ }).getByRole('button', { name: 'Close' }).click()
  await expect(tabs(page)).toHaveCount(1)
  // The same from the tab's menu and the Information view; the raw manifest opens as source.
  await tabs(page).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show Metadata' }).click()
  await page.getByRole('button', { name: 'Open manifest.json' }).click()
  await expect(activeTab(page)).toContainText('manifest.json')
  await expect(page.locator('.cm-content')).toContainText('"format": "wsnp"')
})

test('the metadata can be copied as JSON', async () => {
  const page = await launch(await harbor())
  await page.getByRole('button', { name: 'Information' }).click()
  await page.getByRole('button', { name: 'Show all metadata…' }).click()
  await page.getByRole('button', { name: 'Copy as JSON' }).click()
  await expect.poll(() => app!.evaluate(async ({ clipboard }) => (await clipboard.readText()).length)).toBeGreaterThan(100)
  const copied = JSON.parse(await app!.evaluate(({ clipboard }) => clipboard.readText())) as { format: string; title: string; files: unknown[] }
  expect(copied).toMatchObject({ format: 'wsnp', title: 'Harbor Times' })
  expect(copied.files).toHaveLength(11)
})

test('a second launch hands its file to the running app, which shows it in a new tab', async () => {
  const first = await harbor('one.wsnp', 'One')
  const second = await harbor('two.wsnp', 'Two')
  const page = await launch(first)
  await expect(tabs(page)).toHaveCount(1)
  const electronPath = (await import('electron')).default as unknown as string
  const child = spawn(electronPath, ['.', `--user-data-dir=${profile()}`, ...noSandbox, second], { stdio: 'ignore' })
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  await expect(tabs(page)).toHaveCount(2, { timeout: 20_000 })
  await expect(activeTab(page)).toContainText('Two')
  await exited
  // Opening the same file again shows its tab instead of opening it twice.
  const again = spawn(electronPath, ['.', `--user-data-dir=${profile()}`, ...noSandbox, first], { stdio: 'ignore' })
  await new Promise((resolve) => again.on('exit', resolve))
  await expect(activeTab(page)).toContainText('One')
  await expect(tabs(page)).toHaveCount(2)
})

test('closing tabs: Ctrl+W, the × button, the middle click, the context menu; the last one leaves the empty editor', async () => {
  const names = ['a', 'b', 'c', 'd']
  const files: string[] = []
  for (const n of names) files.push(await harbor(`${n}.wsnp`, n.toUpperCase()))
  const page = await launch(...files)
  await expect(tabs(page)).toHaveCount(4)
  await page.keyboard.press('ControlOrMeta+W')
  expect(await tabNames(page)).toEqual(['A', 'B', 'C'])
  await tabs(page).nth(0).click({ button: 'middle' })
  expect(await tabNames(page)).toEqual(['B', 'C'])
  await tabs(page).nth(1).hover()
  await tabs(page).nth(1).getByRole('button', { name: 'Close' }).click()
  expect(await tabNames(page)).toEqual(['B'])
  await expect(page.getByRole('listbox', { name: 'Open Snapshots' }).getByRole('option')).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+W')
  await expect(tabs(page)).toHaveCount(0)
  await expect(page.getByText('Open a folder to start')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('No folder open')
})

test('the tab context menu: pin, close others, close to the right, close all', async () => {
  const files: string[] = []
  for (const n of ['a', 'b', 'c', 'd']) files.push(await harbor(`${n}.wsnp`, n.toUpperCase()))
  const page = await launch(...files)
  await tabs(page).nth(2).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin' }).click()
  expect(await tabNames(page)).toEqual(['C', 'A', 'B', 'D'])
  await tabs(page).nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close to the Right' }).click()
  expect(await tabNames(page)).toEqual(['C', 'A'])
  // A pinned tab stays when the others close, so there is nothing left for "Close Others" to close.
  await tabs(page).nth(1).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Close Others' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await tabs(page).nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close All' }).click()
  expect(await tabNames(page)).toEqual(['C'])
})

test('Ctrl+Tab goes through the tabs in the order they were used, and Alt+1 goes to the first', async () => {
  const files: string[] = []
  for (const n of ['a', 'b', 'c']) files.push(await harbor(`${n}.wsnp`, n.toUpperCase()))
  const page = await launch(...files)
  await tabs(page).nth(0).click()
  await tabs(page).nth(2).click()
  // Used last: C, then A, then B.
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await expect(activeTab(page)).toContainText('A')
  await page.keyboard.up('Control')
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await expect(activeTab(page)).toContainText('C')
  await page.keyboard.up('Control')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+1' : 'Alt+1')
  await expect(activeTab(page)).toContainText('A')
})

test('tabs can be dragged to a new place', async () => {
  const files: string[] = []
  for (const n of ['a', 'b', 'c']) files.push(await harbor(`${n}.wsnp`, n.toUpperCase()))
  const page = await launch(...files)
  // A page keeps its state when its tab moves: moving an iframe in the document would reload it.
  await tabs(page).first().click()
  await frameOf(page, 'A').getByRole('button', { name: 'Next' }).click()
  await expect(frameOf(page, 'A').locator('h2')).toHaveText('Item 2')
  // The drag itself is the browser's; what is tested is what the tab strip does with the events it gets.
  await page.evaluate(() => {
    const strip = [...document.querySelectorAll('[role=tab]')]
    const data = new DataTransfer()
    data.setData('application/x-wsnp-tab', strip[0].getAttribute('data-key') ?? '')
    const box = strip[2].getBoundingClientRect()
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.right - 4, clientY: box.top + 10 }
    strip[2].dispatchEvent(new DragEvent('dragover', at))
    strip[2].dispatchEvent(new DragEvent('drop', at))
  })
  expect(await tabNames(page)).toEqual(['B', 'C', 'A'])
  await page.waitForTimeout(500)
  await expect(frameOf(page, 'A').locator('h2')).toHaveText('Item 2')
})

test('dragging a file over the window says it can be dropped, and the window never navigates to it', async () => {
  const page = await launch()
  const file = await harbor('dropped.wsnp', 'Dropped')
  expect(fs.existsSync(file)).toBe(true)
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File(['x'], 'other.wsnp'))
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, cancelable: true }))
  })
  await expect(page.getByText('Drop .wsnp files to open them')).toBeVisible()
  expect(page.url()).toMatch(/^fb-ui:\/\/host\//)
})

test('Open Recent lists the files opened before, by name, and opens one', async () => {
  test.skip(!htmlMenu, 'macOS has the native menu')
  const file = await harbor('recent-one.wsnp', 'Recent One')
  const page = await launch(file)
  await expect(tabs(page)).toHaveCount(1)
  // (Closed on purpose: what is open at the end comes back at the next start.)
  await page.keyboard.press('ControlOrMeta+w')
  await expect(tabs(page)).toHaveCount(0)
  await app!.close()
  const again = await launch()
  await expect(tabs(again)).toHaveCount(0)
  await again.getByRole('menuitem', { name: 'File' }).click()
  await again.getByRole('menuitem', { name: /Open Recent/ }).click()
  await again.getByRole('menuitem', { name: 'recent-one.wsnp' }).click()
  await expect(activeTab(again)).toContainText('Recent One')
  await again.getByRole('menuitem', { name: 'File' }).click()
  await again.getByRole('menuitem', { name: /Open Recent/ }).click()
  await again.getByRole('menuitem', { name: 'Clear Recently Opened' }).click()
  await again.getByRole('menuitem', { name: 'File' }).click()
  await again.getByRole('menuitem', { name: /Open Recent/ }).click()
  await expect(again.getByRole('menuitem', { name: 'No recent files' })).toBeDisabled()
})

test('the interface offers nothing more to a snapshot than its own files', async () => {
  const page = await launch(await harbor())
  const frame = frameOf(page, 'Harbor Times')
  await expect(frame.locator('html')).toHaveAttribute('data-offline', 'ready')
  // From inside the frame: the interface, its storage and the other files of the profile are out of reach.
  const seen = await frame.locator('html').evaluate(() => ({
    origin: window.origin,
    parent: (() => { try { return parent.document.title } catch (e) { return (e as Error).name } })(),
    ipc: typeof (window as unknown as { fb?: unknown }).fb,
    require: typeof (window as unknown as { require?: unknown }).require,
  }))
  expect(seen).toEqual({ origin: 'null', parent: 'SecurityError', ipc: 'undefined', require: 'undefined' })
  expect(richFiles().length).toBeGreaterThan(5)
  expect(PNG_1X1.length).toBeGreaterThan(50)
})
