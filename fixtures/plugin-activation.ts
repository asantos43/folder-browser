import type { CompiledPlugin } from '../core/plugins/compile.ts'

/** Synthetic, compiler-shaped data: no package files or real executables are read. */
export function activationPlugin(owner = 'sample', label = 'old', counts: { options?: number; commands?: number; themes?: number; locales?: number; localeKeys?: number } = {}): CompiledPlugin {
  const commands = Array.from({ length: counts.commands ?? 2 }, (_, index) => ({
    id: `${owner}:command${index}`, title: label, category: 'plugins', palette: true,
    defaultKeys: index === 0 ? ['Mod+Alt+J'] : [],
    ...(index === 0 ? { menu: { menu: 'menubar/tools' as const, group: 'plugins', order: 0 }, exec: { program: 'fixture-private-program', args: [{ kind: 'file' as const }] } } : {}),
  }))
  const menuItems = commands.length ? [{ id: `${owner}:menu`, command: commands[0].id, point: 'menubar/tools' as const, group: 'plugins', order: 0 }] : []
  const keymaps = commands.length ? [{ command: commands[0].id, key: 'Mod+Alt+K', source: { keymapId: 'scheme', keymapLabel: label } }] : []
  return {
    pluginId: owner,
    configuration: Array.from({ length: counts.options ?? 1 }, (_, index) => ({ id: `${owner}:option${index}`, property: { type: 'string' as const, default: label, label: 'option' } })),
    themes: Array.from({ length: counts.themes ?? 1 }, (_, index) => ({ id: `${owner}:theme${index}`, label, base: 'light' as const, tokens: { 'color-fg': '#fff' } })),
    languages: [{ id: `${owner}:language`, label, extensions: [`.${owner.replaceAll('.', '-')}`], filenames: [], languageId: 'javascript' }],
    locales: Array.from({ length: counts.locales ?? 1 }, (_, index) => ({ language: `fr-x-${owner.replaceAll('.', '-').slice(0, 8)}-l${index}`, label, translations: Object.fromEntries(Array.from({ length: counts.localeKeys ?? 1 }, (_, n) => [`greeting${n}`, label])) })),
    texts: { greeting: { en: label, 'pt-BR': label } }, commands,
    keymaps, keySchemes: [{ id: 'scheme', label }],
    contribution: { pluginId: owner, commands: commands.map(({ id, title, category, palette }) => ({ id, title, category, palette })), keys: commands.flatMap(command => command.defaultKeys.map(key => ({ command: command.id, key }))), menuItems, keymapKeys: keymaps },
    openWith: [{ id: `${owner}:open`, label, extensions: ['.fixture'], program: 'fixture-private-program', args: [{ kind: 'file' }] }], warnings: [],
  }
}
