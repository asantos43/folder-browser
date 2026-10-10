import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type * as Apply from './apply.ts'
import type * as Menus from './menus.ts'
import type * as Types from './types.ts'
import { fakePlugin, realRegistries } from './fixtures.ts'

/** Execute mutated copies of the real sources against real registries; never leave a
 * broken working tree or spawn another test run. Each assertion is an acceptance
 * condition from the corresponding normal test, expected to fail for its mutant.
 */
async function mutant(file: string, before: string, after: string, check: (path: string) => Promise<void>): Promise<void> {
  const url = new URL(file, import.meta.url), source = readFileSync(url, 'utf8')
  expect(source.includes(before), `mutation anchor in ${file}`).toBe(true)
  const root = fileURLToPath(new URL('../../.cache/', import.meta.url))
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(`${root}s8-mutant-`)
  const path = `${dir}/mutant.ts`
  const changed = source.replace(before, after).replace(/from '(\.\.?\/[^']+)'/g, (_, relative: string) => `from '${fileURLToPath(new URL(relative, url))}'`)
  writeFileSync(path, changed)
  try { await check(path) } finally { rmSync(dir, { recursive: true, force: true }) }
}

it('kills skipping prevalidation before the first live write', async () => {
  await mutant('./apply.ts', 'const contribution = validateContribution(input)', 'const contribution = input as Contribution', async path => {
    const module = await import(/* @vite-ignore */ path) as typeof Apply
    const plugin = fakePlugin(), r = realRegistries(plugin), write = vi.spyOn(r.commands, 'register')
    const invalid = { ...plugin, settings: [...plugin.settings!, { ...plugin.settings![1], id: 'invented:bad', default: 99 }] }
    expect(() => module.applyContribution(r, invalid)).toThrow()
    expect(() => expect(write).not.toHaveBeenCalled()).toThrow()
  })
})

it('kills omitting rollback after a writer mutates then throws', async () => {
  await mutant('./apply.ts', 'for (const rollback of undo.reverse()) rollback()', '// rollback omitted', async path => {
    const module = await import(/* @vite-ignore */ path) as typeof Apply
    const plugin = fakePlugin(), r = realRegistries(plugin), before = JSON.stringify(r.commands.list())
    const add = r.menus.add
    vi.spyOn(r.menus, 'add').mockImplementation(item => { add(item); throw new Error('injected') })
    expect(() => module.applyContribution(r, plugin)).toThrow(/injected/)
    expect(() => expect(JSON.stringify(r.commands.list())).toBe(before)).toThrow()
  })
})

it('kills accepting a command without the plugin prefix', async () => {
  const source = readFileSync(new URL('./types.ts', import.meta.url), 'utf8')
  const line = source.split('\n').find(line => line.includes('if (!id.startsWith'))!
  await mutant('./types.ts', line, '// ownership guard omitted', async path => {
    const module = await import(/* @vite-ignore */ path) as typeof Types
    const plugin = fakePlugin()
    expect(() => expect(() => module.validateContribution({ ...plugin, commands: [{ ...plugin.commands![0], id: 'save' }] })).toThrow()).toThrow()
  })
})

it('kills accepting a reserved chord', async () => {
  await mutant('./apply.ts', 'assertPluginChord(key.key, true); assertPluginChord(key.key, false)', '// reserved guard omitted', async path => {
    const module = await import(/* @vite-ignore */ path) as typeof Apply
    const plugin = fakePlugin(), r = realRegistries(plugin)
    expect(() => expect(() => module.applyContribution(r, { ...plugin, keys: [{ command: 'invented:first', key: 'Mod+S' }] })).toThrow(/Reserved/)).toThrow()
  })
})

it('kills removing only part of the plugin', async () => {
  await mutant('./apply.ts', 'for (const id of handle.settings) registries.settings.remove(id)', '// settings removal omitted', async path => {
    const module = await import(/* @vite-ignore */ path) as typeof Apply
    const plugin = fakePlugin(), r = realRegistries(plugin), before = JSON.stringify(r.settings.all())
    module.applyContribution(r, plugin); module.removeContribution(r, plugin.pluginId)
    expect(() => expect(JSON.stringify(r.settings.all())).toBe(before)).toThrow()
  })
})

it('kills changing the built-in menu without contributions', async () => {
  await mutant('./menus.ts', ': builtin\n', ': [...builtin].reverse()\n', async path => {
    const module = await import(/* @vite-ignore */ path) as typeof Menus
    const builtin = ['open', 'save']
    expect(() => expect(module.contributedMenu(module.createMenuRegistry(), 'menubar/file', builtin, item => item.id)).toEqual(['open', 'save'])).toThrow()
  })
})

it('kills changing contribution menu ordering', async () => {
  const source = readFileSync(new URL('./menus.ts', import.meta.url), 'utf8')
  const line = source.split('\n').find(line => line.includes('.sort('))!
  await mutant('./menus.ts', line, '        .reverse()', async path => {
    const module = await import(/* @vite-ignore */ path) as typeof Menus
    const r = module.createMenuRegistry(), plugin = fakePlugin()
    r.add(plugin.menuItems![1]); r.add(plugin.menuItems![0])
    expect(() => expect(r.at('menubar/file', { enabled: true }).map(item => item.id)).toEqual(['invented:first-item', 'invented:second-item'])).toThrow()
  })
})
