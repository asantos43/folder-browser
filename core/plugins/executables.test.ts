import fs from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { buildInvocation } from '../run.ts'
import type { CompiledPlugin } from './compile.ts'
import { ExecutableCatalog } from './executables.ts'

const plugin = () => ({ pluginId: 'owner', configuration: [], commands: [], openWith: [{ id: 'owner:open', label: 'Open', extensions: ['.txt'], program: 'node', args: [{ kind: 'file' }, { kind: 'text', value: '{file}' }] }] } satisfies Pick<CompiledPlugin, 'pluginId' | 'configuration' | 'commands' | 'openWith'>)
const context = { file: '/tmp/-file.txt', dir: '/tmp', name: '-file.txt' }
describe('executable owner catalog', () => {
  it('qualifies only local settings without mutating compiler data or accepting a foreign owner', () => {
    const source: Pick<CompiledPlugin, 'pluginId' | 'configuration' | 'commands' | 'openWith'> = plugin()
    source.configuration = [{ id: 'arg', property: { label: 'Argument', type: 'string', default: 'default' } }]
    source.openWith = [{ ...source.openWith[0], args: [{ kind: 'setting', key: 'arg' }] }]
    let value: unknown = undefined
    const catalog = new ExecutableCatalog(() => value)
    catalog.replace('1', source)
    expect(buildInvocation(catalog.get('owner:open')!, context).args).toEqual(['default'])
    value = 'configured'
    expect(buildInvocation(catalog.get('owner:open')!, context).args).toEqual(['configured'])
    expect(source.configuration[0].id).toBe('arg')
    source.configuration[0].id = 'foreign:arg'
    expect(() => catalog.replace('2', source)).toThrow(/belong to this plugin/)
    expect(catalog.get('owner:open')!.version).toBe('1')
  })
  it('keeps typed markers, literals, versions and extension filtering without IO', () => {
    const catalog = new ExecutableCatalog(), source = plugin()
    const open = vi.spyOn(fs, 'open')
    catalog.replace('1', source)
    expect(catalog.list('a.TXT')).toHaveLength(1); expect(catalog.list('a.json')).toHaveLength(0)
    expect(buildInvocation(catalog.get('owner:open')!, context).args).toEqual([context.file, '{file}'])
    source.openWith[0].program = 'changed'
    expect(catalog.get('owner:open')).toMatchObject({ owner: 'owner', version: '1', program: 'node' })
    expect(open).not.toHaveBeenCalled(); open.mockRestore()
    const generation = catalog.get('owner:open')!.generation
    catalog.remove('owner'); expect(catalog.list()).toEqual([])
    catalog.replace('2', plugin()); expect(catalog.get('owner:open')!.generation).not.toBe(generation)
  })
  it('converts only validated scalar settings to one argument and diagnoses lists and no-exec commands', () => {
    const source: Pick<CompiledPlugin, 'pluginId' | 'configuration' | 'commands' | 'openWith'> = plugin()
    source.configuration = [
      { id: 'owner:s', property: { label: 'String', type: 'string', default: '{file} $ & " -x', maxLength: 32 } },
      { id: 'owner:n', property: { label: 'Number', type: 'number', default: 42, min: 0, max: 100 } },
      { id: 'owner:b', property: { label: 'Boolean', type: 'boolean', default: false } },
      { id: 'owner:l', property: { label: 'List', type: 'list', default: [] } },
    ]
    source.openWith = [{ ...source.openWith[0], args: ['s', 'n', 'b'].map(key => ({ kind: 'setting', key })) }, { ...source.openWith[0], id: 'owner:list', args: [{ kind: 'setting', key: 'l' }] }]
    source.commands = [{ id: 'owner:disabled', title: 'Disabled', category: '', defaultKeys: [] }]
    let value: unknown = undefined
    const catalog = new ExecutableCatalog((_owner, key) => key === 'n' ? value : undefined)
    catalog.replace('1', source)
    expect(buildInvocation(catalog.get('owner:open')!, context).args).toEqual(['{file} $ & " -x', '42', 'false'])
    expect(catalog.get('owner:list')!.disabledReason).toMatch(/cannot be an argument/)
    expect(catalog.get('owner:disabled')!.disabledReason).toBe('Command has no exec')
    for (value of [101, null, '42', Infinity]) expect(catalog.get('owner:open')!.disabledReason).toMatch(/Invalid setting/)
    source.openWith = [{ ...source.openWith[0], args: [{ kind: 'setting', key: 'other:s' }] }]
    expect(() => catalog.replace('2', source)).toThrow(/owner/)
    expect(catalog.get('owner:open')!.version).toBe('1')
  })
  it('rejects the 101st entry atomically and enforces payload, argument and generation budgets', () => {
    const source = plugin(), catalog = new ExecutableCatalog()
    source.openWith = Array.from({ length: 100 }, (_, i) => ({ ...source.openWith[0], id: `owner:open:${i}` }))
    catalog.replace('1', source)
    source.openWith.push({ ...source.openWith[0], id: 'owner:101' })
    expect(() => catalog.replace('2', source)).toThrow(/100/); expect(catalog.list()).toHaveLength(100)
    const large = plugin(); large.openWith[0].args = Array(64).fill({ kind: 'text', value: 'a'.repeat(4096) })
    large.openWith = Array.from({ length: 9 }, (_, i) => ({ ...large.openWith[0], id: `owner:${i}` }))
    expect(() => catalog.replace('2', large)).toThrow(/2 MiB/)
    const args = plugin(); args.openWith[0].args = Array(65).fill({ kind: 'file' }); expect(() => catalog.replace('2', args)).toThrow(/64/)
  })
  it('expands 100 × 64 typed arguments below 10 ms (median of 20), lists warm without IO', () => {
    const catalog = new ExecutableCatalog(), source = plugin()
    source.openWith = Array.from({ length: 100 }, (_, i) => ({ ...source.openWith[0], id: `owner:${i}`, args: Array(64).fill({ kind: 'file' }) }))
    catalog.replace('1', source)
    const samples: number[] = [], open = vi.spyOn(fs, 'open')
    for (let round = 0; round < 20; round++) {
      const start = performance.now()
      for (const entry of catalog.list('x.txt')) buildInvocation(entry, context)
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    console.log(`plugin executable expansion median: ${samples[10].toFixed(3)} ms`)
    expect(samples[10]).toBeLessThan(10); expect(open).not.toHaveBeenCalled(); open.mockRestore()
  })
  it('refuses a catalog index beyond 1 MiB and a loaded generation beyond 32 MiB', () => {
    const catalog = new ExecutableCatalog()
    const first = plugin()
    first.openWith = Array.from({ length: 4 }, (_, i) => ({ ...first.openWith[0], id: `owner:${i}`, extensions: Array(20_000).fill('.txt') }))
    catalog.replace('1', first)
    const second = { ...first, pluginId: 'second', openWith: first.openWith.map((entry, i) => ({ ...entry, id: `second:${i}` })) }
    expect(() => catalog.replace('1', second)).toThrow(/1 MiB/)
    expect(catalog.list()).toHaveLength(4)
    const generation = new ExecutableCatalog()
    for (let i = 0; i < 31; i++) generation.replace('1', { pluginId: `owner${i}`, openWith: [], commands: [], configuration: [{ id: `owner${i}:s`, property: { label: 'x'.repeat(1024 * 1024), type: 'string', default: '' } }] })
    expect(() => generation.replace('1', { pluginId: 'last', openWith: [], commands: [], configuration: [{ id: 'last:s', property: { label: 'x'.repeat(1024 * 1024), type: 'string', default: '' } }] })).toThrow(/32 MiB/)
  })
})
