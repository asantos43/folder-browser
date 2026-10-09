import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { makePdf } from '../fixtures/pdf.ts'

// End-to-end: the selection of a PDF's text is translucent (issue #63). The text layer of pdf.js is transparent
// over the canvas of the page; an opaque selection paints opaque blocks over the glyphs. The selection must
// let the page show through. Two screenshots of the same area, before and during a mouse-made selection:
// the bytes must differ (the highlight is on the screen), and the computed token of the highlight must have
// alpha < 1 (the canvas is not hidden).
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let work: string
let app: ElectronApplication | undefined

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-e2e-pdfsel-'))
  work = path.join(dir, 'work')
  fs.mkdirSync(work, { recursive: true })
  // Three lines so a single span is wide enough to highlight without crossing glyphs of two lines.
  fs.writeFileSync(path.join(work, 'page.pdf'), makePdf([{ lines: ['Harbor handbook', 'Chapter one: arrival', 'Chapter two: departure'] }]))
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
  ['Dark+', '#264f7866'],
  ['Light+', '#add6ff66'],
] as const
const setTheme = async (page: Page, theme: string) => {
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitemcheckbox', { name: theme }).click()
}

test('the selection of a PDF paints a translucent highlight (the canvas of the page shows through)', async () => {
  const page = await launch(work)
  await item(page, 'page.pdf').dblclick()
  // The text layer is drawn after the canvas: wait for a span before measuring anything.
  await page.getByRole('img', { name: 'Page 1' }).waitFor()
  await page.locator('.textLayer span').first().waitFor()

  for (const [theme, expected] of THEMES) {
    await setTheme(page, theme)

    const box = await page.locator('.textLayer span').first().boundingBox()
    if (!box) throw new Error('no bounding box for the first text-layer span')
    // Only the inside of the span: the margin of the page around it would add colours of its own.
    const padding = -2
    const clip = { x: Math.floor(box.x - padding), y: Math.floor(box.y - padding), width: Math.ceil(box.width + padding * 2), height: Math.ceil(box.height + padding * 2) }

    // The page as it is, with no selection (the one of the previous theme is let go).
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    const before = await page.screenshot({ clip })

    // Select the first span the way the mouse would (a programmatic selection paints the same ::selection).
    await page.evaluate(() => {
      const span = document.querySelector('.textLayer span')
      if (!span) throw new Error('no text-layer span')
      const selection = window.getSelection()
      selection?.removeAllRanges()
      const range = document.createRange()
      range.selectNodeContents(span)
      selection?.addRange(range)
    })
    const during = await page.screenshot({ clip })

    // The highlight is on the screen...
    expect(during.equals(before), `${theme}: the highlight must change the pixels under it`).toBe(false)
    // ...and the page is still readable under it: the glyphs of the canvas keep the area from being one flat
    // colour (an opaque highlight would hide them and leave a solid block, issue #63).
    const colours = await page.evaluate(async (png) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data
      const seen = new Set<number>()
      for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
      return seen.size
    }, during.toString('base64'))
    expect(colours, `${theme}: the glyphs must show through the highlight (more than one colour)`).toBeGreaterThan(2)

    // The token the highlight paints has alpha < 1, in both themes; the canvas of the page is therefore
    // visible under it (an opaque token would hide the canvas and produce opaque blocks, issue #63).
    const highlight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wsnp-pdf-selection').trim())
    expect(highlight.toLowerCase(), `${theme}: --wsnp-pdf-selection`).toBe(expected.toLowerCase())
    expect(parseInt(highlight.slice(7), 16), `${theme}: alpha of ${highlight}`).toBeLessThan(255)
  }
})