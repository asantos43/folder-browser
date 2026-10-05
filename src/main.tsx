import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from './i18n/context.tsx'
import { resolveLanguage, useLanguageSetting } from './state/language.ts'
import { applyInitialTheme } from './theme/theme.ts'
import { Workbench } from './workbench/Workbench.tsx'
import './index.css'

applyInitialTheme()

/** The language is the user's choice in Settings, or the system's; the page's own `lang` follows it. */
function App() {
  const [setting] = useLanguageSetting()
  const language = resolveLanguage(setting)
  document.documentElement.lang = language
  return (
    <I18nProvider language={language}>
      <Workbench />
    </I18nProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
