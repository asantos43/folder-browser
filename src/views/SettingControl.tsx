import type { ComponentType } from 'react'
import type { SettingDefinition, SettingType } from '@core/settings/registry.ts'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { RunCommandsControl } from './RunCommandsControl.tsx'

type Props = { definition: SettingDefinition; value: unknown; label: string; set: (value: unknown) => void }
const control = 'h-[26px] rounded-sm border border-group-border bg-editor px-2 text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus'
function BooleanControl({ value, label, set }: Props) {
  return <label className="flex items-center gap-2"><input type="checkbox" checked={value === true} onChange={event => set(event.target.checked)} />{label}</label>
}
function ChoiceControl({ definition, value, label, set }: Props) {
  const { t } = useI18n()
  return <select aria-label={label} value={String(value)} onChange={event => set(definition.choices?.find(choice => String(choice) === event.target.value))} className={control}>
    {definition.choices?.map((choice, index) => <option key={index} value={String(choice)}>{definition.choiceLabels?.[index] ? t(definition.choiceLabels[index] as MessageKey) : String(choice)}</option>)}
  </select>
}
function NumberControl({ definition, value, label, set }: Props) {
  return <input type="number" aria-label={label} value={Number(value)} min={definition.min} max={definition.max} className={control} onChange={event => {
    const next = event.target.valueAsNumber
    if (Number.isFinite(next) && (definition.min === undefined || next >= definition.min) && (definition.max === undefined || next <= definition.max)) set(next)
  }} />
}
function StringControl({ value, label, set }: Props) {
  return <input aria-label={label} value={String(value)} onChange={event => set(event.target.value)} className={control} />
}
function ColourControl({ value, label, set }: Props) {
  const { t } = useI18n()
  return <div className="flex items-center gap-2"><input type="color" aria-label={label} value={String(value || '#3c3c3c')} onChange={event => set(event.target.value)} className="h-[26px] w-[44px] cursor-pointer rounded-sm border border-group-border bg-editor p-0.5" /><button type="button" disabled={value === ''} onClick={() => set('')} className={`${control} cursor-pointer disabled:opacity-40`}>{t('settings.dividerReset')}</button></div>
}
function ListControl({ value, label, set }: Props) {
  return <textarea aria-label={label} value={(value as string[]).join('\n')} onChange={event => set(event.target.value === '' ? [] : event.target.value.split('\n'))} className={`${control} h-auto`} />
}
const controls: Record<SettingType, ComponentType<Props>> = { boolean: BooleanControl, choice: ChoiceControl, number: NumberControl, string: StringControl, colour: ColourControl, list: ListControl }
export function SettingControl(props: Props) {
  if (props.definition.id === 'files.openWithCommands') return <RunCommandsControl value={props.value} set={props.set} />
  const Control = controls[props.definition.type]
  return <Control {...props} />
}
