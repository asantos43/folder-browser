import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeViewerWsnp } from '../fixtures/build.ts'
import { goToFile } from './helpers.ts'

// End-to-end: a text file of a snapshot in a tab: laid out for reading, word wrap, the colours of the languages it knows.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let app: ElectronApplication | undefined

test.beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-src-'))))
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const file = () => path.join(dir, 'source.wsnp')
async function launch(): Promise<Page> {
  if (!fs.existsSync(file())) await writeViewerWsnp(file(), { title: 'Source' })
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...noSandbox, file()] })
  const page = await app.firstWindow()
  await page.getByRole('tab').first().waitFor()
  return page
}
// (A snapshot has no tree of its files: a file opens by Go to File, as a link in its page would open it.)
async function openFile(page: Page, _folder: string[], name: string) {
  await goToFile(page, name)
}
const content = (page: Page) => page.locator('.cm-content')
// The language of the file is named in the toolbar of the tab and in the status bar: the tab's is the one meant.
const languageName = (page: Page, name: string, exact = true) => page.getByRole('main', { name: 'Editor' }).getByText(name, { exact })
const lineCount = async (page: Page) => Number((await page.getByText(/^\d+ lines$/).textContent())?.split(' ')[0])
const formatButton = (page: Page) => page.getByRole('button', { name: /Show the file laid out/ })
const wrapButton = (page: Page) => page.getByRole('button', { name: /Wrap long lines/ })

test.describe('laid out for reading', () => {
  test('a one-line JSON is shown one member to a line, says so, and can be shown as it was saved', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'min.json')
    await expect(page.getByText('Formatted')).toBeVisible()
    expect(await lineCount(page)).toBeGreaterThan(10)
    await expect(content(page)).toContainText('"name": "harbor",')
    // What the file says is not changed by laying it out: the number too big for a double is as it was.
    await expect(content(page)).toContainText('12345678901234567890')
    await expect(languageName(page, 'JSON')).toBeVisible()
    await formatButton(page).click()
    await expect(page.getByText('As saved')).toBeVisible()
    expect(await lineCount(page)).toBe(1)
    await expect(content(page)).toContainText('{"name":"harbor","big":12345678901234567890')
  })

  test('minified HTML, CSS and JavaScript are laid out too, with their own indentation', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'page.html')
    await expect(page.getByText('Formatted')).toBeVisible()
    expect(await lineCount(page)).toBeGreaterThan(15)
    const lines = await page.locator('.cm-line').allTextContents()
    expect(lines.some((l) => /^ {2}<head>/.test(l))).toBe(true)
    expect(lines.some((l) => /^ {4,}<li>a<\/li>/.test(l))).toBe(true)
    await openFile(page, ['assets', 'styles'], 'min.css')
    await expect(page.getByText('Formatted')).toBeVisible()
    expect((await page.locator('.cm-line').allTextContents()).some((l) => /^ {2}margin: 0;$/.test(l))).toBe(true)
    await openFile(page, ['assets', 'files'], 'min.js')
    await expect(page.getByText('Formatted')).toBeVisible()
    expect((await page.locator('.cm-line').allTextContents()).some((l) => /^ {2}return a \+ b$/.test(l))).toBe(true)
  })

  test('the choice is for every file and is kept: it is off in a file opened later, and after the application is restarted; Settings has it too', async () => {
    let page = await launch()
    await openFile(page, ['assets', 'files'], 'min.json')
    await formatButton(page).click()
    await openFile(page, ['assets', 'files'], 'min.js')
    await expect(page.getByText('As saved')).toBeVisible()
    await app!.close()
    page = await launch()
    await openFile(page, ['assets', 'files'], 'min.json')
    await expect(page.getByText('As saved')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    const box = page.getByRole('checkbox', { name: 'Format source files' })
    await expect(box).not.toBeChecked()
    await box.check()
    await page.getByRole('tab', { name: /min.json/ }).click()
    await expect(page.getByText('Formatted')).toBeVisible()
  })

  test('Save As writes the file as it was saved, not laid out', async () => {
    const page = await launch()
    const target = path.join(dir, 'saved.json')
    await app!.evaluate(({ dialog }, to) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: to })) as unknown as typeof dialog.showSaveDialog
    }, target)
    await openFile(page, ['assets', 'files'], 'min.json')
    await expect(page.getByText('Formatted')).toBeVisible()
    await page.getByRole('toolbar').getByRole('button', { name: 'Save As…' }).click()
    await expect(page.getByRole('status')).toContainText('Saved saved.json.')
    expect(fs.readFileSync(target, 'utf8')).toBe('{"name":"harbor","big":12345678901234567890,"items":[{"id":1,"tags":["a","b"]},{"id":2,"tags":[]}],"nested":{"deep":{"ok":true}}}')
  })
})

test.describe('word wrap', () => {
  test('a long line is wrapped with the button and with Alt+Z, and the choice is kept', async () => {
    let page = await launch()
    await openFile(page, ['assets', 'files'], 'long.txt')
    const firstLine = page.locator('.cm-line').first()
    const tall = () => firstLine.evaluate((el) => el.getBoundingClientRect().height)
    await expect(languageName(page, 'Plain Text')).toBeVisible()
    expect(await tall()).toBeLessThan(30)
    await expect(page.locator('.cm-lineWrapping')).toHaveCount(0)
    await wrapButton(page).click()
    await expect(page.locator('.cm-lineWrapping')).toHaveCount(1)
    await expect.poll(tall).toBeGreaterThan(60)
    await expect(wrapButton(page)).toHaveAttribute('aria-pressed', 'true')
    // The end of the long line is now in view without scrolling sideways.
    const box = await page.locator('.cm-scroller').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1)
    await page.keyboard.press('Alt+z')
    await expect(page.locator('.cm-lineWrapping')).toHaveCount(0)
    await page.keyboard.press('Alt+z')
    await expect(page.locator('.cm-lineWrapping')).toHaveCount(1)
    await app!.close()
    page = await launch()
    await openFile(page, ['assets', 'files'], 'long.txt')
    await expect(page.locator('.cm-lineWrapping')).toHaveCount(1)
    await page.keyboard.press('ControlOrMeta+,')
    const setting = page.getByRole('checkbox', { name: 'Word Wrap' })
    await expect(setting).toBeChecked()
    await setting.uncheck()
    await page.getByRole('tab', { name: /long.txt/ }).click()
    await expect(page.locator('.cm-lineWrapping')).toHaveCount(0)
  })
})

test.describe('the colours of the languages', () => {
  const colours = async (page: Page) => new Set(await page.locator('.cm-line span').evaluateAll((els) => els.map((e) => getComputedStyle(e).color)))

  test('Markdown, YAML, JSON, JavaScript and CSS are coloured, each with its language named; plain text is not', async () => {
    const page = await launch()
    const cases: [string[], string, string][] = [
      [['assets', 'files'], 'notes.md', 'Markdown'],
      [['assets', 'files'], 'config.yml', 'YAML'],
      [['assets', 'files'], 'min.json', 'JSON'],
      [['assets', 'files'], 'min.js', 'JavaScript'],
      [['assets', 'styles'], 'min.css', 'CSS'],
      [['assets', 'files'], 'page.html', 'HTML'],
    ]
    for (const [folder, name, language] of cases) {
      await openFile(page, folder, name)
      // Markdown opens formatted: its colours are those of its source.
      if (language === 'Markdown') await page.getByRole('button', { name: 'Show the Markdown as text' }).click()
      await expect(languageName(page, language)).toBeVisible()
      expect((await colours(page)).size, `${name} has more than one colour`).toBeGreaterThan(1)
    }
    await openFile(page, ['assets', 'files'], 'long.txt')
    await expect(languageName(page, 'Plain Text')).toBeVisible()
    expect((await colours(page)).size).toBe(0)
  })

  test('the colours follow the theme', async () => {
    const page = await launch()
    await openFile(page, ['assets', 'files'], 'min.json')
    const keyColour = () => page.locator('.cm-line span').first().evaluate((e) => getComputedStyle(e).color)
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Dark+' }).click()
    const dark = await keyColour()
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Light+' }).click()
    expect(await keyColour()).not.toBe(dark)
  })
})

test.describe('the title bar and the activity bar', () => {
  test('the empty parts of the title bar drag the window, the menu, the search box and the buttons do not', async () => {
    test.skip(process.platform === 'darwin', 'macOS has the native menu')
    const page = await launch()
    const region = (x: number, y: number) =>
      page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px, py)
        return el ? (getComputedStyle(el) as CSSStyleDeclaration & { webkitAppRegion: string }).webkitAppRegion : 'none'
      }, [x, y])
    const box = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!
    const bar = await box(page.getByTestId('titlebar'))
    const mid = bar.y + bar.height / 2
    const menu = await box(page.getByRole('menuitem').last())
    const search = await box(page.getByTestId('titlebar').locator('button', { has: page.locator('span.truncate') }))
    expect(await region(menu.x + menu.width / 2, mid)).toBe('no-drag')
    expect(await region(search.x + search.width / 2, mid)).toBe('no-drag')
    // Between the menu and the search box, and right of the box, nothing on the bar stops the drag (the bar itself has it).
    expect(await region(menu.x + menu.width + 10, mid)).not.toBe('no-drag')
    expect(await region(search.x + search.width + 20, mid)).not.toBe('no-drag')
    expect(await page.getByTestId('titlebar').evaluate((el) => (getComputedStyle(el) as CSSStyleDeclaration & { webkitAppRegion: string }).webkitAppRegion)).toBe('drag')
  })

  test('the active item of the activity bar has no white line beside it', async () => {
    const page = await launch()
    const bar = page.getByRole('navigation', { name: 'Activity Bar' })
    await expect(bar).toBeVisible()
    const lines = await bar.evaluate((el) =>
      [...el.querySelectorAll('span')].filter((s) => {
        const r = s.getBoundingClientRect()
        return r.width > 0 && r.width <= 3 && r.height > 20
      }).length,
    )
    expect(lines).toBe(0)
  })
})
