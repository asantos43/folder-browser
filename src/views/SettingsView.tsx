import { useState, type ReactNode } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { LANGUAGE_NAMES, type Language } from '@/i18n/index.ts'
import { setLanguageSetting, useLanguageSetting, type LanguageSetting } from '@/state/language.ts'
import { formatSource, reopenSession, wordWrap } from '@/state/setting.ts'
import type { ThemeSetting } from '@/theme/theme.ts'

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

/**
 * Settings, in a tab as VS Code has it: language and colour theme, with a box that filters them. The
 * choices are kept on this computer and take effect at once.
 */
export function SettingsView({ theme, setTheme }: { theme: ThemeSetting; setTheme: (theme: ThemeSetting) => void }) {
  const { t } = useI18n()
  const [language] = useLanguageSetting()
  const [query, setQuery] = useState('')
  const matches = (...words: string[]) => !query.trim() || words.join(' ').toLowerCase().includes(query.trim().toLowerCase())

  const theme$ = matches(t('settings.colorTheme'), t('settings.themeHint'), 'theme dark light', t('settings.themeDark'), t('settings.themeLight'))
  const language$ = matches(t('settings.language'), t('settings.languageHint'), 'language idioma', ...Object.values(LANGUAGE_NAMES))
  const wrap = wordWrap.use()
  const format = formatSource.use()
  const reopen = reopenSession.use()
  const startup$ = matches(t('settings.startup'), t('settings.reopen'), t('settings.reopenHint'), 'restore session reopen startup')
  const editor$ = matches(t('settings.editor'), t('settings.wordWrap'), t('settings.wordWrapHint'), t('settings.formatSource'), t('settings.formatSourceHint'), 'wrap format pretty minified')
  const privacy$ = matches(t('settings.privacy'), t('settings.privacyText'), 'privacy network')

  return (
    <div aria-label={t('settings.title')} className="h-full min-h-0 flex-1 overflow-auto bg-editor p-6 text-editor-fg select-text">
      <div className="mx-auto max-w-[720px]">
        <input
          type="search"
          aria-label={t('settings.search')}
          placeholder={t('settings.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${control} mb-5 w-full`}
        />
        {theme$ || language$ ? <h2 className="m-0 mb-3 border-b border-group-border pb-1 text-[13px] font-bold uppercase text-fg-muted">{t('settings.appearance')}</h2> : null}
        {theme$ ? (
          <Setting title={t('settings.colorTheme')} hint={t('settings.themeHint')}>
            <select aria-label={t('settings.colorTheme')} value={theme} onChange={(e) => setTheme(e.target.value as ThemeSetting)} className={control}>
              <option value="auto">{t('settings.themeAuto')}</option>
              <option value="dark">{t('settings.themeDark')}</option>
              <option value="light">{t('settings.themeLight')}</option>
            </select>
          </Setting>
        ) : null}
        {language$ ? (
          <Setting title={t('settings.language')} hint={t('settings.languageHint')}>
            <select aria-label={t('settings.language')} value={language} onChange={(e) => setLanguageSetting(e.target.value as LanguageSetting)} className={control}>
              <option value="auto">{t('settings.languageAuto')}</option>
              {(Object.keys(LANGUAGE_NAMES) as Language[]).map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_NAMES[code]}
                </option>
              ))}
            </select>
          </Setting>
        ) : null}
        {startup$ ? (
          <>
            <h2 className="m-0 mb-3 border-b border-group-border pb-1 text-[13px] font-bold uppercase text-fg-muted">{t('settings.startup')}</h2>
            <Setting title={t('settings.reopen')} hint={t('settings.reopenHint')}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={reopen} onChange={(e) => reopenSession.set(e.target.checked)} />
                {t('settings.reopen')}
              </label>
            </Setting>
          </>
        ) : null}
        {editor$ ? (
          <>
            <h2 className="m-0 mb-3 border-b border-group-border pb-1 text-[13px] font-bold uppercase text-fg-muted">{t('settings.editor')}</h2>
            <Setting title={t('settings.wordWrap')} hint={t('settings.wordWrapHint')}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={wrap} onChange={(e) => wordWrap.set(e.target.checked)} />
                {t('settings.wordWrap')}
              </label>
            </Setting>
            <Setting title={t('settings.formatSource')} hint={t('settings.formatSourceHint')}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={format} onChange={(e) => formatSource.set(e.target.checked)} />
                {t('settings.formatSource')}
              </label>
            </Setting>
          </>
        ) : null}
        {privacy$ ? (
          <>
            <h2 className="m-0 mb-3 border-b border-group-border pb-1 text-[13px] font-bold uppercase text-fg-muted">{t('settings.privacy')}</h2>
            <p className="m-0 text-[13px] text-fg-muted">{t('settings.privacyText')}</p>
          </>
        ) : null}
        {!theme$ && !language$ && !startup$ && !editor$ && !privacy$ ? <p className="m-0 text-fg-muted">{t('settings.noMatch', { query: query.trim() })}</p> : null}
      </div>
    </div>
  )
}
