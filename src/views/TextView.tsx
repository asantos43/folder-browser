import { FORMATTABLE, type Language } from '@core/filekind.ts'
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { fileTarget } from '@/find/types.ts'
import { shortcut } from '@/workbench/commands.ts'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { formatSource as formatSetting, wordWrap } from '@/state/setting.ts'
import { shownText } from '@/state/shown.ts'
import { CodeView } from './CodeView.tsx'
import { canFormat, formatSource } from './format.ts'
import { FileActions, SaveButton, Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'

/**
 * A text file of the snapshot in a tab: source with the colours of its language, a toolbar with **Format** (HTML, CSS, JavaScript, JSON and XML laid
 * out for reading, which a saved page badly needs, as against as they were saved), **Word Wrap** (Alt+Z) and Save As, and the language and the
 * number of lines. Both switches are settings of the whole application, kept on this computer.
 */
export function TextView({ text, language, size, onSave, onOpenWith, onHex, leading, notice, zoom = 1 }: { /** Why this file is shown and not edited (a file of a folder that cannot be edited). */ notice?: string; text: string; language: Language; size: number; onSave: () => void; onOpenWith?: () => void; onHex?: () => void; /** Buttons at the start of the toolbar (the SVG's switch to the picture). */ leading?: ReactNode; /** The zoom of this tab: the text is drawn at that scale. */ zoom?: number }) {
  const { t } = useI18n()
  const wrap = wordWrap.use()
  const formatOn = formatSetting.use()
  const formattable = FORMATTABLE.includes(language)
  const fits = canFormat(language, size)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [laidOut, setLaidOut] = useState<{ source: string; text: string } | null>(null)

  // The laid-out text is made when it is wanted, once for a file.
  useEffect(() => {
    if (!formatOn || !fits || laidOut?.source === text) return
    let alive = true
    void formatSource(text, language).then((formatted) => alive && setLaidOut({ source: text, text: formatted }))
    return () => {
      alive = false
    }
  }, [formatOn, fits, text, language, laidOut])

  const shown = formatOn && fits && laidOut?.source === text ? laidOut.text : text
  const working = formatOn && fits && laidOut?.source !== text
  const lines = useMemo(() => shown.split('\n').length - (shown.endsWith('\n') ? 1 : 0), [shown])

  useEffect(() => shownText.set(() => shown), [shown])

  // Alt+Z, as in VS Code, while a file is in front.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        wordWrap.set(!wordWrap.get())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A right click offers what the editor's own menu would: Select All and Copy (the editor draws only some lines, so it answers for itself).
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const selected = fileTarget.get()?.selectedText?.() ?? ''
    setMenu({
      x: event.clientX,
      y: event.clientY,
      label: t('menu.edit'),
      entries: [
        { id: 'selectAll', label: t('context.selectAll'), shortcut: shortcut('Ctrl+A'), run: () => fileTarget.get()?.selectAll?.() },
        { id: 'copy', label: t('menu.copy'), shortcut: shortcut('Ctrl+C'), disabled: !selected, run: () => void window.fb?.copyText(selected) },
      ],
    })
  }

  const status = !formattable ? null : !fits ? t('text.tooBig') : working ? t('text.formatting') : formatOn ? t('text.formatted') : t('text.original')
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        {leading}
        {formattable ? <ToolbarButton icon="list-flat" text={t('text.format')} label={t('text.formatTitle')} pressed={formatOn && fits} disabled={!fits} onClick={() => formatSetting.set(!formatOn)} /> : null}
        <ToolbarButton icon="word-wrap" text={t('text.wordWrap')} label={t('text.wordWrapTitle')} pressed={wrap} onClick={() => wordWrap.set(!wrap)} />
        <Separator />
        <SaveButton label={t('file.saveAs')} onClick={onSave} />
        <FileActions onOpenWith={onOpenWith} onHex={onHex} />
        <span className="ml-auto flex items-center gap-3 pr-1 text-[12px] text-fg-muted">
          {notice ? <span>{notice}</span> : null}
          {status ? <span aria-live="polite">{status}</span> : null}
          <span>{t('text.lines', { count: lines })}</span>
          <span>{t(`text.language.${language}` as MessageKey)}</span>
        </span>
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col" onContextMenu={onContextMenu} style={{ '--wsnp-zoom': zoom } as CSSProperties}>
        <CodeView text={shown} language={language} wrap={wrap} zoom={zoom} />
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
