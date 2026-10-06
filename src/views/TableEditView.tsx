import { isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import type { EditError, LineEnding } from '@core/api.ts'
import type { TextChange } from '@core/csvEdit.ts'
import type { Language } from '@core/filekind.ts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadEditorBuffer } from '@/state/editLoad.ts'
import { editorBuffers, hasChanges, type EditorBuffer } from '@/state/editors.ts'
import { wordWrap } from '@/state/setting.ts'
import { TableView, type TableEditing } from './TableView.tsx'

type Load = { state: 'loading' } | { state: 'ready'; buffer: EditorBuffer } | { state: 'refused'; error: EditError }

/**
 * A CSV or TSV file of a folder as a table that can be edited. Its text is the buffer of the text editor (`editorBuffers`, by the key of the tab), so a cell edited here is a change of
 * that text: the dot on the tab, undo, Save, the check against the disk, the line endings, the byte order mark and the draft kept for the next start are the editor's, and the same
 * text is there when the tab is shown as text. Each change the table makes is one step of the editor's history. A file that cannot be edited is handed to `fallback`.
 */
export function TableEditView({ tabKey, rootId, path, name, tab, tableKey, language, zoom, onSave, onSaveAs, onOpenWith, onHex, onChanged, onRestored, dirty, fallback }: { tabKey: string; rootId: string; path: string; name: string; tab: boolean; tableKey: string; language: Language; zoom?: number; onSave: () => void; onSaveAs: (text: string, options: { eol: LineEnding; bom: boolean }) => void; onOpenWith?: () => void; onHex?: () => void; onChanged: (key: string, changed: boolean) => void; onRestored?: (name: string) => void; /** What the workbench says of the tab: a save made the text clean. */ dirty?: boolean; fallback: () => ReactNode }) {
  const [load, setLoad] = useState<Load>(() => {
    const kept = editorBuffers.get(tabKey)
    return kept ? { state: 'ready', buffer: kept } : { state: 'loading' }
  })
  // The buffer's state is replaced by each change: this makes the table draw it again.
  const [, redraw] = useState(0)
  const wrap = wordWrap.use()
  const changedNow = useRef(onChanged)
  changedNow.current = onChanged
  const restoredNow = useRef(onRestored)
  restoredNow.current = onRestored

  useEffect(() => {
    if (load.state !== 'loading') return
    let alive = true
    void loadEditorBuffer(rootId, path, tabKey, language, wrap).then((result) => {
      if (!alive || !result) return
      if (result.state === 'refused') return setLoad({ state: 'refused', error: result.error })
      if (result.restored) restoredNow.current?.(name)
      setLoad({ state: 'ready', buffer: result.buffer })
      changedNow.current(tabKey, hasChanges(result.buffer))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.state, rootId, path, tabKey])
  // A save (the workbench's) made the text clean without a change of the text.
  useEffect(() => redraw((n) => n + 1), [dirty])

  const buffer = load.state === 'ready' ? load.buffer : null
  const doc = buffer?.state.doc
  const text = useMemo(() => (doc ? doc.toString() : ''), [doc])

  const editing: TableEditing | undefined = useMemo(() => {
    if (!buffer) return undefined
    const changed = () => {
      redraw((n) => n + 1)
      changedNow.current(tabKey, hasChanges(buffer))
    }
    return {
      modified: hasChanges(buffer),
      canUndo: undoDepth(buffer.state) > 0,
      canRedo: redoDepth(buffer.state) > 0,
      // One transaction, kept apart in the history, so that undo takes back what one action of the table did.
      apply(changes: TextChange[]) {
        buffer.state = buffer.state.update({ changes, annotations: isolateHistory.of('full'), userEvent: 'input.table' }).state
        changed()
      },
      undo() {
        if (undo({ state: buffer.state, dispatch: (tr) => void (buffer.state = tr.state) })) changed()
      },
      redo() {
        if (redo({ state: buffer.state, dispatch: (tr) => void (buffer.state = tr.state) })) changed()
      },
      onSave,
      onSaveAs: () => onSaveAs(buffer.state.doc.toString(), { eol: buffer.eol, bom: buffer.bom }),
    }
    // The buffer's state is a new object after each change, which is what makes this a new set of flags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer, buffer?.state, dirty, tabKey, onSave, onSaveAs])

  if (load.state === 'refused') return <>{fallback()}</>
  if (!buffer || !editing) return <div className="min-h-0 flex-1 bg-editor" aria-busy="true" />
  return <TableView text={text} name={name} tab={tab} tableKey={tableKey} onSave={onSave} onOpenWith={onOpenWith} onHex={onHex} zoom={zoom} edit={editing} />
}
