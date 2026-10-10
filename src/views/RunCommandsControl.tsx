import { useState } from 'react'
import { parseCommandTemplate, type RunCommand } from '@core/run.ts'
import { useI18n } from '@/i18n/context.tsx'

export function RunCommandsControl({ value, set }: { value: unknown; set: (value: unknown) => void }) {
  const { t } = useI18n()
  const commands = value as RunCommand[]
  const [draft, setDraft] = useState<RunCommand | null>(null)
  const [error, setError] = useState(false)
  const control = 'rounded-sm border border-group-border bg-editor px-2 text-[13px] text-fg'
  const edit = (command: RunCommand) => { setDraft({ ...command, args: [...command.args] }); setError(false) }
  return <div className="flex min-w-0 flex-col gap-2">
    {commands.map(command => <div key={command.id} className="flex items-center gap-2">
      <span>{command.name}</span>
      <button type="button" className={control} onClick={() => edit(command)}>{t('settings.runEdit')}</button>
      <button type="button" className={control} onClick={() => { set(commands.filter(c => c.id !== command.id)); if (draft?.id === command.id) setDraft(null) }}>{t('settings.runRemove')}</button>
    </div>)}
    <button type="button" className={control} disabled={commands.length >= 100} onClick={() => edit({ id: crypto.randomUUID(), name: '', program: '', args: [] })}>{t('settings.runAdd')}</button>
    {draft ? <div className="flex flex-col gap-2">
      <label>{t('settings.runName')}<input aria-label={t('settings.runName')} className={control} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>{t('settings.runProgram')}<input aria-label={t('settings.runProgram')} className={control} value={draft.program} onChange={e => setDraft({ ...draft, program: e.target.value })} /></label>
      <label>{t('settings.runArgs')}<textarea aria-label={t('settings.runArgs')} className={control} value={draft.args.join('\n')} onChange={e => setDraft({ ...draft, args: e.target.value === '' ? [] : e.target.value.split('\n') })} /></label>
      {error ? <p role="alert">{t('settings.runInvalid')}</p> : null}
      <div className="flex gap-2"><button type="button" className={control} onClick={() => {
        try { const command = parseCommandTemplate(draft); set([...commands.filter(c => c.id !== command.id), command]); setDraft(null); setError(false) } catch { setError(true) }
      }}>{t('settings.runSave')}</button><button type="button" className={control} onClick={() => setDraft(null)}>{t('openWith.cancelButton')}</button></div>
    </div> : null}
  </div>
}
