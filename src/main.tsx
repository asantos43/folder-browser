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

// The plugin runtime is loaded dynamically after the first render: it pulls
// the plugin generation from the main process and applies it to the renderer
// registries (themes, locales, languages, settings definitions). The first
// paint must not wait on it; a failure is logged without disturbing the app.
// The runtime itself coalesces commits per animation frame, so a single
// `requestIdleCallback` (with a setTimeout fallback) is enough.
if (typeof window !== 'undefined' && window.fb?.plugins) {
  const idle = (typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0))
  idle(() => {
    import('./plugins/runtime.ts')
      .then(module => { module.startPluginRuntime() })
      .catch(() => { console.error('plugin runtime failed to load') })
  })
}
