import { expect, it } from 'vitest'
import { builtinKeyCommands } from '../commands/builtin.ts'
import { KeySchemes, type KeyPackage } from './schemes.ts'
import { parseChord } from './chord.ts'
import { isReserved } from './reserved.ts'

function pack(owner = 'a', key = 'Mod+Alt+J'): KeyPackage {
  return {
    commands: [{ id: `${owner}:run`, defaultKeys: [key] }],
    keySchemes: [{ id: 'one', label: 'One' }, { id: 'empty', label: 'Empty' }],
    keymaps: [{ command: 'toggleSideBar', key: 'Mod+Alt+L', source: { keymapId: 'one', keymapLabel: 'One' } }],
  }
}

it.each([false, true])('composes defaults, one scheme and user overrides on mac=%s', mac => {
  const schemes = new KeySchemes()
  schemes.set('a', pack())
  schemes.select({ owner: 'a', id: 'one' })
  const coreBefore = JSON.stringify(builtinKeyCommands)
  let result = schemes.compose(builtinKeyCommands, [], mac)
  expect(result.table.get('Mod+Alt+J')).toEqual(['a:run'])
  expect(result.table.get('Mod+Alt+L')).toEqual(['toggleSideBar'])
  result = schemes.compose(builtinKeyCommands, [{ key: 'Mod+Alt+J', command: 'toggleHidden' }], mac)
  expect(result.table.get('Mod+Alt+J')).toEqual(['toggleHidden'])
  schemes.select({ owner: 'a', id: 'empty' })
  expect(schemes.compose(builtinKeyCommands, [], mac).table.get('Mod+Alt+L')).toEqual([])
  expect(schemes.compose(builtinKeyCommands, [], mac).table.get('Mod+Alt+J')).toEqual(['a:run'])
  schemes.select({ owner: 'a', id: 'one' })
  schemes.remove('a')
  result = schemes.compose(builtinKeyCommands, [], mac)
  expect(result.table.get('Mod+Alt+L')).toEqual([])
  expect(result.table.get('Mod+B')).toEqual(['toggleSideBar'])
  expect(result.warnings[0].message).toContain('unavailable')
  expect(JSON.stringify(builtinKeyCommands)).toBe(coreBefore)
  schemes.set('a', pack())
  expect(schemes.compose(builtinKeyCommands, [], mac).table.get('Mod+Alt+L')).toEqual(['toggleSideBar'])
})

it.each([false, true])('rejects reserved and foreign commands, respects platform qualifications mac=%s', mac => {
  const schemes = new KeySchemes(), value = pack()
  value.commands = [{ id: 'a:run', defaultKeys: ['Mod+S', 'mac:Mod+Alt+J', 'nonmac:Mod+Alt+L', 'mac:Ctrl+B'] }]
  value.keymaps = [{ command: 'b:run', key: 'Mod+Alt+K', source: { keymapId: 'one', keymapLabel: 'One' } }]
  schemes.set('b', pack('b', 'Mod+Alt+U'))
  schemes.set('a', value)
  schemes.select({ owner: 'a', id: 'one' })
  const result = schemes.compose(builtinKeyCommands, [], mac)
  expect(result.table.get('Mod+S')).toEqual(['save'])
  expect(result.table.get(mac ? 'Mod+Alt+J' : 'Mod+Alt+L')).toEqual(['a:run'])
  expect(result.table.get('Mod+Alt+K')).toEqual([])
  expect(result.warnings.some(warning => warning.message.includes('Reserved'))).toBe(true)
  expect(result.warnings.some(warning => warning.message.includes('foreign'))).toBe(true)
})

it('uses stable owner order with diagnostics; updates restore previous bindings and do not own core references', () => {
  const schemes = new KeySchemes()
  schemes.set('b', pack('b'))
  const a = pack()
  a.keymaps = [{ command: 'toggleSideBar', key: 'Mod+Alt+J', source: { keymapId: 'one', keymapLabel: 'One' } }]
  schemes.set('a', a); schemes.select({ owner: 'a', id: 'one' })
  let result = schemes.compose(builtinKeyCommands, [], false)
  expect(result.table.get('Mod+Alt+J')).toEqual(['toggleSideBar'])
  expect(result.warnings[0].message).toContain('a wins over b')
  expect(schemes.list().map(scheme => scheme.owner)).toEqual(['a', 'a', 'b', 'b'])
  schemes.set('a', { ...a, keymaps: [] })
  expect(schemes.compose(builtinKeyCommands, [], false).table.get('Mod+Alt+J')).toEqual(['a:run'])
  schemes.remove('a')
  result = schemes.compose(builtinKeyCommands, [], false)
  expect(result.table.get('Mod+Alt+J')).toEqual(['b:run'])
  expect(result.commands.some(command => command.id === 'toggleSideBar')).toBe(true)
})

it('plugin overrides a free core chord; user removals suppress plugin defaults', () => {
  const schemes = new KeySchemes()
  schemes.set('a', pack())
  const core = [{ id: 'core', keys: ['Mod+Alt+J'] }]
  expect(schemes.compose(core, [], false).table.get('Mod+Alt+J')).toEqual(['a:run'])
  expect(schemes.compose(core, [{ key: 'Mod+Alt+J', command: '-a:run' }], false).table.get('Mod+Alt+J')).toEqual([])
  schemes.remove('a')
  expect(schemes.compose(core, [], false).table.get('Mod+Alt+J')).toEqual(['core'])
})

it('merges 500 bindings under 10 ms and performs 100,000 lookups under 100 ms (median of seven)', () => {
  const schemes = new KeySchemes()
  const keys = [...'abcdefghijklmnopqrstuvwxyz0123456789', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]
  const bindings = Array.from({ length: 16 * keys.length }, (_, i) => [...['Ctrl', 'Cmd', 'Alt', 'Shift'].filter((_, bit) => Math.floor(i / keys.length) & (1 << bit)), keys[i % keys.length]].join('+'))
    .filter(key => !isReserved(key, false) && !isReserved(key, true)).slice(0, 500)
  expect(bindings).toHaveLength(500)
  schemes.set('a', { commands: bindings.map((key, i) => ({ id: `a:${i}`, defaultKeys: [key] })), keySchemes: [], keymaps: [] })
  for (let i = 0; i < 20; i++) schemes.compose(builtinKeyCommands, [], false)
  const merge: number[] = [], lookup: number[] = []
  for (let round = 0; round < 7; round++) {
    const start = performance.now()
    const result = schemes.compose(builtinKeyCommands, [], round % 2 === 0)
    merge.push(performance.now() - start)
    const event = parseChord(bindings[499], round % 2 === 0)
    const lookupStart = performance.now()
    let hits = 0
    for (let i = 0; i < 100_000; i++) hits += result.table.lookup(event).length
    lookup.push(performance.now() - lookupStart)
    expect(hits).toBe(100_000)
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[3]
  console.info(`Scheme budget: 500 bindings merge ${median(merge).toFixed(3)} ms; 100,000 lookups ${median(lookup).toFixed(3)} ms (medians)`)
  expect(median(merge)).toBeLessThan(10)
  expect(median(lookup)).toBeLessThan(100)
})
