import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildPluginFolder, removePluginFixture } from '../fixtures/plugins.ts'

let app: ElectronApplication | undefined
let dir: string
test.beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-generation-e2e-')) })
test.afterEach(async () => { await app?.close().catch(() => {}); app = undefined; await removePluginFixture(dir) })

test('pulls the whole generation after reload and receives a version after disabling', async () => {
  const source = await buildPluginFolder(path.join(dir, 'source'), {
    files: { 'theme.json': JSON.stringify({ 'vscode-foreground': '#ffffff' }), 'locale.json': JSON.stringify({ 'app.name': 'Fixture' }) },
    manifest: { contributes: {
      themes: [{ id: 'fixture', label: 'Fixture', base: 'light', tokens: 'theme.json' }],
      commands: [{ id: 'acme.sample:hello', title: 'Hello', palette: true, exec: { program: 'fixture-private-program', args: ['{file}'] } }],
      locales: [{ language: 'fr', label: 'Français', file: 'locale.json' }],
    }, activation: ['onStartupFinished'] },
  })
  app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, HOME: dir, XDG_DATA_HOME: path.join(dir, 'data'), XDG_CONFIG_HOME: path.join(dir, 'config'),
      LANG: 'en_US.UTF-8', FB_PLUGIN_TEST: '1', FB_TEST_PLUGIN_CONFIRM: '1' },
  })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  expect(await page.evaluate(source => window.fb!.plugins.installPaths([source]), source)).toMatchObject({ ok: true })
  const before = await page.evaluate(() => window.fb!.plugins.generation())
  expect(before.version).toBeGreaterThan(0)
  expect(before.plugins).toMatchObject([{ owner: 'acme.sample', themes: [{ id: 'acme.sample:fixture' }],
    commands: [{ id: 'acme.sample:hello' }], locales: [{ language: 'fr' }] }])
  await page.reload()
  await page.getByTestId('titlebar').waitFor()
  const reloaded = await page.evaluate(() => window.fb!.plugins.generation())
  expect(reloaded).toEqual(before)
  expect(JSON.stringify(reloaded)).not.toMatch(/"(?:exec|program|args|path)"\s*:/)
  const eventVersion = await page.evaluate(async () => {
    const api = window.fb!.plugins
    const changed = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('Generation event timeout')) }, 5000)
      const off = api.onGeneration(version => { clearTimeout(timer); off(); resolve(version) })
    })
    await api.setEnabled('acme.sample', false)
    return changed
  })
  const disabled = await page.evaluate(() => window.fb!.plugins.generation())
  expect(eventVersion).toBeGreaterThan(before.version)
  expect(disabled.version).toBe(eventVersion)
  expect(disabled.plugins).toMatchObject([{ owner: 'acme.sample', enabled: false, themes: [], commands: [], locales: [] }])
})
