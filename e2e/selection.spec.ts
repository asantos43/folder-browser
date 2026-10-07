import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// End-to-end: the colour of the text that is selected, in every place that shows text with CodeMirror (the editor, the read-only view, the two layouts of the diff), in both themes.
// CodeMirror has colours of its own for a selection (a pale lilac for an editor with the focus) that must not win over the theme's.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-selection-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'a.txt'), 'first line\nsecond line\nthird line\n')
  fs.writeFileSync(path.join(work, 'b.txt'), 'first line\n2nd line\nthird line\nfourth\n')
  // Not UTF-8: it is shown, not edited, in the read-only view.
  fs.writeFileSync(path.join(work, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x6d, 0x6f, 0x72, 0x65, 0x0a]))
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
const THEMES = [
  ['Dark+', 'rgb(38, 79, 120)'],
  ['Light+', 'rgb(173, 214, 255)'],
] as const
const setTheme = async (page: Page, theme: string) => {
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitemcheckbox', { name: theme }).click()
}

/** The colour behind the selected text of the first line in `scope`: the layer CodeMirror draws (an editor), or the browser's own `::selection` (a view that is read-only). */
const selected = (page: Page, scope: string) =>
  page.evaluate((root) => {
    const layer = document.querySelector(`${root} .cm-selectionBackground`)
    if (layer) return { how: 'drawn', colour: getComputedStyle(layer).backgroundColor }
    const line = document.querySelector(`${root} .cm-line`)
    return { how: 'native', colour: line ? getComputedStyle(line, '::selection').backgroundColor : null }
  }, scope)

test('the selection of the editor, with the focus and without it', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').dblclick()
  for (const [theme, wanted] of THEMES) {
    await setTheme(page, theme)
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await expect(page.locator('.cm-selectionBackground').first()).toBeVisible()
    expect((await selected(page, '.cm-editor')).colour, `${theme}, focused`).toBe(wanted)
    await item(page, 'b.txt').focus()
    expect((await selected(page, '.cm-editor')).colour, `${theme}, not focused`).toBe(wanted)
  }
})

test('the selection of the read-only view (a file that is shown, not edited)', async () => {
  const page = await launch(work)
  await item(page, 'latin.txt').dblclick()
  await expect(page.getByText('Shown, not edited: the file is not UTF-8.')).toBeVisible()
  for (const [theme, wanted] of THEMES) {
    await setTheme(page, theme)
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    const got = await selected(page, '.cm-editor')
    expect(got.colour, `${theme}, ${got.how}`).toBe(wanted)
  }
})

test('the selection in the diff, side by side and inline', async () => {
  const page = await launch(work)
  await item(page, 'a.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Select for Compare' }).click()
  await item(page, 'b.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compare with Selected' }).click()
  await expect(page.getByRole('group', { name: /^Comparison of / })).toBeVisible()
  for (const [layout, button] of [['Side by Side', /next to each other/], ['Inline', /in one column/]] as const) {
    await page.getByRole('button', { name: button }).click()
    for (const [theme, wanted] of THEMES) {
      await setTheme(page, theme)
      await page.getByRole('group', { name: /^Comparison of / }).locator('.cm-content').last().click()
      await page.keyboard.press('ControlOrMeta+a')
      const got = await selected(page, '.fb-diff')
      expect(got.colour, `${layer(layout)} ${theme} ${got.how}`).toBe(wanted)
    }
  }
})
const layer = (layout: string) => layout.toLowerCase()

test('the selection of the formatted Markdown and of the user guide', async () => {
  fs.writeFileSync(path.join(work, 'README.md'), '# Title\n\nSome **formatted** text.\n')
  const page = await launch(work)
  await item(page, 'README.md').dblclick()
  await page.locator('.markdown-body').first().waitFor()
  await page.keyboard.press('F1')
  await page.getByRole('article', { name: 'User Guide' }).waitFor()
  for (const [theme, wanted] of THEMES) {
    await setTheme(page, theme)
    for (const [where, scope] of [['the guide', 'article[aria-label="User Guide"]']] as const) {
      await page.locator(`${scope} p`).first().click()
      await page.keyboard.press('ControlOrMeta+a')
      const colour = await page.evaluate((root) => getComputedStyle(document.querySelector(`${root} p`)!, '::selection').backgroundColor, scope)
      expect(colour, `${theme}, ${where}`).toBe(wanted)
    }
    await page.getByRole('tab', { name: /README\.md/ }).click()
    await page.locator('.markdown-body p').first().click()
    await page.keyboard.press('ControlOrMeta+a')
    const colour = await page.evaluate(() => getComputedStyle(document.querySelector('.markdown-body p')!, '::selection').backgroundColor)
    expect(colour, `${theme}, the formatted Markdown`).toBe(wanted)
    await page.getByRole('tab', { name: /User Guide/ }).click()
  }
})
