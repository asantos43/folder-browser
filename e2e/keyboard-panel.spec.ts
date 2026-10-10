import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let app: ElectronApplication | undefined
let dir: string
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-keyboard-e2e-')) })
test.afterEach(async () => { await app?.close().catch(() => {}); app = undefined; fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })

test('records a key, updates menus and palette, executes it, shows conflicts and restores', async () => {
  const profile = path.join(dir, 'profile'), folder = path.join(dir, 'folder'), exported = path.join(dir, 'keys.json')
  fs.mkdirSync(profile); fs.mkdirSync(folder)
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), folder], env: { ...process.env, LANG: 'en_US.UTF-8', XDG_DATA_HOME: path.join(dir, 'data') } })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  // Only native file choosers are bypassed; the keys bridge and persistence are real.
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
  }, exported)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('button', { name: 'Keyboard', exact: true }).click()
  const row = (id: string) => page.locator(`[data-key-command="${id}"]`)
  // A real native key event to the focused window: it goes through `before-input-event` of the main process, as a user's key does.
  const nativeKey = (code: string, withAlt = true) => app!.evaluate(({ BrowserWindow }, [keyCode, modifier, alt]) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const modifiers = [modifier, ...(alt ? ['alt'] : [])] as ('control' | 'meta' | 'alt')[]
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }, [code, process.platform === 'darwin' ? 'meta' : 'control', withAlt] as const)
  // Asks the main process's own key bridge (`before-input-event`) whether it takes Ctrl/Cmd+Alt+J: true when it does (the command is then sent).
  const bridgeTakesKey = () => app!.evaluate(({ BrowserWindow }, mac) => {
    let taken = false
    BrowserWindow.getAllWindows()[0].webContents.emit('before-input-event', { preventDefault: () => { taken = true } }, { type: 'keyDown', key: 'j', control: !mac, meta: mac, alt: true, shift: false })
    return taken
  }, process.platform === 'darwin')
  const tree = page.getByRole('tree', { name: 'Files and folders' })
  const label = process.platform === 'darwin' ? '⌥⌘J' : 'Ctrl+Alt+J'
  await row('toggleSideBar').getByRole('button', { name: 'Record key' }).click()
  await expect(page.getByRole('status')).toContainText('Recording')
  await page.keyboard.press('ControlOrMeta+Alt+J')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Apply' }).click()
  await expect(row('toggleSideBar')).toContainText(label)
  await page.getByRole('button', { name: 'Export…' }).click()
  await expect.poll(() => fs.existsSync(exported)).toBe(true)
  await expect(tree).toBeVisible()
  await row('toggleHidden').getByRole('button', { name: 'Record key' }).click()
  await expect(page.getByRole('status')).toContainText('Recording')
  // While recording, a key that is already assigned reaches the recorder and does not run its command.
  expect(await bridgeTakesKey()).toBe(false)
  await nativeKey('J')
  await expect(page.getByRole('alertdialog')).toContainText('Conflicts with:')
  await expect(page.getByRole('alertdialog')).toContainText('Side Bar')
  await expect(tree).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  // A reserved chord is refused with its reason and recording goes on; Escape then cancels and the native keys come back.
  await row('toggleHidden').getByRole('button', { name: 'Record key' }).click()
  await expect(page.getByRole('status')).toContainText('Recording')
  await nativeKey('V', false)
  await expect(page.getByRole('alert')).toContainText('reserved')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('status')).toHaveText('')
  expect(await page.evaluate(() => window.fb!.keys.get().entries.length)).toBe(2)
  expect(await bridgeTakesKey()).toBe(true); await expect(tree).toBeHidden()
  await nativeKey('J'); await expect(tree).toBeVisible()
  // Inspect the actual menu and palette, then dispatch a real native input event to the focused window.
  if (process.platform === 'darwin') {
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.find(item => item.label === 'View')?.submenu?.items.find(item => /Side Bar/.test(item.label))?.accelerator)).toBe('Cmd+Alt+J')
  } else {
    await page.getByRole('menuitem', { name: 'View', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /Side Bar/ })).toContainText(label)
    await page.keyboard.press('Escape')
  }
  await page.keyboard.press('ControlOrMeta+Shift+P')
  await expect(page.getByRole('option', { name: /Side Bar/ })).toContainText(label)
  await page.keyboard.press('Escape')
  await expect(tree).toBeVisible()
  await page.getByRole('searchbox').focus()
  await nativeKey('J')
  await expect(tree).toBeHidden()
  // Reset gives the built-in key back: the user's key does nothing, the default works again.
  await row('toggleSideBar').getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(row('toggleSideBar')).not.toContainText('Modified')
  await expect(row('toggleSideBar')).toContainText(process.platform === 'darwin' ? '⌘B' : 'Ctrl+B')
  await nativeKey('J'); await expect(tree).toBeHidden()
  await nativeKey('B', false); await expect(tree).toBeVisible()
  await page.getByRole('button', { name: 'Import…' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('toggleSideBar')
  expect(await page.evaluate(() => window.fb!.keys.get().entries)).toEqual([])
  await page.getByRole('alertdialog').getByRole('button', { name: 'Apply' }).click()
  await expect(row('toggleSideBar')).toContainText(label)
  await row('toggleSideBar').getByRole('button', { name: 'Reset', exact: true }).click()
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(profile, 'keybindings.json'), 'utf8'))).toEqual([])
})
