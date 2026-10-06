import { useMemo, type CSSProperties, type MouseEvent } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { markdownView, markdownWide, markdownWrapCode } from '@/state/setting.ts'
import { renderMarkdown } from './markdown.ts'
import { FileActions, SaveButton, Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'

/** The two ways to see a Markdown file, side by side in the toolbar of either: formatted as it reads, or as the text it is written in. The choice is kept for every Markdown file. */
export function MarkdownToggle() {
  const { t } = useI18n()
  const view = markdownView.use()
  return (
    <>
      <ToolbarButton icon="preview" text={t('markdown.formatted')} label={t('markdown.formattedTitle')} pressed={view === 'formatted'} onClick={() => markdownView.set('formatted')} />
      <ToolbarButton icon="code" text={t('markdown.text')} label={t('markdown.textTitle')} pressed={view === 'text'} onClick={() => markdownView.set('text')} />
      <Separator />
    </>
  )
}

/** A Markdown file as a page: headings, lists, tables, code. A link to the web opens in the browser; nothing else in it is followed or loaded. */
export function MarkdownView({ text, onSave, onOpenWith, onHex, zoom = 1 }: { text: string; onSave: () => void; onOpenWith?: () => void; onHex?: () => void; zoom?: number }) {
  const { t } = useI18n()
  const wide = markdownWide.use()
  const wrapCode = markdownWrapCode.use()
  const html = useMemo(() => renderMarkdown(text), [text])
  const onClick = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest('a') : null
    if (!link) return
    event.preventDefault()
    const href = link.getAttribute('href')
    if (href) void window.fb?.openExternal(href)
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        <MarkdownToggle />
        <ToolbarButton icon="screen-full" text={t('markdown.wide')} label={t('markdown.wideTitle')} pressed={wide} onClick={() => markdownWide.set(!wide)} />
        <ToolbarButton icon="word-wrap" text={t('markdown.wrapCode')} label={t('markdown.wrapCodeTitle')} pressed={wrapCode} onClick={() => markdownWrapCode.set(!wrapCode)} />
        <Separator />
        <SaveButton label={t('file.saveAs')} onClick={onSave} />
        <FileActions onOpenWith={onOpenWith} onHex={onHex} />
        <span className="ml-auto flex items-center gap-3 pr-1 text-[12px] text-fg-muted">
          <span>{t('text.language.markdown')}</span>
        </span>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto bg-editor text-editor-fg select-text" style={{ '--wsnp-zoom': zoom } as CSSProperties}>
        {/* The HTML is made by markdown-it with raw HTML off, and its links and pictures are narrowed in `markdown.ts`. */}
        <article className={`markdown-body${wide ? ' wide' : ''}${wrapCode ? ' wrap-code' : ''}`} aria-label={t('markdown.formatted')} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
