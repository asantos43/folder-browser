// Pictures of the real application for the README and the user guide, made from synthetic files (never from a real capture):
//   npm run build && node scripts/screenshots.ts            → docs/images/*.png
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import { viewerFiles, writeWsnp } from '../fixtures/build.ts'

const out = path.resolve(import.meta.dirname, '../docs/images')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-shots-'))
fs.mkdirSync(out, { recursive: true })

// A page that looks like a page, with a carousel that works: the snapshot being photographed.
const file = path.join(work, 'harbor.wsnp')
// Without the files that exist to test the formatter (a script written into a page is, rightly, reported by the integrity check).
await writeWsnp(file, viewerFiles().filter((f) => f.path !== 'assets/files/page.html'), { title: 'Harbor Times — Local news', url: 'https://harbortimes.example/', viewport: { width: 1280, height: 800, device_pixel_ratio: 1 } })

const app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(work, 'profile')}`, '--lang=en-US', file] })
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
const page = await app.firstWindow()
await page.getByRole('tab').first().waitFor()
await page.getByRole('contentinfo').getByRole('button', { name: /Intact/ }).waitFor()

const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) })
const theme = async (name: 'Dark+' | 'Light+') => {
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitemcheckbox', { name }).click()
  await page.waitForTimeout(300)
}
const open = async (folder: string[], name: string, dbl = true) => {
  for (const f of folder) {
    const item = page.getByRole('treeitem', { name: f, exact: true })
    if ((await item.getAttribute('aria-expanded')) === 'false') await item.click()
  }
  const item = page.getByRole('treeitem', { name, exact: true })
  await (dbl ? item.dblclick() : item.click())
  await page.waitForTimeout(700)
}

await theme('Dark+')
await shot('workbench-dark')
await page.getByRole('menuitem', { name: 'File', exact: true }).click()
await page.getByRole('menuitem', { name: /Open Recent/ }).hover()
await page.waitForTimeout(300)
await shot('file-menu')
await page.keyboard.press('Escape')
await page.getByRole('menuitem', { name: 'File', exact: true }).click().catch(() => undefined)
await page.mouse.click(700, 400)
await theme('Light+')
await shot('workbench-light')

await open(['assets', 'files'], 'handbook.pdf')
await page.locator('[data-page="1"] canvas').waitFor()
await page.waitForTimeout(600)
await shot('pdf-viewer')

await open(['assets', 'images'], 'photo.png')
await shot('image-viewer')

await open([], 'manifest.json')
await shot('source-viewer')

await open(['assets', 'files'], 'bundle.zip')
await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'docs/readme.txt', exact: true }) }).click()
await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'img/dot.png', exact: true }) }).click({ modifiers: ['ControlOrMeta'] })
await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'img/dot.png', exact: true }) }).click({ button: 'right' })
await page.waitForTimeout(300)
await shot('zip-viewer')
await page.keyboard.press('Escape')

await page.getByTestId('titlebar').locator('button', { has: page.locator('span.truncate') }).click()
await page.getByRole('combobox', { name: 'Go to File' }).fill('hand')
await page.waitForTimeout(400)
await shot('quick-open')
await page.keyboard.press('Escape')

await page.keyboard.press('ControlOrMeta+f')
await page.getByRole('textbox', { name: 'Find' }).fill('txt')
await page.waitForTimeout(400)
await shot('find')
await page.keyboard.press('Escape')

await page.getByRole('menuitem', { name: 'View' }).click()
await page.getByRole('menuitem', { name: 'Show Metadata' }).click()
await page.waitForTimeout(400)
await shot('metadata')

await app.close()
fs.rmSync(work, { recursive: true, force: true })
console.log(`pictures in ${out}`)
