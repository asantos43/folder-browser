import type { SettingsRegistry } from './registry.ts'
import type { SettingsStore } from './store.ts'

export type ImportChange = { id: string; before: unknown; after: unknown; reason?: string; warning?: string; needsConfirm: boolean }
export type ImportPreview = { changes: ImportChange[] }
export function exportSettings(store: SettingsStore): string { return JSON.stringify(store.exportObject(), null, 2) }
export function previewImport(json: string, registry: SettingsRegistry, store: SettingsStore): ImportPreview {
  let input: unknown
  try { input = JSON.parse(json) } catch { throw new Error('Invalid settings JSON') }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings import must be an object')
  const flat = input as Record<string, unknown>
  const changes: ImportChange[] = []
  for (const [id, raw] of Object.entries(flat)) {
    const def = registry.get(id)
    if (!def) { changes.push({id,before:undefined,after:raw,reason:'Unknown setting',needsConfirm:false}); continue }
    const normalized = def.normalize?.(raw)
    const after = normalized ? normalized.value : raw
    const before = store.get(id)
    if (!registry.validate(id, after)) changes.push({id,before,after,reason:'Invalid value',needsConfirm:false})
    else if (JSON.stringify(before) !== JSON.stringify(after) || normalized?.warning) changes.push({id,before,after,warning:normalized?.warning,needsConfirm:def.safety === true})
  }
  return { changes }
}
export async function applyImport(preview: ImportPreview, store: SettingsStore, confirmed = false): Promise<void> {
  for (const change of preview.changes) {
    if (change.reason) continue
    if (change.needsConfirm && !confirmed) throw new Error(`Confirmation required for ${change.id}`)
  }
  for (const change of preview.changes) if (!change.reason) store.set(change.id, change.after)
  await store.flush()
}
