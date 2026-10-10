import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { writeRichWsnp } from '../fixtures/build.ts'

let app: ElectronApplication | undefined
let dir: string
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-user-keys-e2e-')) })
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('user keys cross the real snapshot frame bridge, remove defaults and reload on disk', async () => {
  const profile = path.join(dir, 'profile'), folder = path.join(dir, 'folder')
  fs.mkdirSync(profile); fs.mkdirSync(folder)
  const snapshot = path.join(folder, 'meadow.wsnp')
  await writeRichWsnp(snapshot, { title: 'Meadow Times', url: 'https://meadowtimes.example/' })
  const file = path.join(profile, 'keybindings.json')
  const entries = [{ key: 'Mod+B', command: '-toggleSideBar' }, { key: 'Mod+Alt+J', command: 'toggleSideBar' }]
  fs.writeFileSync(file, JSON.stringify(entries))
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), folder, snapshot], env: { ...process.env, LANG: 'en_US.UTF-8', XDG_DATA_HOME: path.join(dir, 'data') } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  const frame = page.frameLocator('iframe[title="Snapshot: meadow.wsnp"]')
  const focusSnapshot = async () => {
    await frame.locator('body').click({ position: { x: 20, y: 20 } })
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME')
  }
  // Playwright's keyboard goes through DevTools straight to the page and skips the main process, so a real keystroke is sent
  // to the window's web contents instead: it passes `before-input-event` first, as a person's key does, whoever has the focus.
  const mod = process.platform === 'darwin' ? 'meta' as const : 'control' as const
  const press = (key: string, modifiers: Array<'control' | 'meta' | 'alt'>) => app!.evaluate(({ BrowserWindow }, arg) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.sendInputEvent({ type: 'keyDown', keyCode: arg.key, modifiers: arg.modifiers })
    contents.sendInputEvent({ type: 'keyUp', keyCode: arg.key, modifiers: arg.modifiers })
  }, { key, modifiers })
  const tree = page.getByRole('tree', { name: 'Files and folders' })
  await expect(tree).toBeVisible()
  await focusSnapshot()
  await press('B', [mod])
  await expect(tree).toBeVisible()
  await press('J', [mod, 'alt'])
  await expect(tree).toBeHidden()
  await focusSnapshot()
  await press('J', [mod, 'alt'])
  await expect(tree).toBeVisible()
  // An actual disk replacement, rather than an IPC stub, drives the watcher and preload cache.
  fs.writeFileSync(`${file}.tmp`, JSON.stringify([entries[0], { key: 'Mod+Alt+L', command: 'toggleSideBar' }]))
  fs.renameSync(`${file}.tmp`, file)
  await expect.poll(() => page.evaluate(() => window.fb!.keys.get().entries.map(entry => entry.key))).toEqual(['Mod+B', 'Mod+Alt+L'])
  await focusSnapshot()
  await press('J', [mod, 'alt'])
  await expect(tree).toBeVisible()
  await press('L', [mod, 'alt'])
  await expect(tree).toBeHidden()
})
