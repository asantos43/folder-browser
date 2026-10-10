// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { setUserKeys } from '@core/keys/effective.ts'
import { commandFor } from '@core/shortcuts.ts'
import { shortcut } from './commands.ts'

afterEach(() => setUserKeys([], false))
it('displays user labels, removes labels for removed defaults and resolves window conditions', () => {
  Object.defineProperty(window, 'fb', { configurable: true, value: { platform: 'linux' } })
  setUserKeys([{ key: 'Mod+B', command: '-toggleSideBar' }, { key: 'Mod+Alt+J', command: 'toggleSideBar', when: 'hasEditor' }], false)
  expect(shortcut('Ctrl+B')).toBe('Ctrl+Alt+J')
  expect(commandFor({ key: 'j', control: true, alt: true }, false, { hasEditor: true })).toBe('toggleSideBar')
  expect(commandFor({ key: 'j', control: true, alt: true }, false, { hasEditor: false })).toBeNull()
  setUserKeys([{ key: 'Mod+B', command: '-toggleSideBar' }], false)
  expect(shortcut('Ctrl+B')).toBe('')
  setUserKeys([], false)
  expect(shortcut('Ctrl+B')).toBe('Ctrl+B')
})
