import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: the real app with its interface. Each launch has a profile folder of its own, so nothing
// touches the developer's settings and the second launch of a test can prove that a setting is remembered.
// On macOS the menu is the native one (outside the window), so the HTML menu bar is not there to be tested.
const htmlMenu = process.platform !== 'darwin'
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let profile: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-'))
})
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function launch(...extra: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`, ...noSandbox, ...extra] })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}

const background = (page: Page, selector: string) => page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor)

test('the window is the workbench: title bar, menu, activity bar, side bar, editor, status bar', async () => {
  const page = await launch('--force-dark-mode')
  await expect(page).toHaveTitle('Folder Browser')
  if (htmlMenu) await expect(page.getByRole('menubar').getByRole('menuitem')).toHaveText(['File', 'Edit', 'View', 'Go', 'Help'])
  await expect(page.getByRole('navigation', { name: 'Activity Bar' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Explorer' })).toBeVisible()
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('No folder open')
  const bar = await page.getByTestId('titlebar').boundingBox()
  expect(bar?.height).toBe(30)
  expect(await page.getByRole('contentinfo').boundingBox().then((b) => b?.height)).toBe(22)
  expect(await page.getByRole('navigation', { name: 'Activity Bar' }).boundingBox().then((b) => b?.width)).toBe(48)
})

test('Ctrl+B (and the View menu) hide and show the side bar', async () => {
  const page = await launch()
  const side = page.getByRole('complementary', { name: 'Explorer' })
  await page.keyboard.press('ControlOrMeta+B')
  await expect(side).toBeHidden()
  if (htmlMenu) {
    await page.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitem', { name: /Toggle Side Bar/ }).click()
  } else {
    await page.keyboard.press('ControlOrMeta+B')
  }
  await expect(side).toBeVisible()
})

test('the theme can be chosen, changes the colours, and is remembered', async () => {
  let page = await launch()
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Light+' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await background(page, 'main')).toBe('rgb(255, 255, 255)')
  expect(await background(page, 'aside')).toBe('rgb(243, 243, 243)')
  expect(await background(page, 'footer')).toBe('rgb(0, 122, 204)')
  await app?.close()
  page = await launch()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Dark+' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // (Black behind the editors and the Explorer in Dark+.)
  expect(await background(page, 'main')).toBe('rgb(0, 0, 0)')
  expect(await background(page, 'aside')).toBe('rgb(0, 0, 0)')
  expect(await background(page, '[data-testid=titlebar]')).toBe('rgb(60, 60, 60)')
})

test('the interface follows the system language: Brazilian Portuguese', async () => {
  const page = await launch('--lang=pt-BR')
  if (htmlMenu) await expect(page.getByRole('menubar').getByRole('menuitem')).toHaveText(['Arquivo', 'Editar', 'Exibir', 'Ir', 'Ajuda'])
  await expect(page.getByRole('contentinfo')).toContainText('Nenhuma pasta aberta')
  await expect(page.getByRole('button', { name: 'Gerenciar' })).toBeVisible()
})

test('the interface reaches nothing outside itself', async () => {
  const page = await launch()
  const attempts = await page.evaluate(async () => {
    const tries = ['https://example.com/', 'http://127.0.0.1:9/', 'wsnp://unknown/index.html']
    return Promise.all(tries.map((url) => fetch(url).then((r) => `reached ${r.status}`, () => 'refused')))
  })
  expect(attempts).toEqual(['refused', 'refused', 'refused'])
  // The window has no Node and offers only what the preload exposes.
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined')
  expect(await page.evaluate(() => Object.keys((window as unknown as { fb: object }).fb).sort())).toEqual(['appInfo', 'clearFindInPage', 'close', 'copyFromPage', 'copyText', 'docs', 'drafts', 'edit', 'findInPage', 'fs', 'leave', 'listDir', 'listFiles', 'media', 'onCloseRequested', 'onCommand', 'onIntegrity', 'onOpenFile', 'onOpened', 'onPageContext', 'onSaved', 'openDefault', 'openDialog', 'openExternal', 'openFolderDialog', 'openInRoot', 'openPaths', 'openWith', 'openWithApp', 'openWithCancel', 'openZipDialog', 'pathForFile', 'places', 'platform', 'print', 'readFile', 'readRange', 'ready', 'recent', 'reveal', 'saveConverted', 'saveFileAs', 'savePdf', 'selectAllInPage', 'session', 'setTitleBar', 'setUnsaved', 'signers', 'trash', 'verify', 'zipExtract', 'zipList'])
})

test('Settings opens in a tab (Ctrl+, or the gear), changes the language at once and remembers it', async () => {
  let page = await launch('--lang=en-US')
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page.getByRole('tab', { name: /Settings/ })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toHaveText('Settings')
  await page.getByRole('combobox', { name: 'Display Language' }).selectOption('pt-BR')
  await expect(page.getByRole('tab', { name: /Configurações/ })).toBeVisible()
  if (htmlMenu) await expect(page.getByRole('menubar').getByRole('menuitem')).toHaveText(['Arquivo', 'Editar', 'Exibir', 'Ir', 'Ajuda'])
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
  await app?.close()
  page = await launch('--lang=en-US')
  if (htmlMenu) await expect(page.getByRole('menubar').getByRole('menuitem')).toHaveText(['Arquivo', 'Editar', 'Exibir', 'Ir', 'Ajuda'])
  await page.getByRole('button', { name: 'Gerenciar' }).click()
  await page.getByRole('menuitem', { name: /Configurações/ }).click()
  await page.getByRole('combobox', { name: 'Idioma de Exibição' }).selectOption('auto')
  await expect(page.getByRole('contentinfo')).toContainText('English')
})

test('nothing zooms the whole interface: its keys and wheel leave it as it is, and a zoom kept by an earlier version is cleared at start', async () => {
  let page = await launch()
  const ratio = () => page.evaluate(() => window.devicePixelRatio)
  const start = await ratio()
  await page.keyboard.press('ControlOrMeta+=')
  await page.keyboard.press('ControlOrMeta+=')
  await page.keyboard.press('ControlOrMeta+-')
  await page.waitForTimeout(300)
  expect(await ratio()).toBeCloseTo(start, 2)
  if (htmlMenu) {
    await page.getByRole('menuitem', { name: 'View', exact: true }).click()
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /Zoom/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
  }
  // A zoom level the profile kept from the versions that zoomed the interface is put back to 100 % when the window loads.
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomLevel(3))
  await expect.poll(ratio).toBeGreaterThan(start * 1.5)
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload())
  // (The page is being replaced while it is asked: an answer that fails because of that is asked again.)
  await expect.poll(() => ratio().catch(() => -1)).toBeCloseTo(start, 2)
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page.getByRole('heading', { name: 'Zoom Level' })).toHaveCount(0)
})

test('the settings can be searched', async () => {
  const page = await launch()
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('language')
  await expect(page.getByRole('heading', { name: 'Display Language' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Color Theme' })).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('no such setting')
  await expect(page.getByText('No setting matches “no such setting”.')).toBeVisible()
})

test('Help > About shows the version, the licence and the notices of the libraries, and closes with Escape', async () => {
  test.skip(!htmlMenu, 'macOS has the native menu')
  const page = await launch()
  await page.getByRole('menuitem', { name: 'Help' }).click()
  await page.getByRole('menuitem', { name: 'About Folder Browser' }).click()
  const dialog = page.getByRole('dialog', { name: 'About Folder Browser' })
  await expect(dialog).toBeVisible()
  const { version } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
  await expect(dialog).toContainText(`Version ${version}`)
  await expect(dialog).toContainText('Mozilla Public License 2.0')
  await expect(dialog).toContainText('Electron')
  await dialog.getByRole('button', { name: /Show the notices/ }).click()
  const notices = dialog.getByLabel('Third-party notices')
  await expect(notices).toContainText('# Third-party notices')
  await expect(notices).toContainText('pdfjs-dist')
  await expect(notices).toContainText('Apache License')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})


test('Help > User Guide (and F1) opens the guide, in the language of the interface, with its pictures, from inside the application', async () => {
  const page = await launch()
  await page.getByRole('menuitem', { name: 'Help' }).click()
  await page.getByRole('menuitem', { name: /^User Guide/ }).click()
  await expect(page.getByRole('tab', { name: /^User Guide/ })).toBeVisible()
  const guide = page.getByRole('article', { name: 'User Guide' })
  await expect(guide.getByRole('heading', { name: 'User guide', level: 1 })).toBeVisible()
  // A picture of the guide is loaded (it is in the build: no network).
  const picture = guide.getByRole('img').first()
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  // A link inside the guide scrolls to its heading.
  await guide.getByRole('link', { name: 'Two editor groups' }).first().click()
  await expect(guide.getByRole('heading', { name: 'Two editor groups' })).toBeInViewport()
  // F1 asks for it again: still one tab.
  await page.keyboard.press('F1')
  await expect(page.getByRole('tab', { name: /^User Guide/ })).toHaveCount(1)
})

test('the guide is in Portuguese when the interface is', async () => {
  const page = await launch('--lang=pt-BR')
  await page.keyboard.press('F1')
  await expect(page.getByRole('tab', { name: /^Guia do Usuário/ })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Guia do Usuário' }).getByRole('heading', { name: 'Guia do usuário', level: 1 })).toBeVisible()
})
