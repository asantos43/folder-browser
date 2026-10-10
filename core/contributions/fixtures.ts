import { vi } from 'vitest'
import { createRegistry } from '../commands/registry.ts'
import { builtinCommands, builtinKeyCommands } from '../commands/builtin.ts'
import { createKeyTable } from '../keys/table.ts'
import { SettingsRegistry } from '../settings/registry.ts'
import type { ContributionRegistries } from './apply.ts'
import type { Contribution } from './contract.ts'
import { createMenuRegistry } from './menus.ts'

export function fakePlugin(pluginId = 'invented'): Contribution {
  return { pluginId,
    commands: ['first', 'second', 'third'].map(name => ({ id: `${pluginId}:${name}`, title: name, category: 'tools', when: 'enabled && !busy', palette: true })),
    keys: [{ command: `${pluginId}:first`, key: 'Mod+Alt+J' }, { command: `${pluginId}:second`, key: 'Mod+Alt+K' }],
    settings: [{ id: `${pluginId}:enabled`, type: 'boolean', default: true, category: 'tools', label: 'enabled' }, { id: `${pluginId}:count`, type: 'number', default: 2, min: 1, max: 5, category: 'tools', label: 'count' }],
    menuItems: [{ id: `${pluginId}:second-item`, command: `${pluginId}:second`, point: 'menubar/file', group: 'z', order: 1 }, { id: `${pluginId}:first-item`, command: `${pluginId}:first`, point: 'menubar/file', group: 'a', order: 2, when: 'enabled' }],
  }
}
export function realRegistries(...plugins: Contribution[]): ContributionRegistries {
  const commands = createRegistry()
  builtinCommands.forEach(command => commands.register(command))
  const settings = new SettingsRegistry()
  settings.defineSetting({ id: 'core.enabled', type: 'boolean', default: false, category: 'core', label: null })
  return { commands, keys: createKeyTable(builtinKeyCommands, false), settings, menus: createMenuRegistry(), mac: false,
    handlers: new Map(plugins.flatMap(plugin => (plugin.commands ?? []).map(command => [command.id, vi.fn()] as const))),
  }
}
