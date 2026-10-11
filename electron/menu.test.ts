import { afterEach, expect, it, vi } from 'vitest'
import { Menu, type MenuItemConstructorOptions } from 'electron'
import { installMenu, nativePluginMenus } from './menu.ts'
import type { GenerationPlugin, GenerationSnapshot } from '../core/plugins/generation.ts'

vi.mock('electron', () => ({ app: { name: 'Folder Browser', getLocale: () => 'en' }, Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(template => template) } }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })
function plugin(owner = 'sample'): GenerationPlugin {
  return { owner, enabled: true, themes: [], locales: [], texts: {}, languages: [], keySchemes: [], keyEntries: [], settings: [],
    commands: [{ id: `${owner}:run`, title: 'Run', category: 'plugins', defaultKeys: ['Mod+Alt+K'], enabled: true }],
    menuItems: [{ id: `${owner}:menu`, command: `${owner}:run`, point: 'menubar/tools', group: 'plugins', order: 0 }],
    resolvedKeys: [{ id: `${owner}:run`, keys: ['mac:Mod+Alt+J', 'nonmac:Mod+Alt+K'] }] }
}
const snapshot = (...plugins: GenerationPlugin[]): GenerationSnapshot => ({ version: 1, plugins })
function template(): MenuItemConstructorOptions[] { return vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)![0] as MenuItemConstructorOptions[] }
function submenu(items: MenuItemConstructorOptions[], name: string): MenuItemConstructorOptions[] {
  return items.find(item => item.label === name || item.role === name)!.submenu as MenuItemConstructorOptions[]
}
function mac(): void { vi.stubGlobal('process', { ...process, platform: 'darwin' }) }
function serial(items: MenuItemConstructorOptions[]): unknown {
  return items.map(({ click: _click, submenu, ...item }) => ({ ...item, ...(Array.isArray(submenu) ? { submenu: serial(submenu) } : {}) }))
}

it('orders active items by group, order and id, excludes context and missing commands', () => {
  const a = plugin(), b = plugin('other'), disabled = { ...plugin('disabled'), enabled: false }
  const item = a.menuItems[0]
  const projected = nativePluginMenus(snapshot({ ...a, menuItems: [
    { ...item, id: 'sample:z', group: 'b' }, { ...item, id: 'sample:c', group: 'a', order: 2 },
    { ...item, id: 'sample:b', group: 'a', order: 1 }, { ...item, id: 'sample:a', group: 'a', order: 1 },
    { ...item, id: 'sample:context', point: 'context/tree' }, { ...item, id: 'sample:missing', command: 'missing' },
  ] }, b, disabled), 'darwin')
  expect(projected.tools.map(item => item.id ?? item.type)).toEqual(['sample:a', 'sample:b', 'sample:c', 'separator', 'sample:z', 'separator', 'other:menu'])
  expect(nativePluginMenus(snapshot(), 'darwin').tools).toEqual([])
})

it('uses only owner titles and resolved platform bindings, disables commands without exec', () => {
  const a = plugin(), b = plugin('other')
  const generation = snapshot({ ...a, texts: { Run: { en: 'Owner run', 'pt-BR': 'Executar' } }, commands: [{ ...a.commands[0], enabled: false }] },
    { ...b, resolvedKeys: [], menuItems: [{ ...b.menuItems[0], order: 1 }] })
  expect(nativePluginMenus(generation, 'darwin', 'pt-BR').tools[0]).toMatchObject({ label: 'Executar', enabled: false, accelerator: 'Cmd+Alt+J' })
  expect(nativePluginMenus(generation, 'linux').tools[0].accelerator).toBe('Ctrl+Alt+K')
  expect(nativePluginMenus(generation, 'darwin').tools[1].label).toBe('Run')
  expect(nativePluginMenus(snapshot({ ...a, resolvedKeys: [] }), 'darwin').tools[0].accelerator).toBeUndefined()
})

it('omits accelerators for reserved keys, conflicts and item/command when without evaluating when', () => {
  const a = plugin(), b = plugin('other')
  expect(nativePluginMenus(snapshot(a, b), 'darwin').tools.every(item => !item.accelerator)).toBe(true)
  expect(nativePluginMenus(snapshot({ ...a, resolvedKeys: [{ id: 'sample:run', keys: ['Mod+C'] }] }), 'darwin').tools[0].accelerator).toBeUndefined()
  expect(nativePluginMenus(snapshot({ ...a, menuItems: [{ ...a.menuItems[0], when: 'editorFocus' }] }), 'darwin').tools[0]).toMatchObject({ command: 'sample:run', enabled: true })
  expect(nativePluginMenus(snapshot({ ...a, menuItems: [{ ...a.menuItems[0], when: 'editorFocus' }] }), 'darwin').tools[0].accelerator).toBeUndefined()
  expect(nativePluginMenus(snapshot({ ...a, commands: [{ ...a.commands[0], when: 'editorFocus' }] }), 'darwin').tools[0].accelerator).toBeUndefined()
})

it('keeps the core template intact, adds Tools only with items, and removes it on replacement', () => {
  mac(); const send = vi.fn()
  installMenu(send); const core = serial(template())
  expect(template().map(item => item.label ?? item.role)).toEqual(['Folder Browser', 'File', 'Edit', 'View', 'Go', 'windowMenu', 'help'])
  expect(submenu(template(), 'Edit').slice(0, 4).map(item => item.role)).toEqual(['cut', 'copy', 'paste', 'selectAll'])
  installMenu(send, snapshot()); expect(serial(template())).toEqual(core)
  const a = plugin()
  installMenu(send, snapshot(a)); expect(submenu(template(), 'Tools')).toHaveLength(1)
  const tools = template().filter(item => item.label !== 'Tools'); expect(serial(tools)).toEqual(core)
  installMenu(send, snapshot()); expect(serial(template())).toEqual(core)
  installMenu(send, snapshot({ ...a, enabled: false })); expect(serial(template())).toEqual(core)
})

it('appends to each supported core menu and clicks send the exact command id', () => {
  mac(); const send = vi.fn(), a = plugin()
  const menus = ['file', 'edit', 'view', 'go', 'help'] as const
  installMenu(send, snapshot({ ...a, menuItems: menus.map(menu => ({ ...a.menuItems[0], id: `sample:${menu}`, point: `menubar/${menu}` })) }))
  for (const menu of menus) {
    const entries = submenu(template(), menu === 'help' ? 'help' : menu[0].toUpperCase() + menu.slice(1))
    expect(entries.at(-2)?.type).toBe('separator')
    const entry = entries.at(-1)!
    entry.click!({} as never, {} as never, {} as never)
  }
  expect(send.mock.calls).toEqual(menus.map(() => ['sample:run']))
  submenu(template(), 'File')[0].click!({} as never, {} as never, {} as never)
  expect(send).toHaveBeenLastCalledWith('newFile')
})

it('leaves the native menu absent on non-macOS platforms', () => {
  vi.stubGlobal('process', { ...process, platform: 'linux' })
  installMenu(vi.fn(), snapshot(plugin()))
  expect(Menu.setApplicationMenu).toHaveBeenCalledWith(null)
  expect(Menu.buildFromTemplate).not.toHaveBeenCalled()
})

it('rebuilds 500 items under 10 ms (median of five)', () => {
  mac(); const a = plugin(), generation = snapshot({ ...a,
    menuItems: Array.from({ length: 500 }, (_, i) => ({ ...a.menuItems[0], id: `sample:item${i}`, order: 500 - i })) })
  installMenu(vi.fn(), generation)
  const times: number[] = []
  for (let i = 0; i < 5; i++) { const start = performance.now(); installMenu(vi.fn(), generation); times.push(performance.now() - start) }
  const median = times.sort((a, b) => a - b)[2]
  console.info(`native menu rebuild/500 median: ${median.toFixed(3)} ms`)
  expect(submenu(template(), 'Tools')).toHaveLength(500)
  expect(median).toBeLessThan(10)
})
