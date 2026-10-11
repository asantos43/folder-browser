// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { applyContributions, resetContributions } from '@/plugins/contributions.ts'
import { I18nProvider } from '@/i18n/context.tsx'
import { empty } from '@/state/workspace.ts'
import { translator } from '@/i18n/index.ts'

// A plain counter: vitest clears vi.fn() calls before each test, which would hide a call made while the module loads.
const built = vi.hoisted(() => ({ calls: 0 }))

vi.mock('./commands.ts', async () => {
  const actual = await vi.importActual<typeof import('./commands.ts')>('./commands.ts')
  return {
    ...actual,
    currentMenus: () => actual.currentMenus().map((menu) => ({ ...menu, entries: (...args: Parameters<typeof menu.entries>) => { built.calls++; return menu.entries(...args) } })),
  }
})

import { buildCommandItemsWhenOpen, commandItems, QuickOpen } from './QuickOpen.tsx'
import type { Commands } from './commands.ts'

afterEach(() => { cleanup(); resetContributions() })

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

  it('shows a translated disabled reason and keeps the palette open on Enter or click', () => {
    applyContributions({ version: 1, plugins: [{
      owner: 'a', enabled: true, themes: [], locales: [], texts: {}, languages: [], settings: [], keySchemes: [], keyEntries: [],
      commands: [{ id: 'a:future', title: 'Future command', category: 'a', enabled: false, disabledReason: 'Command has no exec', defaultKeys: [], palette: true }],
      menuItems: [{ id: 'a.item', command: 'a:future', point: 'menubar/tools', group: 'commands', order: 0 }],
    }] })
    const commands = { recent: [], canZoom: false, setTheme: vi.fn() } as unknown as Commands
    const onClose = vi.fn(), onOpen = vi.fn()
    for (const language of ['en', 'pt-BR'] as const) {
      const t = translator(language)
      const items = commandItems(t, commands, commands.setTheme).filter(item => item.id === 'plugin:a:future')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ disabled: true, description: t('quickOpen.pluginFuture') })
      render(<I18nProvider language={language}><QuickOpen start="commands" ws={empty} commands={commands} loadFiles={async () => ({ paths: [], truncated: false })} onOpen={onOpen} onClose={onClose} /></I18nProvider>)
      const input = screen.getByRole('combobox')
      fireEvent.change(input, { target: { value: '>Future command' } })
      const option = screen.getByRole('option')
      expect(option.getAttribute('aria-disabled')).toBe('true')
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.click(option)
      expect(onClose).not.toHaveBeenCalled()
      expect(onOpen).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeTruthy()
      cleanup()
    }
  })
})
