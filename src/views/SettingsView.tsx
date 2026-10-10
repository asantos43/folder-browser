import { memo, useDeferredValue, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey, Translate } from '@/i18n/index.ts'
import { resetSettings, settingFor } from '@/state/setting.ts'
import type { ThemeSetting } from '@/theme/theme.ts'
import { settingsRegistry, type SettingDefinition } from '@core/settings/registry.ts'
import '@core/settings/builtin.ts'
import { SettingControl } from './SettingControl.tsx'
import { SettingsRows } from './SettingsRows.tsx'

function Setting({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="m-0 mb-1 text-[13px] font-bold">{title}</h3>
      <p className="m-0 mb-2 text-[12px] text-fg-muted">{hint}</p>
      {children}
    </div>
  )
}

const control = 'h-[26px] rounded-sm border border-group-border bg-editor px-2 text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus'

export const normalizeSearch = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export const modified = (definition: SettingDefinition, value: unknown): boolean => JSON.stringify(value) !== JSON.stringify(definition.default)
const text = (t: Translate, key: string | null | undefined): string => key ? t(key as MessageKey) || key : ''
export type SearchEntry = { definition: SettingDefinition; search: string }
export function indexSettings(definitions: readonly SettingDefinition[], t: Translate): SearchEntry[] {
  return definitions.filter(d => d.label !== null).map(definition => ({ definition, search: normalizeSearch([text(t, definition.label), text(t, definition.description), ...(definition.keywords ?? []).map(key => text(t, key))].join(' ')) }))
}
export function filterSettings(entries: readonly SearchEntry[], query: string, onlyModified: boolean, values: Record<string, unknown>): SettingDefinition[] {
  const needle = normalizeSearch(query.trim())
  return entries.filter(entry => entry.search.includes(needle) && (!onlyModified || modified(entry.definition, values[entry.definition.id]))).map(entry => entry.definition)
}

const SettingsList = memo(function SettingsList({ entries, query, onlyModified, values }: { entries: SearchEntry[]; query: string; onlyModified: boolean; values: Record<string, unknown> }) {
  const { t } = useI18n()
  const visible = filterSettings(entries, query, onlyModified, values)
  const privacyMatches = !onlyModified && (!query.trim() || normalizeSearch(`${t('settings.privacy')} ${t('settings.privacyText')}`).includes(normalizeSearch(query.trim())))
  const categoryOf = (definition: SettingDefinition) => definition.id.includes(':') ? `${t('settings.plugins')} ▸ ${definition.id.split(':')[0]}` : text(t, definition.categoryLabel ?? `settings.${definition.category}`)
  const groups = new Map<string, SettingDefinition[]>()
  for (const definition of visible) {
    const plugin = definition.id.includes(':') ? definition.id.split(':')[0] : undefined
    const category = plugin ? `${t('settings.plugins')} ▸ ${plugin}` : text(t, definition.categoryLabel ?? `settings.${definition.category}`)
    const group = groups.get(category) ?? []
    group.push(definition)
    groups.set(category, group)
  }
  return <>
    {[...groups].map(([category, definitions]) => <section key={category} aria-label={category}>
      <div className="mb-3 flex items-center justify-between border-b border-group-border pb-1">
        <h2 className="m-0 text-[13px] font-bold uppercase text-fg-muted">{category}</h2>
        <button type="button" className={control} disabled={!entries.some(({ definition: d }) => categoryOf(d) === category && modified(d, values[d.id]))} onClick={() => {
          // Reset the whole section, including rows hidden by search.
          resetSettings(entries.map(entry => entry.definition).filter(d => categoryOf(d) === category))
        }}>{t('settings.resetSection')}</button>
      </div>
      <SettingsRows key={`${category}:${query}:${onlyModified}`} definitions={definitions}>{definition => {
        const value = values[definition.id]
        const changed = modified(definition, value)
        const title = text(t, definition.label)
        return <Setting title={title} hint={text(t, definition.description)}>
            <div className="flex items-center gap-2">
              <SettingControl definition={definition} value={value} label={title} set={settingFor(definition).set} />
              {changed ? <span className="text-[12px] text-fg-muted">{t('settings.modified')}</span> : null}
              <button type="button" className={control} disabled={!changed} onClick={() => settingFor(definition).reset()}>{t('settings.reset')}</button>
            </div>
            {definition.restart ? <p className="text-[12px] text-fg-muted">{t('settings.restart')}</p> : null}
          </Setting>
      }}</SettingsRows>
    </section>)}
    {!visible.length && !privacyMatches ? <p className="m-0 text-fg-muted">{t('settings.noMatch', { query: query.trim() })}</p> : null}
    {privacyMatches ? <section aria-label={t('settings.privacy')}>
      <h2 className="m-0 mb-3 border-b border-group-border pb-1 text-[13px] font-bold uppercase text-fg-muted">{t('settings.privacy')}</h2>
      <p className="m-0 text-[13px] text-fg-muted">{t('settings.privacyText')}</p>
    </section> : null}
  </>
})

/** Categories and controls come exclusively from the registry; urgent typing skips the memoized list. */
export function SettingsView(_props: { theme: ThemeSetting; setTheme: (theme: ThemeSetting) => void }) {
  const { t } = useI18n()
  const revision = useSyncExternalStore(settingsRegistry.subscribe, settingsRegistry.version)
  const entries = useMemo(() => indexSettings(settingsRegistry.all(), t), [revision, t])
  const stores = useMemo(() => entries.map(({ definition }) => settingFor(definition)), [entries])
  const subscription = useMemo(() => (listener: () => void) => {
    const removals = stores.map(store => store.subscribe(listener))
    return () => removals.forEach(remove => remove())
  }, [stores])
  const snapshot = useSyncExternalStore(subscription, () => JSON.stringify(Object.fromEntries(entries.map(({ definition }, index) => [definition.id, stores[index].get()]))))
  const values = useMemo(() => JSON.parse(snapshot) as Record<string, unknown>, [snapshot])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [onlyModified, setOnlyModified] = useState(false)
  return <div data-settings-page aria-label={t('settings.title')} className="h-full min-h-0 flex-1 overflow-auto bg-editor p-6 text-editor-fg select-text">
    <div className="mx-auto max-w-[720px]">
      <input type="search" aria-label={t('settings.search')} placeholder={t('settings.search')} value={query} onChange={event => setQuery(event.target.value)} className={`${control} mb-5 w-full`} />
      <label className="mb-5 flex items-center gap-2"><input type="checkbox" role="switch" checked={onlyModified} onChange={event => setOnlyModified(event.target.checked)} />{t('settings.onlyModified')}</label>
      <SettingsList entries={entries} query={deferredQuery} onlyModified={onlyModified} values={values} />
    </div>
  </div>
}
