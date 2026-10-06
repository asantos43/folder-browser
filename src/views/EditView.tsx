import { EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { FORMATTABLE, type Language } from '@core/filekind.ts'
import type { EditError, LineEnding } from '@core/api.ts'
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu.tsx'
import { createCodeFindTarget } from '@/find/code.ts'
import { fileTarget } from '@/find/types.ts'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { editorBuffers, hasChanges, type EditorBuffer } from '@/state/editors.ts'
import { wordWrap } from '@/state/setting.ts'
import { shownText } from '@/state/shown.ts'
import { shortcut } from '@/workbench/commands.ts'
import { editableExtensions, languageExtension, languageSlot, listenerSlot, wrapping } from './codeTheme.ts'
import { canFormat, formatSource } from './format.ts'
import { FileActions, SaveButton, Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'

type Load = { state: 'loading' } | { state: 'ready'; buffer: EditorBuffer } | { state: 'refused'; error: EditError }

const EOL_LABEL: Record<LineEnding, string> = { lf: 'LF', crlf: 'CRLF', cr: 'CR' }

/**
 * A text file of a folder, edited: the same source view as the read-only one, with a caret, selection, undo and redo, indenting, closing brackets, **Save** (`Ctrl+S`), Format
 * Document (HTML, CSS, JavaScript, JSON and XML laid out, as an edit that can be undone), Word Wrap and Save As (which writes the text on screen). The text is the file as it was
 * saved, never laid out for reading. The editor's state is kept by the key of the tab (`editorBuffers`), so changes, undo history and the place survive going to another tab.
 * A file that cannot be edited (not UTF-8, not text, too big) is handed to `fallback`, which shows it as it is, with the reason.
 */
export function EditView({ tabKey, rootId, path, language, zoom = 1, onSave, onSaveAs, onOpenWith, onHex, onChanged, onRestored, dirty, leading, fallback }: { /** Changes that were not saved came back from the draft kept for the next start. */ onRestored?: (name: string) => void;  /** What the workbench says of the tab: when it changes (a save made the text clean), the toolbar looks at the buffer again. */ dirty?: boolean; tabKey: string; rootId: string; path: string; language: Language; zoom?: number; /** The Save button (the workbench saves, and says what went wrong). */ onSave: () => void; onSaveAs: (text: string, options: { eol: LineEnding; bom: boolean }) => void; onOpenWith?: () => void; onHex?: () => void; /** The text now has changes that are not saved, or no longer has. */ onChanged: (key: string, changed: boolean) => void; leading?: ReactNode; fallback: (reason: MessageKey) => ReactNode }) {
  const { t } = useI18n()
  const wrap = wordWrap.use()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [load, setLoad] = useState<Load>(() => {
    const kept = editorBuffers.get(tabKey)
    return kept ? { state: 'ready', buffer: kept } : { state: 'loading' }
  })
  const [changed, setChanged] = useState(() => {
    const kept = editorBuffers.get(tabKey)
    return kept ? hasChanges(kept) : false
  })
  const [lines, setLines] = useState(0)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const wrapNow = useRef(wrap)
  wrapNow.current = wrap
  const languageNow = useRef(language)
  languageNow.current = language
  const changedNow = useRef(onChanged)
  changedNow.current = onChanged
  const onRestoredNow = useRef(onRestored)
  onRestoredNow.current = onRestored
  const keyNow = useRef(tabKey)
  keyNow.current = tabKey

  // The text is asked of the main process once for a tab (a tab shown again has its buffer).
  useEffect(() => {
    if (load.state !== 'loading') return
    let alive = true
    void (async () => {
      // Changes of an earlier session that were not saved (a draft) come first: the tab shows them, with the file as it is on disk as what is saved.
      const draft = await window.fb?.drafts.get(rootId, path).catch(() => null)
      const result = await window.fb?.edit.open(rootId, path)
      if (!alive || !result) return
      const extensions = editableExtensions(languageNow.current, wrapNow.current)
      if (draft && draft.kind === 'text' && (result.ok || result.error === 'no-file')) {
        const onDisk = result.ok ? result.text : ''
        const same = result.ok && draft.text === result.text && draft.base.mtimeMs === result.version.mtimeMs && draft.base.size === result.version.size
        if (!same) {
          const state = EditorState.create({ doc: draft.text, extensions })
          // The version is the one the changes began from: if the file changed on disk since, Save notices.
          const buffer: EditorBuffer = { state, saved: Text.of(onDisk.split('\n')), version: draft.base, eol: draft.eol ?? 'lf', bom: draft.bom ?? false }
          editorBuffers.set(tabKey, buffer)
          onRestoredNow.current?.(path.split(/[!/]+/).pop() ?? path)
          return setLoad({ state: 'ready', buffer })
        }
        void window.fb?.drafts.delete(rootId, path)
      }
      if (!result.ok) return setLoad({ state: 'refused', error: result.error })
      const state = EditorState.create({ doc: result.text, extensions })
      const buffer: EditorBuffer = { state, saved: state.doc, version: result.version, eol: result.eol, bom: result.bom }
      editorBuffers.set(tabKey, buffer)
      setLoad({ state: 'ready', buffer })
    })()
    return () => {
      alive = false
    }
  }, [load.state, rootId, path, tabKey])

  const buffer = load.state === 'ready' ? load.buffer : null
  // The editor of the buffer is made when the buffer is there, and its state kept when the tab is left.
  useEffect(() => {
    if (!buffer || !host.current) return
    const editor = new EditorView({ parent: host.current, state: buffer.state })
    view.current = editor
    editor.dispatch({
      effects: [
        wrapping.reconfigure(wrapNow.current ? EditorView.lineWrapping : []),
        languageSlot.reconfigure(languageExtension(languageNow.current)),
        listenerSlot.reconfigure(
          EditorView.updateListener.of((update) => {
            buffer.state = update.state
            if (update.docChanged) {
              const now = hasChanges(buffer)
              setChanged(now)
              setLines(update.state.doc.lines)
              changedNow.current(keyNow.current, now)
            }
          }),
        ),
      ],
    })
    buffer.state = editor.state
    setLines(editor.state.doc.lines)
    const now = hasChanges(buffer)
    setChanged(now)
    changedNow.current(keyNow.current, now)
    const unregister = fileTarget.set(createCodeFindTarget(() => view.current))
    const unshow = shownText.set(() => editor.state.doc.toString())
    editor.focus()
    return () => {
      unregister()
      unshow()
      buffer.state = editor.state
      editor.destroy()
      view.current = null
    }
  }, [buffer])

  // A save (the workbench's) made the text clean without a change of the text.
  useEffect(() => {
    if (buffer) setChanged(hasChanges(buffer))
  }, [dirty, buffer])
  useEffect(() => {
    view.current?.requestMeasure()
  }, [zoom])
  useEffect(() => {
    view.current?.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])
  useEffect(() => {
    view.current?.dispatch({ effects: languageSlot.reconfigure(languageExtension(language)) })
  }, [language])

  if (load.state === 'refused') return <>{fallback(`edit.refused.${load.error}` as MessageKey)}</>
  if (load.state === 'loading') return <div className="min-h-0 flex-1 bg-editor" aria-busy="true" />

  const formattable = FORMATTABLE.includes(language)
  /** Lays the text out for reading, as an edit (undo brings it back). */
  const format = async () => {
    const editor = view.current
    if (!editor) return
    const source = editor.state.doc.toString()
    if (!canFormat(language, source.length)) return
    const formatted = await formatSource(source, language)
    if (formatted === source || !view.current) return
    const head = Math.min(editor.state.selection.main.head, formatted.length)
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: formatted }, selection: { anchor: head }, userEvent: 'input.format' })
    editor.focus()
  }

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
        <ToolbarButton icon="save" text={t('edit.save')} label={t('edit.saveTitle')} disabled={!changed} onClick={onSave} />
        {formattable ? <ToolbarButton icon="list-flat" text={t('edit.formatDocument')} label={t('edit.formatDocumentTitle')} onClick={() => void format()} /> : null}
        <ToolbarButton icon="word-wrap" text={t('text.wordWrap')} label={t('text.wordWrapTitle')} pressed={wrap} onClick={() => wordWrap.set(!wrap)} />
        <Separator />
        <SaveButton label={t('file.saveAs')} onClick={() => view.current && onSaveAs(view.current.state.doc.toString(), { eol: buffer!.eol, bom: buffer!.bom })} />
        <FileActions onOpenWith={onOpenWith} onHex={onHex} />
        <span className="ml-auto flex items-center gap-3 pr-1 text-[12px] text-fg-muted">
          {changed ? <span aria-live="polite">● {t('edit.modified')}</span> : null}
          <span>{t('text.lines', { count: lines })}</span>
          <span>{EOL_LABEL[buffer!.eol]}</span>
          <span>{t(buffer!.bom ? 'edit.encodingBom' : 'edit.encoding')}</span>
          <span>{t(`text.language.${language}` as MessageKey)}</span>
        </span>
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col" onContextMenu={onContextMenu} style={{ '--wsnp-zoom': zoom } as CSSProperties}>
        <div ref={host} className="h-full min-h-0 flex-1 overflow-hidden" />
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
