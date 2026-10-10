import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx'
import { registry } from '@/workbench/commands.ts'
import { builtinKeyCommands } from '@core/commands/builtin.ts'
import { isReserved } from '@core/keys/reserved.ts'
import { formatChord } from '@core/keys/chord.ts'
import { mergeUserKeys, type KeysSnapshot, type KeysPortableResult, type UserKey } from '@core/keys/user.ts'
import { filterKeyboard, indexKeyboard, recordedChord, replaceCommand, restoreCommand, type KeyboardEntry } from './keyboardModel.ts'

const control = 'rounded-sm border border-group-border bg-editor px-2 py-1 text-[13px] focus-visible:outline-1 focus-visible:outline-focus'
const PAGE_SIZE = 40
const KeyboardList = memo(function KeyboardList({ entries, query, onlyModified, busy, record, remove, restore }: { entries: KeyboardEntry[]; query: string; onlyModified: boolean; busy: boolean; record: (id: string) => void; remove: (id: string) => void; restore: (id: string) => void }) {
  const { t } = useI18n()
  const visible = useMemo(() => filterKeyboard(entries, query, onlyModified), [entries, query, onlyModified])
  const [page, setPage] = useState(0)
  const current = Math.min(page, Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1))
  useEffect(() => setPage(0), [query, onlyModified])
  return <>
    <ul aria-label={t('keyboard.title')} className="m-0 list-none p-0">
      {visible.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(entry => <li key={entry.id} data-key-command={entry.id} tabIndex={0} className="mb-2 border-b border-group-border py-2 focus-visible:outline-1 focus-visible:outline-focus">
        <div className="flex flex-wrap items-center gap-2"><strong>{entry.title}</strong><span>{entry.category}</span><code>{entry.key || t('keyboard.unassigned')}</code>{entry.changed ? <span>{t('settings.modified')}</span> : null}</div>
        <div className="mt-1 flex flex-wrap gap-2"><span className="text-fg-muted">{entry.id}</span>
          <button className={control} disabled={busy} onClick={() => record(entry.id)}>{t('keyboard.record')}</button>
          <button className={control} disabled={busy || !entry.key} onClick={() => remove(entry.id)}>{t('keyboard.remove')}</button>
          <button className={control} disabled={busy || !entry.changed} onClick={() => restore(entry.id)}>{t('settings.reset')}</button>
        </div>
      </li>)}
    </ul>
    {!visible.length ? <p>{t('settings.noMatch', { query })}</p> : null}
    {visible.length > PAGE_SIZE ? <nav aria-label={t('keyboard.pages')} className="flex gap-2">
      <button className={control} disabled={!current} onClick={() => setPage(current - 1)}>{t('keyboard.previous')}</button>
      <span>{current + 1} / {Math.ceil(visible.length / PAGE_SIZE)}</span>
      <button className={control} disabled={(current + 1) * PAGE_SIZE >= visible.length} onClick={() => setPage(current + 1)}>{t('keyboard.next')}</button>
    </nav> : null}
  </>
})

export function KeyboardPanel() {
  const { t } = useI18n()
  const api = window.fb?.keys
  const mac = window.fb?.platform === 'darwin'
  const [snapshot, setSnapshot] = useState<KeysSnapshot>(() => api?.get() ?? { entries: [], warnings: [] })
  useEffect(() => api?.onChanged(setSnapshot), [api])
  const entries = useMemo(() => indexKeyboard(registry.list(), snapshot.entries, mac, key => t(key as MessageKey) || key), [snapshot, mac, t])
  const [query, setQuery] = useState(''), deferred = useDeferredValue(query)
  const [onlyModified, setOnlyModified] = useState(false)
  const [recording, setRecording] = useState<string>()
  const [candidate, setCandidate] = useState<{ id: string; key: string; entries: UserKey[]; conflicts: string[] }>()
  const [preview, setPreview] = useState<Extract<KeysPortableResult, { preview: unknown }>>()
  const [reset, setReset] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const focus = useRef<HTMLElement | null>(null)
  // The recorder must not restart (and let the native shortcuts back for a moment) when the file is reread or the language changes.
  const latest = useRef({ entries: snapshot.entries, t })
  latest.current = { entries: snapshot.entries, t }
  const finish = () => { setRecording(undefined); focus.current?.focus() }
  const run = async (action: () => Promise<KeysPortableResult>) => {
    setBusy(true); setError('')
    try {
      const result = await action()
      if ('error' in result) setError(result.error)
      else if ('preview' in result) setPreview(result)
      else if ('ok' in result && !result.ok) setError(result.warnings.map(warning => warning.message).join('; '))
      if (api) setSnapshot(api.get())
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false); focus.current?.focus() }
  }
  // A layout effect: when "Recording" is on screen the recorder and the main process are already listening.
  useLayoutEffect(() => {
    if (!recording) return
    api?.recording(true)
    const capture = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.key === 'Escape') { finish(); return }
      if (event.repeat || event.isComposing) return
      const key = recordedChord({ key: event.key, control: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }, mac)
      if (!key) return
      if (isReserved(key, mac)) { setError(latest.current.t('keyboard.reserved')); return }
      const next = replaceCommand(latest.current.entries, recording, key, mac)
      const conflicts = mergeUserKeys(builtinKeyCommands, next, mac).conflicts.filter(conflict => conflict.commands.includes(recording)).flatMap(conflict => conflict.commands.filter(id => id !== recording))
      setCandidate({ id: recording, key, entries: next, conflicts }); setRecording(undefined); setError('')
    }
    window.addEventListener('keydown', capture, true)
    window.addEventListener('blur', finish)
    return () => { window.removeEventListener('keydown', capture, true); window.removeEventListener('blur', finish); api?.recording(false) }
  }, [recording, mac, api])
  const commandTitle = (id: string) => entries.find(entry => entry.id === id)?.title ?? id
  return <section aria-label={t('keyboard.title')}>
    <div role="toolbar" aria-label={t('keyboard.title')} className="mb-4 flex gap-2">
      <button className={control} disabled={busy || !!recording || !api} onClick={() => void run(() => api!.export())}>{t('settings.export')}</button>
      <button className={control} disabled={busy || !!recording || !api} onClick={() => void run(() => api!.previewImport())}>{t('settings.import')}</button>
      <button className={control} disabled={busy || !!recording || !snapshot.entries.length} onClick={() => setReset(true)}>{t('settings.resetAll')}</button>
    </div>
    <input type="search" className={`${control} mb-3 w-full`} aria-label={t('keyboard.search')} placeholder={t('keyboard.search')} value={query} onChange={event => setQuery(event.target.value)} />
    <label className="mb-3 flex gap-2"><input type="checkbox" checked={onlyModified} onChange={event => setOnlyModified(event.target.checked)} />{t('settings.onlyModified')}</label>
    <p role="status" aria-live="polite">{recording ? t('keyboard.recording', { command: commandTitle(recording) }) : ''}</p>
    {recording ? <button className={control} onClick={finish}>{t('confirm.cancel')}</button> : null}
    {error ? <p role="alert">{error}</p> : null}
    {snapshot.warnings.map((warning, index) => <p role="alert" key={index}>{t('keyboard.warning', { entry: warning.entry + 1, message: warning.message })}</p>)}
    <KeyboardList entries={entries} query={deferred} onlyModified={onlyModified} busy={busy || !!recording || !api} record={id => { focus.current = document.activeElement as HTMLElement; setError(''); setRecording(id) }} remove={id => void run(() => api!.set(replaceCommand(snapshot.entries, id, undefined, mac)))} restore={id => void run(() => api!.set(restoreCommand(snapshot.entries, id)))} />
    {candidate ? <ConfirmDialog danger title={t('keyboard.record')} message={`${commandTitle(candidate.id)}: ${formatChord(candidate.key, mac)}`} details={candidate.conflicts.length ? <p data-key-conflicts>{t('keyboard.conflicts', { commands: candidate.conflicts.map(commandTitle).join(', ') })}</p> : null} confirmLabel={t('settings.apply')} onCancel={() => { setCandidate(undefined); focus.current?.focus() }} onConfirm={() => { const next = candidate.entries; setCandidate(undefined); void run(() => api!.set(next)) }} /> : null}
    {reset ? <ConfirmDialog danger title={t('settings.resetAll')} message={t('keyboard.resetAllConfirm')} confirmLabel={t('settings.resetAll')} onCancel={() => setReset(false)} onConfirm={() => { setReset(false); void run(() => api!.set([])) }} /> : null}
    {preview ? <ConfirmDialog danger title={t('settings.importSummary')} message={t('keyboard.importHint')} details={<div className="max-h-[45vh] overflow-auto"><ul>{preview.preview.entries.map((entry, i) => <li key={i}>{`${entry.command}: ${entry.key}${entry.when ? ` (${entry.when})` : ''}`}</li>)}</ul>{preview.preview.warnings.map((warning, i) => <p key={i}>{t('keyboard.warning', { entry: warning.entry + 1, message: warning.message })}</p>)}{preview.preview.conflicts.map((conflict, i) => <p key={i}>{conflict.key}: {t('keyboard.conflicts', { commands: conflict.commands.map(commandTitle).join(', ') })}</p>)}</div>} confirmLabel={t('settings.apply')} onCancel={() => setPreview(undefined)} onConfirm={() => { const token = preview.token; setPreview(undefined); void run(() => api!.applyImport(token, true)) }} /> : null}
  </section>
}
