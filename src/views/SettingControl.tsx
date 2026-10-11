import { useSyncExternalStore, type ComponentType } from 'react'
import type { SettingDefinition, SettingType } from '@core/settings/registry.ts'
import { useI18n } from '@/i18n/context.tsx'
import { i18nRegistry, type MessageKey } from '@/i18n/index.ts'
import { RunCommandsControl } from './RunCommandsControl.tsx'
import { ThemePicker } from './ThemePicker.tsx'

type Props = { definition: SettingDefinition; value: unknown; label: string; set: (value: unknown) => void; disabled?: boolean }
const control = 'h-[26px] rounded-sm border border-group-border bg-editor px-2 text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus'
/** Owner dictionaries cannot borrow app keys or another plugin's text. */
export function ownerText(owner: string, raw: string): string {
  const scoped = `${owner}.${raw}`
  const resolved = i18nRegistry.resolve(scoped)
  return resolved && resolved !== scoped ? resolved : raw
}
function BooleanControl({ value, label, set, disabled }: Props) {
  return <label className="flex items-center gap-2"><input type="checkbox" disabled={disabled} checked={value === true} onChange={event => set(event.target.checked)} />{label}</label>
}
function ChoiceControl({ definition, value, label, set, disabled }: Props) {
  const { t } = useI18n()
  useSyncExternalStore(i18nRegistry.subscribe, i18nRegistry.version)
  if (definition.id === 'system.language') {
    const options = i18nRegistry.listAvailableLanguages()
    const unavailable = value !== 'auto' && !options.some(option => option.language === value)
    return <div>
      <select disabled={disabled} aria-label={label} value={String(value)} onChange={event => set(event.target.value)} className={control}>
        <option value="auto">{t('settings.languageAuto')}</option>
        {options.map(option => <option key={option.language} value={option.language}>{option.label}</option>)}
        {unavailable && <option value={String(value)} disabled>{String(value)} — {t('settings.languageUnavailable')}</option>}
      </select>
      {unavailable && <p role="status">{t('settings.languageUnavailableHint', { language: String(value) })}</p>}
    </div>
  }
  return <select disabled={disabled} aria-label={label} value={String(value)} onChange={event => set(definition.choices?.find(choice => String(choice) === event.target.value))} className={control}>
    {definition.choices?.map((choice, index) => <option key={index} value={String(choice)}>{definition.choiceLabels?.[index] ? definition.owner ? ownerText(definition.owner.id, definition.choiceLabels[index]) : t(definition.choiceLabels[index] as MessageKey) : String(choice)}</option>)}
  </select>
}
function NumberControl({ definition, value, label, set, disabled }: Props) {
  return <input disabled={disabled} type="number" aria-label={label} value={Number(value)} min={definition.min} max={definition.max} className={control} onChange={event => {
    const next = event.target.valueAsNumber
    if (Number.isFinite(next) && (definition.min === undefined || next >= definition.min) && (definition.max === undefined || next <= definition.max)) set(next)
  }} />
}
function StringControl({ value, label, set, disabled }: Props) {
  return <input disabled={disabled} aria-label={label} value={String(value)} onChange={event => set(event.target.value)} className={control} />
}
function ColourControl({ value, label, set, disabled }: Props) {
  const { t } = useI18n()
  return <div className="flex items-center gap-2"><input disabled={disabled} type="color" aria-label={label} value={String(value || '#3c3c3c')} onChange={event => set(event.target.value)} className="h-[26px] w-[44px] cursor-pointer rounded-sm border border-group-border bg-editor p-0.5" /><button type="button" disabled={disabled || value === ''} onClick={() => set('')} className={`${control} cursor-pointer disabled:opacity-40`}>{t('settings.dividerReset')}</button></div>
}
function ListControl({ value, label, set, disabled }: Props) {
  return <textarea disabled={disabled} aria-label={label} value={(value as string[]).join('\n')} onChange={event => set(event.target.value === '' ? [] : event.target.value.split('\n'))} className={`${control} h-auto`} />
}
const controls: Record<SettingType, ComponentType<Props>> = { boolean: BooleanControl, choice: ChoiceControl, number: NumberControl, string: StringControl, colour: ColourControl, list: ListControl }
export function SettingControl(props: Props) {
  if (props.definition.id === 'files.openWithCommands') return <RunCommandsControl value={props.value} set={props.set} />
  if (props.definition.id === 'appearance.themePlugin') return <ThemePicker value={props.value} set={value => props.set(value)} />
  const Control = controls[props.definition.type]
  const disabled = props.definition.owner?.enabled === false
  return <Control {...props} disabled={disabled} set={disabled ? () => {} : props.set} />
}
