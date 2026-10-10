import type { SettingsRegistry } from './registry.ts'
import type { SettingsStore } from './store.ts'

export type ImportChange = { id: string; before: unknown; after: unknown; reason?: string; warning?: string; needsConfirm: boolean }
export type ImportPreview = { changes: ImportChange[]; needsConfirmation: ImportChange[] }
const previewRevisions = new WeakMap<ImportPreview, { store: SettingsStore; revision: number }>()
export function exportSettings(store: SettingsStore): string { return JSON.stringify(store.exportObject(), null, 2) }
export function previewImport(json: string, registry: SettingsRegistry, store: SettingsStore): ImportPreview {
  let input: unknown
  try { input = JSON.parse(json) } catch { throw new Error('Invalid settings JSON') }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings import must be an object')
  const flat = input as Record<string, unknown>
  store.prepareSettings()
  const changes: ImportChange[] = []
  for (const [id, raw] of Object.entries(flat)) {
    const def = registry.get(id)
    if (!def) { changes.push({id,before:undefined,after:raw,reason:'Unknown setting',needsConfirm:false}); continue }
    const normalized = def.normalize?.(raw)
    const after = normalized ? normalized.value : raw
    const before = store.get(id)
    if (!registry.validate(id, after)) changes.push({id,before,after,reason:'Invalid value',needsConfirm:false})
    else if (JSON.stringify(before) !== JSON.stringify(after) || normalized?.warning || def.reaches) changes.push({id,before,after,warning:normalized?.warning,needsConfirm:def.safety === true || def.reaches === true})
  }
  const preview = { changes, needsConfirmation: changes.filter(change => change.needsConfirm) }
  previewRevisions.set(preview, { store, revision: registry.version() })
  return preview
}
export async function applyImport(preview: ImportPreview, store: SettingsStore, confirmed = false): Promise<void> {
  for (const change of preview.changes) {
    if (change.reason) continue
    const def = store.definition(change.id)
    if ((change.needsConfirm || def?.safety || def?.reaches) && !confirmed) throw new Error(`Confirmation required for ${change.id}`)
    if (!def) throw new Error(`Unknown setting: ${change.id}`)
  }
  const issued = previewRevisions.get(preview)
  if (!issued || issued.store !== store || issued.revision !== store.registryVersion()) throw new Error('Settings preview expired; create a new preview')
  for (const change of preview.changes) if (!change.reason) store.set(change.id, change.after)
  await store.flush()
}
