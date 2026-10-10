import { useSyncExternalStore } from 'react'
import type { SortKey } from '@core/fs/sort.ts'
import { readStored, writeStored } from '@/lib/storage.ts'
import { settingsRegistry, type SettingDefinition } from '@core/settings/registry.ts'

const ids: Record<string, string> = {
  wordWrap: 'editor.wordWrap', svgView: 'files.svgView', csvView: 'files.csvView',
  markdownView: 'editor.markdownView', markdownWide: 'editor.markdownWide', markdownWrapCode: 'editor.markdownWrapCode',
  reopenSession: 'tabs.reopenSession', dividerColour: 'appearance.dividerColour', hotExit: 'editor.hotExit',
  showHidden: 'files.showHidden', sortKey: 'files.sortKey', sortDescending: 'files.sortDescending',
  formatSource: 'editor.formatSource', diffLayout: 'diff.layout', diffCollapse: 'diff.collapseUnchanged',
  theme: 'appearance.theme', language: 'system.language',
}
const bridge = typeof window === 'undefined' ? undefined : window.fb?.settings
const initial = bridge?.all() ?? {}
const readers = new Map<string, Set<(next: unknown) => void>>()
const pending = new Map<string, unknown>()
const stores = new Map<string, Setting<unknown>>()
let resettingSection = false
let timer: ReturnType<typeof setTimeout> | undefined
let migrating = false
let migrated = true
try { migrated = localStorage.getItem('fb:settings-migrated') === 'true' } catch { /* Storage is optional. */ }

function sendNow(): void {
  if (pending.size === 0) return
  const pairs = [...pending.entries()]
  pending.clear()
  for (let offset = 0; offset < pairs.length; offset += 100) bridge!.set(pairs.slice(offset, offset + 100))
  if (migrating) {
    migrating = false
    migrated = true
    writeStored('settings-migrated', true)
  }
}

/** The first change goes at once (a window closed a moment later keeps it); the changes of the next 100 ms go together, the last value of each id. */
function arm(): void {
  timer = setTimeout(() => {
    timer = undefined
    if (pending.size === 0) return
    sendNow()
    arm()
  }, 100)
}

function queue(id: string, value: unknown, now = true): void {
  pending.set(id, value)
  if (timer !== undefined) return
  if (now) sendNow()
  arm()
}

// A window that closes inside the 100 ms must not lose the last change.
if (bridge && typeof window !== 'undefined') {
  const leave = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (pending.size === 0) return
    sendNow()
    // The window may be gone before an asynchronous message is delivered: a synchronous call is a barrier that the main process answers after it has the sets.
    bridge.all()
  }
  window.addEventListener('pagehide', leave)
  window.addEventListener('beforeunload', leave)
}

bridge?.onChanged((changed) => {
  const latest = bridge.all()
  for (const id of changed) {
    // A newer local value is still on its way to the main process: this event is its predecessor.
    if (pending.has(id)) continue
    for (const read of readers.get(id) ?? []) read(latest[id])
  }
})

/** A setting kept on this computer that more than one part of the interface reads and changes (word wrap, formatting): a value, and a hook. */
export interface Setting<T> {
  subscribe: (listener: () => void) => () => void
  get: () => T
  set: (value: T) => void
  reset: () => void
  /** Reads the value again from storage (a test that cleared it). */
  reload: () => void
  use: () => T
}

export function createSetting<T>(key: string, fallback: T, valid: (value: unknown) => value is T): Setting<T> {
  const listeners = new Set<() => void>()
  const id = ids[key] ?? key
  let value = bridge ? (valid(initial[id]) ? initial[id] : fallback) : readStored(key, fallback, valid)
  const tell = () => listeners.forEach((l) => l())
  if (bridge) {
    const receive = (next: unknown) => {
      const accepted = valid(next) ? next : fallback
      if (Object.is(value, accepted)) return
      value = accepted
      tell()
    }
    const registered = readers.get(id) ?? new Set()
    registered.add(receive)
    readers.set(id, registered)
    if (!migrated && (!Object.hasOwn(initial, id) || JSON.stringify(initial[id]) === JSON.stringify(fallback))) {
      const legacy = readStored<unknown>(key, undefined, valid)
      if (valid(legacy)) {
        value = legacy
        queue(id, legacy, false)
      }
    }
    // Module imports register all 17 options synchronously, including theme/language.
    if (!migrated && !migrating) {
      migrating = true
      queueMicrotask(() => {
        if (timer !== undefined) return
        migrating = false
        migrated = true
        writeStored('settings-migrated', true)
      })
    }
  }
  const store: Setting<T> = {
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    get: () => value,
    set: (next) => {
      value = next
      if (bridge) queue(id, next)
      else writeStored(key, next)
      tell()
    },
    reset: () => {
      pending.delete(id)
      value = fallback
      if (bridge && !resettingSection) bridge.reset([id])
      else writeStored(key, fallback)
      tell()
    },
    reload: () => {
      const stored = bridge?.all()[id]
      value = bridge ? (valid(stored) ? stored : fallback) : readStored(key, fallback, valid)
      tell()
    },
    use: () => useSyncExternalStore((listener) => (listeners.add(listener), () => void listeners.delete(listener)), () => value),
  }
  stores.set(id, store as Setting<unknown>)
  return store
}

/** Generated controls share the very same stores as toolbars, theme and language. */
export function settingFor(definition: SettingDefinition): Setting<unknown> {
  const existing = stores.get(definition.id)
  if (existing) return existing
  const legacy = Object.keys(ids).find(key => ids[key] === definition.id) ?? definition.id
  return createSetting(legacy, definition.default, (value): value is unknown => settingsRegistry.validate(definition.id, value))
}

export function resetSettings(definitions: readonly SettingDefinition[]): void {
  resettingSection = true
  try { for (const definition of definitions) settingFor(definition).reset() }
  finally { resettingSection = false }
  if (bridge) for (let offset = 0; offset < definitions.length; offset += 100) bridge.reset(definitions.slice(offset, offset + 100).map(d => d.id))
}

/** Settle the renderer batch before exporting, previewing or replacing settings. */
export function flushSettingChanges(): void {
  if (pending.size) sendNow()
}

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'

/** Long lines of a text file wrap at the edge of the window (VS Code's Word Wrap, Alt+Z). Off by default, as in VS Code. */
export const wordWrap = createSetting('wordWrap', false, isBoolean)
/** An SVG file is shown as a picture or as its source: the last choice is kept (as a picture at first). */
export const svgView = createSetting<'image' | 'code'>('svgView', 'image', (v): v is 'image' | 'code' => v === 'image' || v === 'code')
/** A CSV or TSV file is shown as a table or as its text: the last choice is kept (as a table at first). */
export const csvView = createSetting<'table' | 'text'>('csvView', 'table', (v): v is 'table' | 'text' => v === 'table' || v === 'text')
/** A Markdown file is shown formatted or as its text: the last choice is kept (formatted at first). */
export const markdownView = createSetting<'formatted' | 'text'>('markdownView', 'formatted', (v): v is 'formatted' | 'text' => v === 'formatted' || v === 'text')
/** A Markdown page is as wide as the window, not the reading column of 880 px (so that a code block or a table needs no scroll bar). Off by default. */
export const markdownWide = createSetting('markdownWide', false, isBoolean)
/** Long lines of a code block in a Markdown page wrap instead of scrolling sideways. Off by default: a block keeps its columns. */
export const markdownWrapCode = createSetting('markdownWrapCode', false, isBoolean)
/** At start, without a file to open, the snapshots and files that were open when the application was closed are opened again (VS Code does the same). */
export const reopenSession = createSetting('reopenSession', true, isBoolean)
/** The colour of the line between the Explorer and the editors (`#rrggbb`), or `''` for the theme's own. */
export const dividerColour = createSetting('dividerColour', '', (v): v is string => typeof v === 'string' && (v === '' || /^#[0-9a-f]{6}$/i.test(v)))
/** The changes of a text that are not saved are kept for the next start (a hot exit): the window closes without asking, and the tabs come back with their changes. Off: the window asks. */
export const hotExit = createSetting('hotExit', true, isBoolean)
/** Hidden files and folders (a name that starts with a dot) are shown in the tree. Off by default, as in a file manager. */
export const showHidden = createSetting('showHidden', false, isBoolean)
/** What the files of a folder are ordered by (folders stay first): the name, the date they changed, or the size. */
export const sortKey = createSetting<SortKey>('sortKey', 'name', (v): v is SortKey => v === 'name' || v === 'modified' || v === 'size')
/** The order of the key turned round: Z to A, the newest and the largest first. */
export const sortDescending = createSetting('sortDescending', false, isBoolean)
/** Source files that a formatter can lay out again (HTML, CSS, JavaScript, JSON, XML) are shown formatted. On by default: a saved page is usually minified. */
export const formatSource = createSetting('formatSource', true, isBoolean)
/** Two files compared are shown next to each other or in one column: the last choice is kept (side by side at first). */
export const diffLayout = createSetting<'side' | 'inline'>('diffLayout', 'side', (v): v is 'side' | 'inline' => v === 'side' || v === 'inline')
/** The long stretches of lines that are the same in a comparison are folded (the lines around a change stay). On by default. */
export const diffCollapse = createSetting('diffCollapse', true, isBoolean)
