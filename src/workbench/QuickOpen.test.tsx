// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { translator } from '@/i18n/index.ts'

// A plain counter: vitest clears vi.fn() calls before each test, which would hide a call made while the module loads.
const built = vi.hoisted(() => ({ calls: 0 }))

vi.mock('./commands.ts', async () => {
  const actual = await vi.importActual<typeof import('./commands.ts')>('./commands.ts')
  return {
    ...actual,
    MENUS: actual.MENUS.map((menu) => ({ ...menu, entries: (...args: Parameters<typeof menu.entries>) => { built.calls++; return menu.entries(...args) } })),
  }
})

import { buildCommandItemsWhenOpen, commandItems } from './QuickOpen.tsx'
import type { Commands } from './commands.ts'

describe('command palette item construction', () => {
  it('builds no command items when the module loads or while the palette is closed, only when it opens', () => {
    expect(built.calls).toBe(0)
    expect(buildCommandItemsWhenOpen(false, () => { built.calls++; return [] })).toBeUndefined()
    expect(built.calls).toBe(0)
    const t = translator('en')
    const commands = { recent: [], canZoom: true, setTheme: () => {} } as unknown as Commands
    const items = buildCommandItemsWhenOpen(true, () => commandItems(t, commands, commands.setTheme))!
    expect(built.calls).toBeGreaterThan(0)
    expect(items.some((item) => item.id === 'theme:dark')).toBe(true)
  })
})
