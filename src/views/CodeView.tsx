import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import type { Language } from '@core/filekind.ts'
import { createCodeFindTarget } from '@/find/code.ts'
import { fileTarget } from '@/find/types.ts'
import { readOnlyExtensions, wrapping } from './codeTheme.ts'
import { useGroup } from '@/state/groups.ts'

/**
 * A file of the snapshot as read-only source, with line numbers and the colours of the theme (CodeMirror 6). Word wrap and a change of
 * text (formatted or as it was) are applied to the editor that is there, so switching them keeps it and its focus.
 */
export function CodeView({ text, language, wrap, zoom = 1 }: { text: string; language: Language; wrap: boolean; zoom?: number }) {
  const group = useGroup()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const wrapNow = useRef(wrap)
  wrapNow.current = wrap

  // A new editor when the file or its language changes.
  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: text, extensions: readOnlyExtensions(language, wrapNow.current) }) })
    view.current = editor
    // Find and Copy of the workbench act on this editor while it is shown.
    const unregister = fileTarget.set(createCodeFindTarget(() => view.current), group)
    return () => {
      unregister()
      editor.destroy()
      view.current = null
    }
    // `text` is read when the editor is made; a later change of text is a change of the document, below.
  }, [language, group])

  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === text) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true })
  }, [text])

  // The text is drawn at another scale (the tab's zoom, a CSS variable): the editor measures its lines again.
  useEffect(() => {
    view.current?.requestMeasure()
  }, [zoom])

  useEffect(() => {
    view.current?.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  return <div ref={host} className="h-full min-h-0 flex-1 overflow-hidden" />
}
