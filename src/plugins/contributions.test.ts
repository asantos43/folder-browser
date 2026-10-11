// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginGeneration } from '@core/plugins/summary.ts'
import type { MenuPoint } from '@core/contributions/contract.ts'
import { applyContributions, getContributionsVersion, getSnapshot, resetContributions, subscribe } from './contributions.ts'

function pluginShape(over: {
  owner: string
  enabled?: boolean
  commands?: ReturnType<typeof command>[]
  menuItems?: ReturnType<typeof menuItem>[]
}): PluginGeneration['plugins'][number] {
  return {
    owner: over.owner,
    enabled: over.enabled ?? true,
    themes: [], locales: [], texts: {}, languages: [], settings: [],
    keySchemes: [], keyEntries: [],
    commands: over.commands ?? [],
    menuItems: over.menuItems ?? [],
  }
}

function emptyGeneration(): PluginGeneration {
  return { version: 0, plugins: [] }
}

function command(over: Partial<{ id: string; owner: string; title: string; category: string; enabled: boolean; disabledReason?: string; when?: string; palette?: boolean; defaultKeys?: readonly string[] }> = {}) {
  return {
    id: over.id ?? 'acme:copy',
    owner: over.owner ?? 'acme',
    title: over.title ?? 'acme.copy',
    category: over.category ?? 'acme',
    enabled: over.enabled ?? true,
    ...(over.disabledReason !== undefined ? { disabledReason: over.disabledReason } : {}),
    ...(over.when !== undefined ? { when: over.when } : {}),
    palette: over.palette !== false,
    defaultKeys: over.defaultKeys ?? [],
  }
}

function menuItem(over: Partial<{ id: string; command: string; owner: string; point: MenuPoint; group: string; order: number; when?: string }> = {}) {
  return {
    id: over.id ?? 'acme.tools.copy',
    command: over.command ?? 'acme:copy',
    owner: over.owner ?? 'acme',
    point: over.point ?? 'menubar/tools' as MenuPoint,
    group: over.group ?? 'commands',
    order: over.order ?? 0,
    ...(over.when !== undefined ? { when: over.when } : {}),
  }
}

function generation(version: number, plugins: ReturnType<typeof command>[][], items: ReturnType<typeof menuItem>[][]): PluginGeneration {
  return {
    version,
    plugins: plugins.map((commands, i) => ({
      owner: commands[0]?.owner ?? items[i]?.[0]?.owner ?? `p${i}`,
      enabled: true,
      themes: [], locales: [], texts: {}, languages: [], settings: [],
      keySchemes: [], keyEntries: [],
      commands,
      menuItems: items[i] ?? [],
    })),
  }
}

afterEach(() => resetContributions())

describe('contributions store', () => {
  it('qualifies schemes, excludes disabled owners and keeps order stable across generations', () => {
    const a = { ...pluginShape({ owner: 'a' }), keySchemes: [{ id: 'z', label: 'Z' }, { id: 'a', label: 'A' }] }
    const b = { ...pluginShape({ owner: 'b' }), keySchemes: [{ id: 'a', label: 'B' }] }
    const disabled = { ...pluginShape({ owner: 'off', enabled: false }), keySchemes: [{ id: 'a', label: 'Hidden' }] }
    applyContributions({ version: 1, plugins: [b, disabled, a] })
    const first = getSnapshot()
    expect([...first.keySchemes.keys()]).toEqual(['a/a', 'a/z', 'b/a'])
    expect(first.keySchemes.get('a/a')).toEqual({ id: 'a/a', owner: 'a', label: 'A' })
    applyContributions({ version: 2, plugins: [a, b] })
    expect([...getSnapshot().keySchemes]).toEqual([...first.keySchemes])
    applyContributions({ version: 3, plugins: [{ ...b, keySchemes: [{ id: 'new', label: 'New' }] }] })
    expect([...getSnapshot().keySchemes.keys()]).toEqual(['b/new'])
    expect(first.keySchemes.size).toBe(3)
    resetContributions()
    expect(getSnapshot().keySchemes.size).toBe(0)
  })
  it('starts empty', () => {
    expect(getSnapshot().commands.size).toBe(0)
    expect(getSnapshot().menuItems.size).toBe(0)
    expect(getSnapshot().hasToolsItems).toBe(false)
    expect(getContributionsVersion()).toBe(0)
  })

  it('applies a generation: one notification per apply, new maps each time', () => {
    const listener = vi.fn()
    subscribe(listener)
    listener.mockClear()
    applyContributions(generation(1, [[command()]], []))
    expect(listener).toHaveBeenCalledTimes(1)
    const first = getSnapshot()
    expect(first.version).toBe(1)
    expect(first.commands.size).toBe(1)
    expect(first.commands.get('acme:copy')?.owner).toBe('acme')
    expect(first.hasToolsItems).toBe(false)

    applyContributions(generation(2, [[command({ id: 'acme:paste', title: 'acme.paste' })]], []))
    expect(listener).toHaveBeenCalledTimes(2)
    const second = getSnapshot()
    expect(second.version).toBe(2)
    expect(second.commands.size).toBe(1)
    expect(second.commands.get('acme:paste')?.owner).toBe('acme')
    expect(first.commands.get('acme:paste')).toBeUndefined()
  })

  it('drops commands and menu items for a disabled owner', () => {
    applyContributions({
      version: 1,
      plugins: [
        pluginShape({ owner: 'a', enabled: false, commands: [command({ id: 'a:copy', owner: 'a' })] }),
        pluginShape({ owner: 'b', commands: [command({ id: 'b:paste', owner: 'b' })] }),
      ],
    })
    expect(getSnapshot().commands.has('a:copy')).toBe(false)
    expect(getSnapshot().commands.has('b:paste')).toBe(true)
  })

  it('reflects hasToolsItems only when menubar/tools is contributed', () => {
    applyContributions({
      version: 1,
      plugins: [pluginShape({ owner: 'a', menuItems: [menuItem({ point: 'menubar/file' })] })],
    })
    expect(getSnapshot().hasToolsItems).toBe(false)

    applyContributions({
      version: 2,
      plugins: [pluginShape({ owner: 'a', menuItems: [menuItem({ point: 'menubar/tools' })] })],
    })
    expect(getSnapshot().hasToolsItems).toBe(true)

    applyContributions({
      version: 3,
      plugins: [pluginShape({ owner: 'a', menuItems: [] })],
    })
    expect(getSnapshot().hasToolsItems).toBe(false)
  })

  it('resetContributions clears the store and notifies once when non-empty', () => {
    applyContributions(generation(1, [[command()]], []))
    const listener = vi.fn()
    subscribe(listener)
    listener.mockClear()
    resetContributions()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getSnapshot().commands.size).toBe(0)
    resetContributions() // second call on empty store: no notification
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('preserves disabled reason and when on the command view', () => {
    applyContributions({
      version: 1,
      plugins: [pluginShape({
        owner: 'a',
        commands: [command({ id: 'a:foo', enabled: false, disabledReason: 'Command has no exec', when: 'hasEditor' })],
      })],
    })
    const view = getSnapshot().commands.get('a:foo')
    expect(view?.enabled).toBe(false)
    expect(view?.disabledReason).toBe('Command has no exec')
    expect(view?.when).toBe('hasEditor')
  })

  it('a subscribe listener that throws does not break the store or other subscribers', () => {
    const good = vi.fn()
    subscribe(() => { throw new Error('boom') })
    subscribe(good)
    expect(() => applyContributions(emptyGeneration())).not.toThrow()
    expect(good).toHaveBeenCalled()
  })

  it('returned unsubscribe removes the listener', () => {
    const listener = vi.fn()
    const off = subscribe(listener)
    off()
    applyContributions(emptyGeneration())
    expect(listener).not.toHaveBeenCalled()
  })
})
