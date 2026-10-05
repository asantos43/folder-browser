import { describe, expect, it } from 'vitest'
import { resolveTheme } from './theme.ts'

describe('resolveTheme', () => {
  it('follows the system when the setting is auto', () => {
    expect(resolveTheme('auto', true)).toBe('dark')
    expect(resolveTheme('auto', false)).toBe('light')
  })
  it('keeps the choice of the user whatever the system says', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})
