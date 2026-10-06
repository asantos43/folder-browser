import { asciiOf, findInFile, firstRowAt, hexByte, HEX_WIDTH, identify, offsetLabel, parseHex, parseOffset, scrollMetrics, scrollTopOf, type ByteReader, type Identity } from '@core/hex.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { formatBytes } from '@/lib/format.ts'
import { FileActions, SaveButton, Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'
import { useSize } from './useViewport.ts'

/** The height of a row at 100 %. */
const ROW = 20
const CHUNK = 64 * 1024
/** The chunks kept (64 KiB each): 16 MiB. */
const KEEP = 256
/** What can be copied at once. */
const COPY_LIMIT = 2 ** 20

/** Where the bytes of a file come from: all of them already read, or a window of the file read when it is needed. */
export type HexSource = { bytes: Uint8Array } | { size: number; range: (offset: number, length: number) => Promise<Uint8Array | null> }

const sizeOf = (source: HexSource): number => ('bytes' in source ? source.bytes.length : source.size)

/** Keeps the 64 KiB chunks that were read, loads the ones the view shows, and lets the rest go (the ones farthest from the view first). */
function useChunks(source: HexSource) {
  const chunks = useRef(new Map<number, Uint8Array>())
  const asked = useRef(new Set<number>())
  const [, setTick] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    chunks.current.clear()
    asked.current.clear()
    setFailed(false)
  }, [source])
  const size = sizeOf(source)
  const need = useCallback(
    (from: number, to: number) => {
      if ('bytes' in source) return
      for (let index = Math.floor(from / CHUNK); index <= Math.floor(Math.min(to, size - 1) / CHUNK); index++) {
        if (chunks.current.has(index) || asked.current.has(index)) continue
        asked.current.add(index)
        void source.range(index * CHUNK, CHUNK).then((bytes) => {
          if (bytes === null) return void setFailed(true)
          chunks.current.set(index, bytes)
          if (chunks.current.size > KEEP) {
            const far = [...chunks.current.keys()].sort((a, b) => Math.abs(b - index) - Math.abs(a - index))[0]
            chunks.current.delete(far)
            asked.current.delete(far)
          }
          setTick((n) => n + 1)
        })
      }
    },
    [source, size],
  )
  /** The byte at `offset`, or undefined while its chunk is on its way. */
  const at = (offset: number): number | undefined => ('bytes' in source ? source.bytes[offset] : chunks.current.get(Math.floor(offset / CHUNK))?.[offset % CHUNK])
  return { at, need, failed }
}

/** A reader of any part of the file, for searching and copying (not for drawing: that goes through the chunks). */
function readerOf(source: HexSource): ByteReader {
  return async (offset, length) => ('bytes' in source ? source.bytes.subarray(offset, offset + length) : ((await source.range(offset, length)) ?? new Uint8Array(0)))
}

/** What a file is read whole up to, to be shown in hex: the same as any other file of a tab. Over this, a window of the file is read when it is needed. */
export const HEX_WHOLE_LIMIT = 16 * 2 ** 20

/** A big file of a folder in hex: its windows come from the main process; a file that cannot be read that way (an entry of a ZIP) is only offered with Save As. */
export function RangeHexView({ snapshotId, path, name, size, onSave, onOpenWith, zoom, findToken, fallback }: { snapshotId: string; path: string; name: string; size: number; onSave: () => void; onOpenWith?: () => void; zoom?: number; findToken?: number; fallback: () => ReactNode }) {
  const [readable, setReadable] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    let alive = true
    setReadable(undefined)
    void window.fb?.readRange(snapshotId, path, 0, 1).then((result) => alive && setReadable('bytes' in result))
    return () => {
      alive = false
    }
  }, [snapshotId, path])
  const source = useMemo<HexSource>(
    () => ({
      size,
      range: async (offset, length) => {
        const result = await window.fb?.readRange(snapshotId, path, offset, length)
        return result && 'bytes' in result ? result.bytes : null
      },
    }),
    [snapshotId, path, size],
  )
  if (readable === undefined) return <div className="min-h-0 flex-1 bg-editor" />
  return readable ? <HexView name={name} source={source} onSave={onSave} onOpenWith={onOpenWith} zoom={zoom} findToken={findToken} /> : <>{fallback()}</>
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, hexByte).join(' ')
const text = (bytes: Uint8Array): string => Array.from(bytes, asciiOf).join('')

/**
 * A file shown as its bytes: the offset, 16 bytes in hex (eight and eight) and the same bytes as text, a row to a line, however long the file is (only the rows in view
 * exist). It is read-only and runs nothing: what the first bytes say the file is (an ELF, a PE, a ZIP…) is read from its header, as `file` does. Click a byte (Shift-click or
 * the arrows with Shift to extend), Ctrl+C copies the bytes as hex, Ctrl+G goes to an offset, and Find looks for bytes or text.
 */
export function HexView({ name, source, onSave, onOpenWith, zoom = 1, findToken = 0 }: { name: string; source: HexSource; onSave: () => void; onOpenWith?: () => void; /** The zoom of the tab: the rows and their text are drawn at that scale. */ zoom?: number; /** Counts up at each Find (`Ctrl+F`): the box that looks for bytes or text takes the focus. */ findToken?: number }) {
  const { t } = useI18n()
  const size = sizeOf(source)
  const { at, need, failed } = useChunks(source)
  const box = useRef<HTMLDivElement>(null)
  const room = useSize(box)
  const [scrollTop, setScrollTop] = useState(0)
  const [selection, setSelection] = useState<{ anchor: number; head: number } | null>(null)
  const [goto, setGoto] = useState('')
  const [gotoBad, setGotoBad] = useState(false)
  const [mode, setMode] = useState<'hex' | 'text'>('hex')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<'none' | 'searching' | 'notFound' | 'invalid'>('none')
  const search = useRef(0)
  const gotoInput = useRef<HTMLInputElement>(null)
  const queryInput = useRef<HTMLInputElement>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)

  const rowHeight = Math.max(8, Math.round(ROW * zoom))
  const metrics = useMemo(() => scrollMetrics(size, rowHeight, room.height), [size, rowHeight, room.height])
  const firstRow = firstRowAt(metrics, scrollTop)
  const visibleRows = Math.min(metrics.rows - firstRow, Math.ceil(room.height / rowHeight) + 1)
  need(firstRow * HEX_WIDTH, (firstRow + visibleRows) * HEX_WIDTH - 1)

  useEffect(() => {
    let alive = true
    void readerOf(source)(0, 4096).then((head) => alive && setIdentity(identify(head)))
    return () => {
      alive = false
    }
  }, [source])

  const reveal = useCallback(
    (offset: number) => {
      const row = Math.floor(offset / HEX_WIDTH)
      const el = box.current
      if (!el) return
      const first = firstRowAt(metrics, el.scrollTop)
      const fits = Math.max(1, Math.floor(room.height / rowHeight))
      if (row < first) el.scrollTop = scrollTopOf(metrics, row)
      else if (row >= first + fits) el.scrollTop = scrollTopOf(metrics, row - fits + 1)
    },
    [metrics, room.height, rowHeight],
  )
  const select = useCallback(
    (anchor: number, head: number) => {
      const last = Math.max(0, size - 1)
      const clamped = { anchor: Math.max(0, Math.min(last, anchor)), head: Math.max(0, Math.min(last, head)) }
      setSelection(clamped)
      reveal(clamped.head)
    },
    [size, reveal],
  )
  const jump = (offset: number) => {
    const el = box.current
    if (el) el.scrollTop = scrollTopOf(metrics, Math.max(0, Math.floor(offset / HEX_WIDTH) - 2))
    setSelection({ anchor: offset, head: offset })
  }

  const range = selection ? { from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head) } : null
  const count = range ? range.to - range.from + 1 : 0
  const copy = async (as: 'hex' | 'text') => {
    if (!range || count > COPY_LIMIT) return
    const bytes = await readerOf(source)(range.from, count)
    void window.fb?.copyText(as === 'hex' ? hex(bytes) : text(bytes))
  }

  const onKey = (event: KeyboardEvent) => {
    const head = selection?.head ?? 0
    const page = Math.max(1, Math.floor(room.height / rowHeight) - 1) * HEX_WIDTH
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: HEX_WIDTH, ArrowUp: -HEX_WIDTH, PageDown: page, PageUp: -page }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      void copy('hex')
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
      event.preventDefault()
      gotoInput.current?.focus()
    } else if (event.key in moves) {
      event.preventDefault()
      const next = head + moves[event.key]
      select(event.shiftKey ? (selection?.anchor ?? head) : next, next)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = event.ctrlKey || event.metaKey ? (event.key === 'Home' ? 0 : size - 1) : event.key === 'Home' ? head - (head % HEX_WIDTH) : head - (head % HEX_WIDTH) + HEX_WIDTH - 1
      select(event.shiftKey ? (selection?.anchor ?? head) : next, next)
    }
  }
  const onByte = (event: MouseEvent, offset: number) => {
    box.current?.focus()
    select(event.shiftKey && selection ? selection.anchor : offset, offset)
  }

  const submitGoto = () => {
    const offset = parseOffset(goto)
    setGotoBad(offset === null || offset >= size)
    if (offset !== null && offset < size) {
      jump(offset)
      box.current?.focus()
    }
  }
  const find = async (backwards: boolean) => {
    const needle = mode === 'hex' ? parseHex(query) : new TextEncoder().encode(query)
    if (!query) return setFound('none')
    if (!needle) return setFound('invalid')
    const id = ++search.current
    setFound('searching')
    // After the end of the selected bytes, or before their start (the whole file when nothing is selected).
    const from = range ? (backwards ? range.from : range.from) : backwards ? size : -1
    const at = await findInFile(readerOf(source), size, needle, from, backwards, () => search.current !== id)
    if (search.current !== id) return
    if (at < 0) return setFound('notFound')
    setFound('none')
    jump(at)
    setSelection({ anchor: at, head: at + needle.length - 1 })
  }
  useEffect(() => () => void (search.current += 1), [])
  // Ctrl+F: the box that looks for bytes or text.
  useEffect(() => {
    if (findToken > 0) queryInput.current?.focus()
  }, [findToken])

  const rows = Array.from({ length: Math.max(0, visibleRows) }, (_, i) => firstRow + i)
  const inSelection = (offset: number) => range !== null && offset >= range.from && offset <= range.to
  const input = 'h-[24px] rounded-sm border border-group-border bg-editor px-1.5 text-[13px] text-fg outline-none focus-visible:outline-1 focus-visible:outline-focus'
  const status = found === 'searching' ? t('hex.searching') : found === 'notFound' ? t('hex.notFound') : found === 'invalid' ? t('hex.invalidHex') : null

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        <ToolbarButton icon="copy" label={count > COPY_LIMIT ? t('hex.copyTooBig') : t('hex.copyHex')} disabled={!range || count > COPY_LIMIT} onClick={() => void copy('hex')} />
        <ToolbarButton icon="whole-word" label={count > COPY_LIMIT ? t('hex.copyTooBig') : t('hex.copyText')} disabled={!range || count > COPY_LIMIT} onClick={() => void copy('text')} />
        <Separator />
        <input
          ref={gotoInput}
          aria-label={t('hex.goto')}
          title={t('hex.gotoHint')}
          placeholder={t('hex.goto')}
          value={goto}
          aria-invalid={gotoBad}
          onChange={(e) => {
            setGoto(e.target.value)
            setGotoBad(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && submitGoto()}
          className={`${input} w-[120px] ${gotoBad ? 'outline-1 outline-error' : ''}`}
        />
        <Separator />
        <select aria-label={t('hex.findMode')} title={t('hex.findMode')} value={mode} onChange={(e) => setMode(e.target.value as 'hex' | 'text')} className={input}>
          <option value="hex">{t('hex.findHex')}</option>
          <option value="text">{t('hex.findText')}</option>
        </select>
        <input
          ref={queryInput}
          aria-label={mode === 'hex' ? t('hex.findHexHint') : t('hex.findTextHint')}
          placeholder={mode === 'hex' ? t('hex.findHexHint') : t('hex.findTextHint')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setFound('none')
          }}
          onKeyDown={(e) => e.key === 'Enter' && void find(e.shiftKey)}
          className={`${input} w-[170px]`}
        />
        <ToolbarButton icon="arrow-up" label={t('hex.findPrevious')} onClick={() => void find(true)} />
        <ToolbarButton icon="arrow-down" label={t('hex.findNext')} onClick={() => void find(false)} />
        {status ? <span role="status" className="text-[12px] text-fg-muted">{status}</span> : null}
        <Separator />
        <SaveButton label={t('file.saveAs')} onClick={onSave} />
        <FileActions onOpenWith={onOpenWith} />
        <span className="ml-auto flex items-center gap-3 pr-1 text-[12px] whitespace-nowrap text-fg-muted">
          {identity ? <span>{identity.description}</span> : null}
          <span>{formatBytes(size)}</span>
        </span>
      </Toolbar>
      {size === 0 ? (
        <p className="m-0 p-6 text-fg-muted">{t('hex.empty')}</p>
      ) : (
        <div
          ref={box}
          role="grid"
          aria-label={t('hex.label', { name })}
          tabIndex={0}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          onKeyDown={onKey}
          style={{ fontSize: `${13 * zoom}px` }}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-auto bg-editor font-mono text-[13px] text-editor-fg outline-none select-none"
        >
          <div style={{ height: metrics.height, minWidth: 'max-content' }}>
            <div style={{ position: 'absolute', top: scrollTop, left: 0, minWidth: '100%' }}>
              {rows.map((row) => {
                const start = row * HEX_WIDTH
                const length = Math.min(HEX_WIDTH, size - start)
                return (
                  <div key={row} role="row" style={{ height: rowHeight }} className="flex items-center gap-4 px-3 whitespace-pre">
                    <span className="text-fg-muted">{offsetLabel(start, size)}</span>
                    <span className="flex">
                      {Array.from({ length: HEX_WIDTH }, (_, i) => {
                        const offset = start + i
                        const value = i < length ? at(offset) : undefined
                        return (
                          <span
                            key={i}
                            role="gridcell"
                            aria-selected={inSelection(offset)}
                            onMouseDown={i < length ? (e) => onByte(e, offset) : undefined}
                            className={`w-[2.4ch] text-center ${i === 8 ? 'ml-[1.2ch]' : ''} ${inSelection(offset) ? 'bg-list-active text-list-active-fg' : ''}`}
                          >
                            {i >= length ? '' : value === undefined ? '··' : hexByte(value)}
                          </span>
                        )
                      })}
                    </span>
                    <span className="flex">
                      {Array.from({ length }, (_, i) => {
                        const value = at(start + i)
                        return (
                          <span key={i} onMouseDown={(e) => onByte(e, start + i)} className={`w-[1ch] ${inSelection(start + i) ? 'bg-list-active text-list-active-fg' : ''}`}>
                            {value === undefined ? ' ' : asciiOf(value)}
                          </span>
                        )
                      })}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      <div className="flex h-[22px] shrink-0 items-center gap-4 border-t border-group-border px-3 text-[12px] text-fg-muted">
        <span>{failed ? t('hex.unreadable') : selection ? t('hex.at', { hex: selection.head.toString(16), decimal: String(selection.head) }) : ''}</span>
        <span>{range ? (count === 1 ? t('hex.selectedOne') : t('hex.selected', { count: String(count) })) : ''}</span>
      </div>
    </div>
  )
}
