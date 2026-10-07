import { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { createCodeFindTarget } from '@/find/code.ts'
import { fileTarget } from '@/find/types.ts'
import { useI18n } from '@/i18n/context.tsx'
import { editorBuffers, hasChanges, type EditorBuffer } from '@/state/editors.ts'
import { useGroup } from '@/state/groups.ts'
import { wordWrap } from '@/state/setting.ts'
import { shownText } from '@/state/shown.ts'
import { newUntitledBuffer } from '@/state/untitled.ts'
import { shortcut } from '@/workbench/commands.ts'
import { languageSlot, languageExtension, listenerSlot, wrapping } from './codeTheme.ts'
import { SaveButton, Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'

/**
 * A new text file (Ctrl+N): an editor whose text exists only in the window, as VS Code's Untitled. Paste a text in it to compare it with a file or to put it beside one; Save As… writes
 * it to a file, and a tab that has text asks before it closes, like any text with changes. The text is kept by the key of the tab (`editorBuffers`), so going to another tab and back
 * keeps it, its undo history and its place; it is kept for the next start as a draft, like the changes of a file (`src/state/drafts.ts`).
 */
export function UntitledView({ tabKey, zoom = 1, onSave, onChanged, dirty, leading }: { tabKey: string; zoom?: number; /** Save As: the workbench asks where, and writes. */ onSave: () => void; /** The text now has something in it that is not saved, or no longer has. */ onChanged: (key: string, changed: boolean) => void; /** What the workbench says of the tab: when a save made it clean, the toolbar looks at the buffer again. */ dirty?: boolean; leading?: ReactNode }) {
  const { t } = useI18n()
  const group = useGroup()
  const wrap = wordWrap.use()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [buffer] = useState<EditorBuffer>(() => editorBuffers.get(tabKey) ?? newUntitledBuffer(tabKey, wordWrap.get()))
  const [changed, setChanged] = useState(() => hasChanges(buffer))
  const [lines, setLines] = useState(0)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const wrapNow = useRef(wrap)
  wrapNow.current = wrap
  const changedNow = useRef(onChanged)
  changedNow.current = onChanged

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({ parent: host.current, state: buffer.state })
    view.current = editor
    editor.dispatch({
      effects: [
        wrapping.reconfigure(wrapNow.current ? EditorView.lineWrapping : []),
        languageSlot.reconfigure(languageExtension('plain')),
        listenerSlot.reconfigure(
          EditorView.updateListener.of((update) => {
            buffer.state = update.state
            if (update.docChanged) {
              const now = hasChanges(buffer)
              setChanged(now)
              setLines(update.state.doc.lines)
              changedNow.current(tabKey, now)
            }
          }),
        ),
      ],
    })
    buffer.state = editor.state
    setLines(editor.state.doc.lines)
    // (A text that came back from the last session has changes from the start.)
    const now = hasChanges(buffer)
    setChanged(now)
    changedNow.current(tabKey, now)
    const unregister = fileTarget.set(createCodeFindTarget(() => view.current), group)
    const unshow = shownText.set(() => editor.state.doc.toString(), group)
    editor.focus()
    return () => {
      unregister()
      unshow()
      buffer.state = editor.state
      editor.destroy()
      view.current = null
    }
  }, [buffer, group, tabKey])

  // A save (the workbench's) made the text clean without a change of the text.
  useEffect(() => {
    setChanged(hasChanges(buffer))
  }, [dirty, buffer])
  useEffect(() => {
    view.current?.requestMeasure()
  }, [zoom])
  useEffect(() => {
    view.current?.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const editor = view.current
    const selected = editor ? editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to) : ''
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        {leading}
        <SaveButton label={t('file.saveAs')} onClick={onSave} />
        <ToolbarButton icon="word-wrap" text={t('text.wordWrap')} label={t('text.wordWrapTitle')} pressed={wrap} onClick={() => wordWrap.set(!wrap)} />
        <Separator />
        <span className="truncate text-[12px] text-fg-muted" title={t('untitled.hint')}>
          {t('untitled.saveAsTitle')}
        </span>
        <span className="ml-auto flex items-center gap-3 pr-1 text-[12px] text-fg-muted">
          {changed ? <span aria-live="polite">● {t('edit.modified')}</span> : null}
          <span>{t('text.lines', { count: lines })}</span>
        </span>
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col" onContextMenu={onContextMenu} style={{ '--wsnp-zoom': zoom } as CSSProperties}>
        <div ref={host} className="h-full min-h-0 flex-1 overflow-hidden" aria-label={t('untitled.hint')} />
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
