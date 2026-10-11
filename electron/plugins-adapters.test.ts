import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { activationPlugin } from '../fixtures/plugin-activation.ts'
import { createActivation, activationKinds, ActivationError } from '../core/plugins/activation.ts'
import { createGenerationStore } from '../core/plugins/generation.ts'
import { ExecutableCatalog } from '../core/plugins/executables.ts'
import { SettingsRegistry } from '../core/settings/registry.ts'
import { LanguageRegistry } from '../core/languages/registry.ts'
import { createMenuRegistry } from '../core/contributions/menus.ts'
import { setPluginLanguageIndex, languageOf } from '../core/filekind.ts'
import { effectiveKeyTable, setUserKeys } from '../core/keys/effective.ts'
import { KeysHost } from './keys-host.ts'
import { createMainAdapters } from './plugins-adapters.ts'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); setUserKeys([], false); setPluginLanguageIndex(null) })
function harness(seed = '[]', bytes?: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-adapters-'))
  fs.writeFileSync(path.join(dir, 'keybindings.json'), seed)
  // IPC is unused: this test exercises only the real main-side registries.
  const ipc = { on() {}, removeListener() {}, handle() {}, removeHandler() {} } as unknown as ConstructorParameters<typeof KeysHost>[1]
  const keys = new KeysHost(dir, ipc, () => [], false)
  cleanups.push(() => { keys.dispose(); fs.rmSync(dir, { recursive: true, force: true }) })
  const registry = new SettingsRegistry(), languages = new LanguageRegistry(new Set(['txt'])), runCatalogue = new ExecutableCatalog()
  const generation = createGenerationStore({ bytes }), versions = new Map<string, string>()
  const main = createMainAdapters({ registry, keys, languages, runCatalogue, generation, menus: createMenuRegistry(), version: owner => versions.get(owner) ?? '1.0.0' })
  return { ...main, registry, keys, languages, runCatalogue, versions, dir, activation: createActivation(main.adapters) }
}

it('integrates activation with real settings, keys, languages, execution and generation without IPC', async () => {
  const x = harness(), observed: unknown[] = []
  const view = () => ({ option: x.registry.get('sample:option0')?.default, key: effectiveKeyTable(false).get('Mod+Alt+J'), locale: x.generation.snapshot().plugins[0]?.locales[0]?.label, command: x.commands.get('sample:command0')?.title, executable: x.runCatalogue.get('sample:command0')?.version })
  for (const subscribe of [x.registry.subscribe, x.keys.subscribe.bind(x.keys), x.generation.subscribe]) subscribe(() => observed.push(view()))
  x.activation.activate('sample', activationPlugin())
  const expected = { option: 'old', key: ['sample:command0'], locale: 'old', command: 'old', executable: '1.0.0' }
  expect(observed).toEqual([expected, expected, expected])
  expect(x.generation.snapshot().version).toBe(1)
  expect(x.commands.handler('sample:command0')).toBeUndefined()
  expect(x.menus.all()).toHaveLength(1)
  expect(languageOf('text/plain', 'file.sample')).toBe('javascript')
  expect(x.generation.snapshot().plugins[0].commands[1]).toMatchObject({ enabled: false, disabledReason: 'Command has no exec' })
  x.versions.set('sample', '2.0.0')
  observed.length = 0
  x.activation.update('sample', activationPlugin('sample', 'new'))
  expect(observed).toHaveLength(3)
  expect(observed.every(item => JSON.stringify(item) === JSON.stringify({ ...expected, option: 'new', locale: 'new', command: 'new', executable: '2.0.0' }))).toBe(true)
  expect(x.generation.snapshot().version).toBe(2)
  x.activation.deactivate('sample')
  expect(x.registry.get('sample:option0')?.owner).toEqual({ id: 'sample', enabled: false })
  expect(x.generation.snapshot().plugins[0].settings).toHaveLength(1)
  expect(x.generation.snapshot().plugins[0].themes).toEqual([])
  expect(x.commands.list()).toEqual([]); expect(x.menus.all()).toEqual([])
  expect(x.runCatalogue.list()).toEqual([])
  expect(effectiveKeyTable(false).get('Mod+Alt+J')).toEqual([])
  const disabled = x.generation.snapshot(); x.activation.deactivate('sample'); expect(x.generation.snapshot()).toBe(disabled)
  x.activation.remove('sample')
  expect(x.registry.all()).toEqual([]); expect(x.generation.snapshot().plugins).toEqual([])
  const empty = x.generation.snapshot(); x.activation.remove('sample'); expect(x.generation.snapshot()).toBe(empty)
  await Promise.resolve()
  expect(fs.readFileSync(path.join(x.dir, 'keybindings.json'), 'utf8')).toBe('[]')
})

it('all eight prepares are pure and handles are immutable; foreign collisions preserve existing entries', () => {
  const x = harness(), source = activationPlugin(), context = { enabled: true, disabledCommands: new Map<string, string>() }
  const before = x.generation.snapshot()
  for (const kind of activationKinds) {
    const handle = x.adapters[kind].prepare('sample', source, context)
    expect(Object.isFrozen(handle)).toBe(true)
    expect(Object.isFrozen(handle.compiled.commands[0].exec)).toBe(true)
  }
  expect(x.registry.all()).toEqual([]); expect(x.keys.listSchemes()).toEqual([])
  expect(x.languages.size()).toBe(0); expect(x.commands.list()).toEqual([])
  expect(x.runCatalogue.list()).toEqual([]); expect(x.generation.snapshot()).toBe(before)
  x.registry.defineSetting({ id: 'sample:option0', type: 'string', default: 'foreign', label: 'foreign', category: 'foreign' })
  expect(() => x.activation.activate('sample', source)).toThrow(ActivationError)
  expect(x.registry.get('sample:option0')?.default).toBe('foreign')
  x.registry.remove('sample:option0')
  x.commands.register({ id: 'sample:command0', title: 'foreign', category: 'foreign' })
  expect(() => x.activation.activate('sample', source)).toThrow(ActivationError)
  expect(x.commands.get('sample:command0')?.title).toBe('foreign')
  x.commands.unregister('sample:command0')
  x.menus.add(source.contribution.menuItems[0])
  expect(() => x.activation.activate('sample', source)).toThrow(ActivationError)
  expect(x.menus.all()).toHaveLength(1)
})

it.each(['settings', 'keys', 'languages', 'commands', 'menus', 'execution'] as const)('a real %s writer mutating then throwing restores all registries and discards notifications', async kind => {
  const x = harness()
  x.activation.activate('sample', activationPlugin())
  x.activation.activate('other', activationPlugin('other'))
  const before = x.generation.snapshot(), observed: unknown[] = []
  const settings = x.registry.all(), catalogue = x.runCatalogue.list(), languageEntries = x.languages.debugEntries()
  const watch = () => observed.push({ settings: x.registry.all(), keys: x.keys.snapshot, generation: x.generation.snapshot() })
  x.registry.subscribe(watch); x.keys.subscribe(watch); x.generation.subscribe(watch)
  const failOnce = <A extends unknown[]>(action: (...args: A) => void) => {
    let armed = true
    return (...args: A): void => { action(...args); if (armed) { armed = false; throw new Error('injected after mutation') } }
  }
  if (kind === 'settings') {
    const original = x.registry.defineSetting.bind(x.registry)
    let armed = true
    vi.spyOn(x.registry, 'defineSetting').mockImplementation(input => { const result = original(input); if (armed) { armed = false; throw new Error('injected after mutation') }; return result })
  } else if (kind === 'keys') {
    const write = failOnce(x.keys.setPlugin.bind(x.keys)); vi.spyOn(x.keys, 'setPlugin').mockImplementation(write)
  } else if (kind === 'languages') {
    const write = failOnce(x.languages.set.bind(x.languages)); vi.spyOn(x.languages, 'set').mockImplementation(write)
  } else if (kind === 'commands') {
    const write = failOnce(x.commands.register.bind(x.commands)); vi.spyOn(x.commands, 'register').mockImplementation(write)
  } else if (kind === 'menus') {
    const write = failOnce(x.menus.add.bind(x.menus)); vi.spyOn(x.menus, 'add').mockImplementation(write)
  } else {
    const write = failOnce(x.runCatalogue.replace.bind(x.runCatalogue)); vi.spyOn(x.runCatalogue, 'replace').mockImplementation(write)
  }
  x.versions.set('sample', '2.0.0')
  let failure: unknown
  try { x.activation.update('sample', activationPlugin('sample', 'new')) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(ActivationError)
  expect((failure as ActivationError).rollbackFailures).toEqual([])
  await Promise.resolve()
  expect(observed).toEqual([])
  expect(x.generation.snapshot()).toBe(before)
  expect(x.registry.all()).toEqual(settings)
  expect(x.runCatalogue.list()).toEqual(catalogue)
  expect(x.languages.debugEntries()).toEqual(languageEntries)
  expect(x.commands.get('sample:command0')?.title).toBe('old')
  expect(x.commands.get('other:command0')?.title).toBe('old')
  expect(effectiveKeyTable(false).get('Mod+Alt+J')).toEqual(['other:command0'])
  vi.restoreAllMocks()
  x.activation.update('sample', activationPlugin('sample', 'new'))
  expect(x.generation.snapshot().version).toBe(before.version + 1)
  expect(observed).toHaveLength(3)
})

it.each(['themes', 'texts'] as const)('rolls back when the %s adapter fails after the owner projection changed', kind => {
  const x = harness(); x.activation.activate('sample', activationPlugin())
  const before = x.generation.snapshot(), observed: unknown[] = []
  x.generation.subscribe(() => observed.push(x.generation.snapshot()))
  const original = x.adapters[kind].commit
  let armed = true
  vi.spyOn(x.adapters[kind], 'commit').mockImplementation(handle => { original(handle); if (armed) { armed = false; throw new Error('injected') } })
  expect(() => x.activation.update('sample', activationPlugin('sample', 'new'))).toThrow(ActivationError)
  expect(x.generation.snapshot()).toBe(before); expect(observed).toEqual([])
})

it.each(['deactivate', 'remove'] as const)('a failed %s retains the exact previous generation and permits retry', action => {
  const x = harness(); x.activation.activate('sample', activationPlugin())
  const before = x.generation.snapshot(), observed: unknown[] = []
  const watch = () => observed.push(x.generation.snapshot())
  x.registry.subscribe(watch); x.keys.subscribe(watch); x.generation.subscribe(watch)
  const remove = x.runCatalogue.remove.bind(x.runCatalogue)
  let armed = true
  vi.spyOn(x.runCatalogue, 'remove').mockImplementation(owner => { remove(owner); if (armed) { armed = false; throw new Error('injected removal') } })
  expect(() => x.activation[action]('sample')).toThrow(ActivationError)
  expect(x.generation.snapshot()).toBe(before); expect(observed).toEqual([])
  expect(x.registry.get('sample:option0')?.owner?.enabled).toBe(true)
  expect(effectiveKeyTable(false).get('Mod+Alt+J')).toEqual(['sample:command0'])
  x.activation[action]('sample')
  expect(x.generation.snapshot().version).toBe(before.version + 1)
})

it('buffers every registry callback, refuses reentry and isolates throwing subscribers', () => {
  const x = harness(), observed: unknown[] = []
  let refusedReentry = false
  x.registry.subscribe(() => { throw new Error('subscriber failure') })
  x.keys.subscribe(() => { throw new Error('subscriber failure') })
  x.generation.subscribe(() => { throw new Error('subscriber failure') })
  x.registry.subscribe(() => { observed.push(x.generation.snapshot()); try { x.adapters.publish(() => {}) } catch { refusedReentry = true } })
  x.keys.subscribe(() => observed.push(x.generation.snapshot()))
  x.generation.subscribe(() => observed.push(x.generation.snapshot()))
  expect(() => x.activation.activate('sample', activationPlugin())).not.toThrow()
  expect(observed).toEqual([x.generation.snapshot(), x.generation.snapshot(), x.generation.snapshot()])
  expect(refusedReentry).toBe(true)
  let calls = 0
  expect(() => x.adapters.publish(() => { calls++; x.adapters.publish(() => {}) })).toThrow('Reentrant')
  expect(calls).toBe(1)
  x.adapters.publish(() => { calls++ }); expect(calls).toBe(2)
})

it('stable plugin order and user keys prevail; selected schemes and removal preserve the user file', () => {
  const seed = '[\n {"key":"Mod+Alt+J","command":"b:command0"}\n]'
  const x = harness(seed)
  x.activation.activate('b', activationPlugin('b'))
  x.activation.activate('a', activationPlugin('a'))
  expect(effectiveKeyTable(false).get('Mod+Alt+J')).toEqual(['b:command0'])
  expect(x.generation.snapshot().plugins.find(plugin => plugin.owner === 'a')?.resolvedKeys ?? []).toEqual([])
  expect(x.keys.snapshot.warnings.some(warning => warning.message.includes('a wins over b'))).toBe(true)
  x.keys.selectScheme({ owner: 'a', id: 'scheme' })
  expect(effectiveKeyTable(false).get('Mod+Alt+K')).toEqual(['a:command0'])
  x.activation.remove('b')
  expect(effectiveKeyTable(false).get('Mod+Alt+J')).toEqual(['a:command0'])
  x.activation.remove('a')
  expect(effectiveKeyTable(false).get('Mod+Alt+K')).toEqual([])
  expect(effectiveKeyTable(false).get('Mod+B')).toEqual(['toggleSideBar'])
  expect(fs.readFileSync(path.join(x.dir, 'keybindings.json'), 'utf8')).toBe(seed)
  const y = harness()
  y.activation.activate('b', activationPlugin('b')); y.activation.activate('a', activationPlugin('a'))
  expect(effectiveKeyTable(false).get('Mod+Alt+J')).toEqual(['a:command0'])
})

it('rejects conflicting locales/languages and oversized generations before touching other owners', () => {
  const x = harness(); x.activation.activate('a', activationPlugin('a'))
  const before = x.generation.snapshot(), b = activationPlugin('b')
  b.locales = activationPlugin('a').locales
  expect(() => x.activation.activate('b', b)).toThrow(ActivationError)
  b.locales = activationPlugin('b').locales; b.languages = [{ ...b.languages[0], extensions: ['.a'] }]
  expect(() => x.activation.activate('b', b)).toThrow(ActivationError)
  expect(x.generation.snapshot()).toBe(before)
  const y = harness('[]', 2500)
  y.activation.activate('sample', activationPlugin())
  const small = y.generation.snapshot()
  expect(() => y.activation.update('sample', activationPlugin('sample', 'new', { themes: 30 }))).toThrow(ActivationError)
  expect(y.generation.snapshot()).toBe(small)
})

it('contains no executable program, args, functions or raw keymap keys in the concrete generation', () => {
  const x = harness(); x.activation.activate('sample', activationPlugin())
  const scan = (value: unknown): void => {
    expect(typeof value).not.toBe('function')
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      expect(['exec', 'program', 'args', 'keymapKeys', 'validator', 'path']).not.toContain(key)
      scan(child)
    }
  }
  scan(x.generation.snapshot())
  expect(JSON.stringify(x.generation.snapshot())).not.toContain('fixture-private-program')
  expect(x.runCatalogue.get('sample:command0')?.program).toBe('fixture-private-program')
})

it('a failed first activation publishes nothing, and idempotent adapter removals do not change version', async () => {
  const x = harness(), before = x.generation.snapshot(), observed: unknown[] = []
  const watch = () => observed.push(x.generation.snapshot())
  x.registry.subscribe(watch); x.keys.subscribe(watch); x.generation.subscribe(watch)
  const replace = x.runCatalogue.replace.bind(x.runCatalogue)
  vi.spyOn(x.runCatalogue, 'replace').mockImplementation((version, source) => { replace(version, source); throw new Error('injected') })
  expect(() => x.activation.activate('sample', activationPlugin())).toThrow(ActivationError)
  await Promise.resolve()
  expect(observed).toEqual([]); expect(x.generation.snapshot()).toBe(before)
  expect(x.registry.all()).toEqual([]); expect(x.keys.listSchemes()).toEqual([])
  expect(x.commands.list()).toEqual([]); expect(x.menus.all()).toEqual([]); expect(x.runCatalogue.list()).toEqual([])
  x.adapters.publish(() => { for (const kind of activationKinds) { x.adapters[kind].remove('missing'); x.adapters[kind].remove('sample') } })
  expect(observed).toEqual([]); expect(x.generation.snapshot()).toBe(before)
})

it('enforces real activation/removal of 500 renderer items below 100 ms', () => {
  // Same item accounting as the step-8 budget: 495 themes, one definition,
  // one command, one language, one locale, and one owner dictionary.
  const source = activationPlugin('sample', 'old', { themes: 495, commands: 1 })
  const samples: number[] = []
  for (let round = 0; round < 5; round++) {
    const x = harness(), start = performance.now()
    x.activation.activate('sample', source); x.activation.remove('sample')
    samples.push(performance.now() - start)
  }
  const ms = samples.sort((a, b) => a - b)[2]
  appendFileSync('.delegate/passo-270.metrics.jsonl', JSON.stringify({ kind: 'activation-remove-500', ms }) + '\n')
  expect(ms).toBeLessThan(100)
})
