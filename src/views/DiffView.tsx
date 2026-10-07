import { getChunks, goToNextChunk, goToPreviousChunk, MergeView, unifiedMergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { decodeSide, UNTITLED_ROOT, untitledNumber, type DiffSide, type LineEnding } from '@core/diff.ts'
import { languageOf } from '@core/filekind.ts'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import type { MessageKey } from '@/i18n/index.ts'
import { basename } from '@/lib/format.ts'
import { editorBuffers } from '@/state/editors.ts'
import { diffCollapse, diffLayout, wordWrap } from '@/state/setting.ts'
import { readOnlyExtensions, wrapping } from './codeTheme.ts'
import { Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'

interface Loaded {
  name: string
  text: string
  eol: LineEnding
}
type Load = { state: 'loading' } | { state: 'ready'; left: Loaded; right: Loaded } | { state: 'failed'; name: string; error: 'too-large' | 'not-text' | 'not-utf8' | 'no-file' | 'no-snapshot' }

const EOL_LABEL: Record<LineEnding, string> = { lf: 'LF', crlf: 'CRLF', cr: 'CR' }

/** What the toolbar's buttons act on: the editor that has the changes (the right side, or the one column), and every editor of the view. */
interface Shown {
  main: EditorView
  editors: EditorView[]
}

async function readSide(side: DiffSide, untitled: (n: number) => string): Promise<{ ok: true; side: Loaded } | { ok: false; name: string; error: Extract<Load, { state: 'failed' }>['error'] }> {
  // A new text file that exists only in its tab: the text it has now (the comparison does not follow what is typed after it was opened).
  if (side.rootId === UNTITLED_ROOT) {
    const name = untitled(untitledNumber(side.path))
    const buffer = editorBuffers.get(side.path)
    return buffer ? { ok: true, side: { name, text: buffer.state.doc.toString(), eol: 'lf' } } : { ok: false, name, error: 'no-file' }
  }
  const name = basename(side.path)
  const read = await window.fb?.readFile(side.rootId, side.path)
  if (!read) return { ok: false, name, error: 'no-snapshot' }
  if ('error' in read) return { ok: false, name, error: read.error === 'no-snapshot' ? 'no-snapshot' : read.error === 'too-large' ? 'too-large' : 'no-file' }
  const text = decodeSide(read.bytes)
  return text.ok ? { ok: true, side: { name, text: text.text, eol: text.eol } } : { ok: false, name, error: text.error }
}

/**
 * Two text files of the folders and ZIP files that were opened, compared in one tab (`@codemirror/merge`): side by side, or in one column with the removed lines above the added
 * ones. Both are read-only here (a file is edited in its own tab); the colours of the language are each file's own, and a file saved with another line ending is not different
 * on every line (the endings are not compared, and the toolbar says when they differ). Long stretches of lines that are the same are folded, as in VS Code's diff.
 */
export function DiffView({ left, right, leftTitle, rightTitle, zoom = 1 }: { left: DiffSide; right: DiffSide; /** Where each side is, for a person: the folder or ZIP file it was opened from, then its path. */ leftTitle: string; rightTitle: string; zoom?: number }) {
  const { t } = useI18n()
  const layout = diffLayout.use()
  const collapse = diffCollapse.use()
  const wrap = wordWrap.use()
  const untitled = (n: number) => t('tabs.untitled', { n })
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [swapped, setSwapped] = useState(false)
  const [changes, setChanges] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const shown = useRef<Shown | null>(null)
  const wrapNow = useRef(wrap)
  wrapNow.current = wrap

  useEffect(() => {
    let alive = true
    setLoad({ state: 'loading' })
    void Promise.all([readSide(left, untitled), readSide(right, untitled)]).then(([a, b]) => {
      if (!alive) return
      if (!a.ok) return setLoad({ state: 'failed', name: a.name, error: a.error })
      if (!b.ok) return setLoad({ state: 'failed', name: b.name, error: b.error })
      setLoad({ state: 'ready', left: a.side, right: b.side })
    })
    return () => {
      alive = false
    }
  }, [left.rootId, left.path, right.rootId, right.path])

  // The view is made again when what it shows changes: the files, the sides swapped, the layout, the folding.
  useEffect(() => {
    const parent = host.current
    if (load.state !== 'ready' || !parent) return
    const [from, to] = swapped ? [load.right, load.left] : [load.left, load.right]
    // Nothing to fold when nothing differs: the whole text would go behind one line.
    const fold = collapse && from.text !== to.text ? { margin: 3, minSize: 4 } : undefined
    let destroy: () => void
    if (layout === 'side') {
      const merge = new MergeView({ parent, a: { doc: from.text, extensions: readOnlyExtensions(languageOf(undefined, from.name), wrapNow.current) }, b: { doc: to.text, extensions: readOnlyExtensions(languageOf(undefined, to.name), wrapNow.current) }, gutter: true, highlightChanges: true, ...(fold ? { collapseUnchanged: fold } : {}) })
      shown.current = { main: merge.b, editors: [merge.a, merge.b] }
      setChanges(merge.chunks.length)
      destroy = () => merge.destroy()
    } else {
      const editor = new EditorView({
        parent,
        state: EditorState.create({ doc: to.text, extensions: [readOnlyExtensions(languageOf(undefined, to.name), wrapNow.current), unifiedMergeView({ original: from.text, mergeControls: false, gutter: true, highlightChanges: true, ...(fold ? { collapseUnchanged: fold } : {}) })] }),
      })
      shown.current = { main: editor, editors: [editor] }
      setChanges(getChunks(editor.state)?.chunks.length ?? 0)
      destroy = () => editor.destroy()
    }
    return () => {
      shown.current = null
      destroy()
    }
  }, [load, swapped, layout, collapse])

  // Word wrap and the tab's zoom change what is on screen, not what it shows: the editors are told, and keep their place.
  useEffect(() => {
    for (const editor of shown.current?.editors ?? []) editor.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])
  useEffect(() => {
    for (const editor of shown.current?.editors ?? []) editor.requestMeasure()
  }, [zoom])

  const go = (next: boolean) => {
    const main = shown.current?.main
    if (main) (next ? goToNextChunk : goToPreviousChunk)(main)
  }
  // F7 and Shift+F7: the next and the previous change, as in VS Code.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F7' || event.ctrlKey || event.altKey || event.metaKey) return
      event.preventDefault()
      go(!event.shiftKey)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (load.state === 'failed') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-editor p-8">
        <p role="alert" className="m-0 max-w-[560px] text-center text-fg-muted">
          {t(`diff.error.${load.error}` as MessageKey, { name: load.name })}
        </p>
      </div>
    )
  }

  const ready = load.state === 'ready'
  const [a, b] = load.state === 'ready' ? (swapped ? [load.right, load.left] : [load.left, load.right]) : [undefined, undefined]
  const [aTitle, bTitle] = swapped ? [rightTitle, leftTitle] : [leftTitle, rightTitle]
  const endings = a && b && a.eol !== b.eol ? t('diff.eolDiffers', { left: EOL_LABEL[a.eol], right: EOL_LABEL[b.eol] }) : null
  const count = !ready ? null : changes === 0 ? t('diff.identical') : changes === 1 ? t('diff.changesOne') : t('diff.changes', { count: changes })
  return (
    <div className="fb-diff flex h-full min-h-0 flex-1 flex-col" role="group" aria-label={t('diff.label', { left: leftTitle, right: rightTitle })}>
      <Toolbar>
        <ToolbarButton icon="split-horizontal" text={t('diff.sideBySide')} label={t('diff.sideBySideTitle')} pressed={layout === 'side'} onClick={() => diffLayout.set('side')} />
        <ToolbarButton icon="diff-single" text={t('diff.inline')} label={t('diff.inlineTitle')} pressed={layout === 'inline'} onClick={() => diffLayout.set('inline')} />
        <Separator />
        <ToolbarButton icon="arrow-up" label={`${t('diff.previous')} (Shift+F7)`} disabled={!ready || changes === 0} onClick={() => go(false)} />
        <ToolbarButton icon="arrow-down" label={`${t('diff.next')} (F7)`} disabled={!ready || changes === 0} onClick={() => go(true)} />
        <ToolbarButton icon="arrow-swap" label={t('diff.swap')} disabled={!ready} onClick={() => setSwapped((s) => !s)} />
        <ToolbarButton icon="fold" text={t('diff.collapse')} label={t('diff.collapseTitle')} pressed={collapse} onClick={() => diffCollapse.set(!collapse)} />
        <span className="ml-auto flex items-center gap-3 pr-1 text-[12px] text-fg-muted">
          {endings ? <span>{endings}</span> : null}
          {count ? <span aria-live="polite">{count}</span> : null}
        </span>
      </Toolbar>
      {/* Who is on which side (the tab says it too, but a tab is short). In one column both are above it. */}
      <div className={`grid shrink-0 border-b border-group-border bg-editor text-[12px] text-fg-muted ${layout === 'side' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <span className="truncate px-3 py-1" title={aTitle}>
          {aTitle}
        </span>
        <span className={`truncate px-3 py-1 ${layout === 'side' ? 'border-l border-group-border' : ''}`} title={bTitle}>
          {bTitle}
        </span>
      </div>
      {ready ? null : <p className="m-0 p-6 text-fg-muted">{t('diff.loading')}</p>}
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" style={{ '--wsnp-zoom': zoom } as CSSProperties} />
    </div>
  )
}
