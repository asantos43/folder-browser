import { expect, it } from 'vitest'
import { builtinKeyCommands } from '../commands/builtin.ts'
import { createKeyTable } from './table.ts'

it('constructs current defaults under 2 ms and looks up 100,000 events under 100 ms (median of five)', () => {
  // Warm module/JIT costs outside the measured table construction.
  for (let i = 0; i < 20; i++) createKeyTable(builtinKeyCommands, false)
  const samples: number[] = []
  const construction: number[] = []
  let hits = 0
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now()
    const table = createKeyTable(builtinKeyCommands, sample % 2 === 0)
    construction.push(performance.now() - start)
    const events = [
      { key: 'S', control: sample % 2 !== 0, meta: sample % 2 === 0 },
      { key: 'Tab', control: true, shift: true }, { key: 'F1' }, { key: '?' },
    ]
    const lookupStart = performance.now()
    for (let i = 0; i < 100_000; i++) hits += table.lookup(events[i % events.length]).length
    samples.push(performance.now() - lookupStart)
  }
  const median = samples.sort((a, b) => a - b)[2]
  const build = Math.max(...construction)
  console.info(`Key budget: construction max ${build.toFixed(3)} ms; 100,000 lookups median ${median.toFixed(3)} ms`)
  expect(hits).toBe(375_000)
  expect(build).toBeLessThan(2)
  expect(median).toBeLessThan(100)
})

it('keeps lookups O(1): 100,000 events against a table of about 1,000 chords stay under 100 ms (median of five)', () => {
  // Every modifier subset x many keys; the probed chord is inserted last, so a linear scan walks the whole table
  // (about 1e8 comparisons here) while a Map lookup does not grow with the table.
  const keys = [...'abcdefghijklmnopqrstuvwxyz0123456789', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`), 'Tab', 'Enter', 'Escape', 'Insert', 'Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'End']
  const commands: { id: string; keys: string[] }[] = []
  for (let mask = 0; mask < 16; mask++) for (const key of keys) {
    const modifiers = ['Ctrl', 'Cmd', 'Alt', 'Shift'].filter((_, bit) => mask & (1 << bit))
    if (key !== 'Home') commands.push({ id: `plugin:${mask}-${key}`, keys: [[...modifiers, key].join('+')] })
  }
  commands.push({ id: 'last', keys: ['Ctrl+Cmd+Alt+Shift+Home'] })
  const table = createKeyTable(commands, false)
  expect(commands.length).toBeGreaterThan(900)
  const event = { key: 'Home', control: true, meta: true, alt: true, shift: true }
  expect(table.lookup(event)).toEqual(['last'])
  const samples: number[] = []
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now()
    let hits = 0
    for (let i = 0; i < 100_000; i++) hits += table.lookup(event).length
    samples.push(performance.now() - start)
    expect(hits).toBe(100_000)
  }
  expect(samples.sort((a, b) => a - b)[2]).toBeLessThan(100)
})
