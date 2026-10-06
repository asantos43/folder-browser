import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { renderGuide } from './guideMarkdown.ts'

/** The user guide, in the language of the interface, read from the build (`dist/guide/`) by the interface's own scheme: no network. */
export function GuideView({ zoom = 1 }: { zoom?: number }) {
  const { t, language } = useI18n()
  const [state, setState] = useState<{ language: string; text: string } | 'failed' | null>(null)
  useEffect(() => {
    let alive = true
    const file = language === 'pt-BR' ? 'USER-GUIDE.pt-BR.md' : 'USER-GUIDE.md'
    setState(null)
    fetch(`./guide/${file}`)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((text) => alive && setState({ language, text }))
      .catch(() => alive && setState('failed'))
    return () => {
      alive = false
    }
  }, [language])
  const html = useMemo(() => (state && state !== 'failed' ? renderGuide(state.text) : ''), [state])

  const onClick = (event: MouseEvent<HTMLElement>) => {
    const link = event.target instanceof Element ? event.target.closest('a') : null
    if (!link) return
    event.preventDefault()
    const href = link.getAttribute('href')
    if (!href) return
    // A link inside the guide scrolls to its heading; one to the web opens in the browser.
    if (href.startsWith('#')) event.currentTarget.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView?.({ block: 'start' })
    else void window.fb?.openExternal(href)
  }

  if (state === 'failed') return <p className="m-0 p-6 text-fg-muted">{t('guide.failed')}</p>
  if (!state) return <p className="m-0 p-6 text-fg-muted">{t('guide.loading')}</p>
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-editor text-editor-fg select-text" style={{ '--wsnp-zoom': zoom } as CSSProperties}>
      <article className="markdown-body" aria-label={t('guide.title')} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
