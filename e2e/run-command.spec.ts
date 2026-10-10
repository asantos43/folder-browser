import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeZip } from '../core/archive/writer.ts'
import { goToFile } from './helpers.ts'

let app: ElectronApplication | undefined, dir: string
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-run-e2e-')) })
test.afterEach(async () => { await app?.close().catch(() => {}); app = undefined; fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })

async function edit(page: Page, program: string, args: string[], first = false) {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('Open With commands')
  await page.getByRole('button', { name: first ? 'Add command' : 'Edit command' }).click()
  await page.getByLabel('Command name').fill('Record arguments')
  await page.getByLabel('Program', { exact: true }).fill(program)
  await page.getByLabel('Arguments (one per line)').fill(args.join('\n'))
  await page.getByRole('button', { name: 'Save command' }).click()
  // all() is the bridge's barrier for earlier setting changes; wait for the batch as well.
  await expect.poll(() => page.evaluate(() => window.fb!.settings.all()['files.openWithCommands'])).toMatchObject([{ args }])
}
async function open(page: Page, name: string, inZip = false) {
  if (inZip) {
    const tree = page.getByRole('tree', { name: 'Files and folders' })
    await tree.getByRole('treeitem', { name: 'pack.zip', exact: true }).click()
    await tree.getByRole('treeitem', { name, exact: true }).dblclick()
  } else await goToFile(page, name)
  await page.getByRole('tab', { selected: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open With…', exact: true }).click()
  const chooser = page.getByRole('dialog', { name: 'Open With', exact: true })
  await expect(chooser.getByText('Your commands')).toBeVisible()
  await chooser.getByRole('option', { name: 'Record arguments' }).dblclick()
}

for (const fromPath of [false, true]) test(`real bridge, saved command, native confirmation by hash, readonly ZIP (${fromPath ? 'PATH' : 'absolute'})`, async () => {
  test.skip(fromPath && process.platform === 'win32', 'symlink executable fixture uses POSIX PATH')
  const work = path.join(dir, 'work'); fs.mkdirSync(work)
  const file = path.join(work, '-ação $(x); &.txt'); fs.writeFileSync(file, 'disk')
  await writeZip(path.join(work, 'pack.zip'), [{ name: 'zip entry.txt', data: 'zip' }])
  const output = path.join(dir, 'argv.json'), script = path.join(dir, 'record.cjs')
  fs.writeFileSync(script, 'const fs=require("node:fs");const args=process.argv.slice(3);fs.writeFileSync(process.argv[2],JSON.stringify({args,cwd:process.cwd(),mode:fs.statSync(args[0]).mode&511}))')
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
  if (fromPath) fs.symlinkSync(process.execPath, path.join(bin, 'fb-fake-node'))
  app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), work], env: { ...process.env, LANG: 'en_US.UTF-8', PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` } })
  const page = await app.firstWindow(); await page.getByTestId('titlebar').waitFor()
  // Real native-dialog call, answered by the main-process harness used by other specs.
  await app.evaluate(({ dialog }) => {
    const state = globalThis as typeof globalThis & { runDialogs: string[] }
    state.runDialogs = []
    dialog.showMessageBox = (async (...params: unknown[]) => { const options = params.at(-1) as { detail?: string }; state.runDialogs.push(options.detail ?? ''); return { response: 1, checkboxChecked: true } }) as typeof dialog.showMessageBox
  })
  const count = () => app!.evaluate(() => (globalThis as typeof globalThis & { runDialogs: string[] }).runDialogs.length)
  const read = () => fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) as { args: string[]; mode: number } : undefined
  const program = fromPath ? 'fb-fake-node' : process.execPath
  const literals = ['$(x)', '`x`', '&', ';', '|', 'a b', 'ação', '-rf', '--', '~', '"quoted"']
  await edit(page, program, [script, output, '{file}', ...literals], true)
  await open(page, path.basename(file)); await expect.poll(read).toMatchObject({ args: [file, ...literals] }); expect(await count()).toBe(1)
  fs.rmSync(output); await open(page, path.basename(file)); await expect.poll(read).toMatchObject({ args: [file, ...literals] }); expect(await count()).toBe(1)
  await edit(page, program, [script, output, '{file}', ...literals, 'changed'])
  fs.rmSync(output); await open(page, path.basename(file)); await expect.poll(read).toMatchObject({ args: [file, ...literals, 'changed'] }); expect(await count()).toBe(2)
  fs.rmSync(output); await open(page, 'zip entry.txt', true); await expect.poll(read).toMatchObject({ mode: 0o400 })
  const copy = read()!.args[0]; expect(copy).not.toBe(file); expect(fs.readFileSync(copy, 'utf8')).toBe('zip'); expect(await count()).toBe(2)
})
