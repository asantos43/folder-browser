import { describe, expect, it } from 'vitest'
import { builtinKeyCommands } from '../commands/builtin.ts'
import { mergeUserKeys, parseUserKeys, validateUserKeys } from './user.ts'

describe('user keys', () => {
  it('isolates invalid fields and reserved chords; removals can name defaults', () => {
    const result = validateUserKeys([
      { key: 'Mod+V', command: 'toggleSideBar' }, { key: 'Ctrl+wat', command: 'toggleSideBar' },
      { key: 'Mod+Alt+J', command: 'missing' }, { key: 'Mod+Alt+J', command: 'toggleSideBar', when: 'x ==' },
      { key: 'Mod+B', command: '-toggleSideBar' }, { key: 'Mod+Alt+J', command: 'toggleSideBar' },
    ], builtinKeyCommands, false)
    expect(result.entries).toEqual([{ key: 'Mod+B', command: '-toggleSideBar' }, { key: 'Mod+Alt+J', command: 'toggleSideBar' }])
    expect(result.warnings.map(warning => warning.entry)).toEqual([0, 1, 2, 3])
    expect(parseUserKeys('{', builtinKeyCommands, false).warnings).toHaveLength(1)
    expect(parseUserKeys(' '.repeat(256 * 1024 + 1), builtinKeyCommands, false).entries).toEqual([])
    expect(validateUserKeys({}, builtinKeyCommands, false).warnings).toHaveLength(1)
  })
  it('removes only the named default and gives user labels priority', () => {
    const { table } = mergeUserKeys(builtinKeyCommands, [
      { key: 'Mod+B', command: '-toggleSideBar' }, { key: 'Mod+Alt+J', command: 'toggleSideBar' },
    ], false)
    expect(table.lookup({ key: 'b', control: true })).toEqual([])
    expect(table.lookup({ key: 'j', control: true, alt: true })).toEqual(['toggleSideBar'])
    expect(table.shortcut('toggleSideBar')).toBe('Ctrl+Alt+J')
    expect(table.get('Mod+O')).toEqual(['openFile'])
  })
  it('reports overlapping commands and resolves separated when only with window context', () => {
    const { table, conflicts } = mergeUserKeys(builtinKeyCommands, [
      { key: 'Mod+Alt+J', command: 'toggleSideBar' }, { key: 'Mod+Alt+J', command: 'toggleHidden' },
      { key: 'Mod+Alt+L', command: 'toggleSideBar', when: 'hasEditor' },
      { key: 'Mod+Alt+L', command: 'toggleHidden', when: '!hasEditor' },
    ], false)
    expect(conflicts).toEqual([{ key: 'Mod+Alt+J', commands: ['toggleSideBar', 'toggleHidden'] }])
    expect(table.lookup({ key: 'l', control: true, alt: true })).toEqual([])
    expect(table.lookup({ key: 'l', control: true, alt: true }, { hasEditor: true })).toEqual(['toggleSideBar'])
    expect(table.accelerator('toggleHidden')).toBeUndefined()
  })
  it('merges 500 entries below 10 ms (median of 20)', () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({ key: 'Mod+Alt+J', command: i % 2 ? 'toggleHidden' : 'toggleSideBar' }))
    const samples = Array.from({ length: 20 }, () => { const start = performance.now(); mergeUserKeys(builtinKeyCommands, entries, false); return performance.now() - start })
    const median = samples.sort((a, b) => a - b)[10]
    console.log(`mergeUserKeys 500 entries: median ${median.toFixed(3)} ms`)
    expect(median).toBeLessThan(10)
  })
})
