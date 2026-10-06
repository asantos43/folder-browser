import { canProbe, effectiveType, isDelimited, isSvg, languageOf, looksLikeText, type ViewKind } from '@core/filekind.ts'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { basename } from '@/lib/format.ts'
import { fileLanguage, shownSource } from '@/state/fileLanguage.ts'
import { editorBuffers } from '@/state/editors.ts'
import { csvView, markdownView, svgView } from '@/state/setting.ts'
import { MarkdownToggle, MarkdownView } from './MarkdownView.tsx'
import { SvgToggle } from './SvgToggle.tsx'
import { TextView } from './TextView.tsx'
import { FontView } from './FontView.tsx'
import { ImageView } from './ImageView.tsx'
import { CsvToggle, CsvView } from './CsvView.tsx'
import { EditView } from './EditView.tsx'
import { HexEditView } from './HexEditView.tsx'
import { OtherView } from './OtherView.tsx'
import { HEX_WHOLE_LIMIT, HexView, RangeHexView } from './HexView.tsx'
import { PdfView } from './PdfView.tsx'
import { ZipView } from './ZipView.tsx'
import type { ZipEntryInfo } from '@core/api.ts'
import type { Notice } from '@/state/messages.ts'

type Loaded = { state: 'loading' } | { state: 'ready'; bytes: Uint8Array } | { state: 'failed'; error: string }

/**
 * The files read lately, so that going back to one (or to the one next to it in the tree) shows it at once instead of a moment of nothing. Only what is read
 * into the interface anyway, at most `BUDGET` bytes in all, the one used longest ago let go first.
 */
const BUDGET = 48 * 2 ** 20
const recentlyRead = new Map<string, Uint8Array>()
let cached = 0
function remember(key: string, bytes: Uint8Array): void {
  if (bytes.length > BUDGET / 3) return
  if (recentlyRead.has(key)) cached -= recentlyRead.get(key)!.length
  recentlyRead.delete(key)
  recentlyRead.set(key, bytes)
  cached += bytes.length
  for (const [old, value] of recentlyRead) {
    if (cached <= BUDGET) break
    recentlyRead.delete(old)
    cached -= value.length
  }
}
/** A file was written: what was read of it is old. */
export function forgetRead(snapshotId: string, path: string): void {
  const key = `${snapshotId}:${path}`
  const bytes = recentlyRead.get(key)
  if (!bytes) return
  recentlyRead.delete(key)
  cached -= bytes.length
}
/** A snapshot was closed: what was read from it goes (its id is never used again, so this only frees the memory). */
export function forgetReads(snapshotId?: string): void {
  for (const [key, bytes] of [...recentlyRead]) {
    if (snapshotId === undefined || key.startsWith(`${snapshotId}:`)) {
      recentlyRead.delete(key)
      cached -= bytes.length
    }
  }
}
function recall(key: string): Uint8Array | undefined {
  const bytes = recentlyRead.get(key)
  if (bytes) {
    recentlyRead.delete(key)
    recentlyRead.set(key, bytes)
  }
  return bytes
}

/** Whether `ms` have passed since this mounted: a message for something that takes no time at all would only flash. */
function useLate(ms: number): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(timer)
  }, [ms])
  return late
}

/** The tab of one file of a snapshot: source, picture or font when it can be shown, and a way to save it when it cannot. */
export function FileView({ snapshotId, path, kind: declaredKind, mediaType, size, onSave, onHex, onOpenWith, edit, findToken = 0, onViewEntry, onNotify, zoom = 1 }: { /** The file is a text of a folder that was opened: it is edited (it is a text, and is not shown as a page or a table). */ edit?: { rootId: string; tabKey: string; dirty: boolean; onRestored?: (name: string) => void; onSave: () => void; onSaveAs: (text: string, options: { eol: 'lf' | 'crlf' | 'cr'; bom: boolean }) => void; onSaveBytesAs: (name: string, bytes: Uint8Array) => void; onChanged: (key: string, changed: boolean) => void };  /** Hands the file to another application, by the chooser of this app. */ onOpenWith?: () => void; /** Counts up at each Find (`Ctrl+F`): a view with a search of its own (hexadecimal) takes the focus there. */ findToken?: number; /** Opens the file as its bytes (hexadecimal), in a tab of its own: offered on what is not shown. */ onHex: () => void; /** The zoom of the tab (a text is drawn at that scale; a picture and a PDF keep their own). */ zoom?: number; onViewEntry: (entry: ZipEntryInfo) => void; onNotify: (notice: Notice) => void; snapshotId: string; path: string; kind: ViewKind; mediaType: string | undefined; size: number; onSave: () => void }) {
  const { t } = useI18n()
  const key = `${snapshotId}:${path}`
  // A file of no known type (an entry of a ZIP with an extension the viewer has never heard of) is read and looked at: if it is text, it is shown as text.
  const probe = canProbe(mediaType, path, size)
  const [sniffed, setSniffed] = useState<'text' | 'binary' | undefined>(undefined)
  const kind: ViewKind = probe && sniffed === 'text' ? 'text' : declaredKind
  // A program, a library or any file of bytes is shown in hexadecimal; so is a file of an unknown type that is not text (and any file the user opens as Hex: its tab says so).
  const hex = kind === 'hex' || (probe && sniffed === 'binary')
  // Over the limit it is read a window at a time instead (a file of a folder only).
  const windowed = hex && size > HEX_WHOLE_LIMIT
  const [loaded, setLoaded] = useState<Loaded>(() => {
    const bytes = (kind === 'other' && !probe) || kind === 'zip' || (kind === 'hex' && size > HEX_WHOLE_LIMIT) ? undefined : recall(key)
    return bytes ? { state: 'ready', bytes } : { state: 'loading' }
  })
  const late = useLate(150)
  const name = basename(path)
  const svg = kind === 'text' && isSvg(mediaType, path)
  const svgAs = svgView.use()
  const markdownAs = markdownView.use()
  const csvAs = csvView.use()
  const delimited = kind === 'text' && isDelimited(mediaType, path)
  // The language the viewer detects, unless the user picked another one for this file (the status bar's Select Language Mode).
  const detected = languageOf(mediaType, path)
  const language = fileLanguage.use(key) ?? detected
  const sourceShown = kind === 'text' && loaded.state === 'ready' && !(svg && svgAs === 'image')
  useEffect(() => {
    if (sourceShown) return shownSource.set({ key, language, detected })
  }, [sourceShown, key, language, detected])

  useEffect(() => {
    if ((kind === 'other' && !probe) || kind === 'zip' || windowed) return
    let alive = true
    const again = recall(key)
    if (again) {
      setLoaded((old) => (old.state === 'ready' && old.bytes === again ? old : { state: 'ready', bytes: again }))
      return
    }
    setLoaded({ state: 'loading' })
    void window.fb?.readFile(snapshotId, path).then((result) => {
      if (!alive) return
      if ('bytes' in result) remember(key, result.bytes)
      setLoaded('bytes' in result ? { state: 'ready', bytes: result.bytes } : { state: 'failed', error: result.error })
    })
    return () => {
      alive = false
    }
  }, [snapshotId, path, kind, key, probe, windowed])

  useEffect(() => {
    if (!probe) return
    if (loaded.state === 'ready') setSniffed(looksLikeText(loaded.bytes) ? 'text' : 'binary')
    else setSniffed(undefined)
  }, [probe, loaded])

  // What the editor has (changes not saved too) is what a formatted page or a table of the same file shows.
  const buffer = edit ? editorBuffers.get(edit.tabKey) : undefined
  const doc = buffer?.state.doc
  const text = useMemo(() => (doc ? doc.toString() : kind === 'text' && loaded.state === 'ready' ? new TextDecoder('utf-8').decode(loaded.bytes) : ''), [kind, loaded, doc])

  // A ZIP is listed by the main process, which keeps it: nothing is read into the interface.
  if (kind === 'zip') return <ZipView snapshotId={snapshotId} path={path} name={name} size={size} onSave={onSave} onView={onViewEntry} onNotify={onNotify} />
  if (windowed) return <RangeHexView snapshotId={snapshotId} path={path} name={name} size={size} onSave={onSave} onOpenWith={onOpenWith} zoom={zoom} findToken={findToken} fallback={() => <OtherView name={name} mediaType={mediaType} size={size} reason="tooLarge" onSave={onSave} onOpenWith={onOpenWith} />} />
  if (kind === 'other' && !probe) return <OtherView name={name} mediaType={mediaType} size={size} onSave={onSave} onHex={onHex} onOpenWith={onOpenWith} />
  // A moment of nothing, not of a message that flashes: "Loading…" appears only when the file is slow.
  if (loaded.state === 'loading' || (probe && loaded.state === 'ready' && sniffed === undefined)) return late ? <p className="m-0 p-6 text-fg-muted">{t('file.loading')}</p> : <div className="min-h-0 flex-1 bg-editor" />
  if (loaded.state === 'failed') return <OtherView name={name} mediaType={mediaType} size={size} reason={loaded.error === 'too-large' ? 'tooLarge' : 'readError'} onSave={onSave} onOpenWith={onOpenWith} />
  // The bytes of a file of a folder (up to 16 MiB) are edited in the hexadecimal view: it reads them itself, with what the file is like on disk.
  if (hex && edit && size <= HEX_WHOLE_LIMIT) return <HexEditView tabKey={edit.tabKey} rootId={edit.rootId} path={path} name={name} onSave={edit.onSave} onSaveFile={onSave} onSaveAs={(bytes) => edit.onSaveBytesAs(name, bytes)} onOpenWith={onOpenWith} zoom={zoom} findToken={findToken} onChanged={edit.onChanged} onRestored={edit.onRestored} dirty={edit.dirty} fallback={() => <OtherView name={name} mediaType={mediaType} size={size} reason="readError" onSave={onSave} onOpenWith={onOpenWith} />} />
  if (hex) return <HexBytes name={name} bytes={loaded.bytes} onSave={onSave} onOpenWith={onOpenWith} zoom={zoom} findToken={findToken} />
  // An SVG is a picture and its source: the toolbar of either has the switch to the other.
  if (svg && svgAs === 'image') return <ImageView id={`${snapshotId}:${path}`} bytes={loaded.bytes} mediaType="image/svg+xml" name={name} onSave={onSave} leading={<SvgToggle />} />
  // A CSV or a TSV file is a table and its text: the toolbar of either has the switch to the other.
  if (delimited && csvAs === 'table') return <CsvView text={text} name={name} tab={/\.tsv$/i.test(path)} onSave={onSave} onOpenWith={onOpenWith} onHex={onHex} zoom={zoom} />
  // A Markdown file is a page and its text: the toolbar of either has the switch to the other.
  if (kind === 'text' && language === 'markdown' && markdownAs === 'formatted') return <MarkdownView text={text} onSave={onSave} onOpenWith={onOpenWith} onHex={onHex} zoom={zoom} />
  if (kind === 'text') {
    const leading = svg ? <SvgToggle /> : language === 'markdown' ? <MarkdownToggle /> : delimited ? <CsvToggle /> : undefined
    const readOnly = (notice?: string) => <TextView text={text} language={language} size={size} onSave={onSave} onOpenWith={onOpenWith} onHex={onHex} zoom={zoom} leading={leading} notice={notice} />
    if (!edit) return readOnly()
    return <EditView tabKey={edit.tabKey} rootId={edit.rootId} path={path} language={language} zoom={zoom} onSave={edit.onSave} onSaveAs={edit.onSaveAs} onOpenWith={onOpenWith} onHex={onHex} onChanged={edit.onChanged} onRestored={edit.onRestored} dirty={edit.dirty} leading={leading} fallback={(reason) => readOnly(t(reason))} />
  }
  if (kind === 'image') return <ImageView id={`${snapshotId}:${path}`} bytes={loaded.bytes} mediaType={effectiveType(mediaType, path)} name={name} onSave={onSave} />
  if (kind === 'pdf') return <PdfView id={`${snapshotId}:${path}`} bytes={loaded.bytes} name={name} onSave={onSave} />
  return <FontView bytes={loaded.bytes} />
}

/** The bytes of a file that was read whole, in hexadecimal. */
function HexBytes({ name, bytes, onSave, onOpenWith, zoom, findToken }: { name: string; bytes: Uint8Array; onSave: () => void; onOpenWith?: () => void; zoom: number; findToken: number }) {
  const source = useMemo(() => ({ bytes }), [bytes])
  return <HexView name={name} source={source} onSave={onSave} onOpenWith={onOpenWith} zoom={zoom} findToken={findToken} />
}
