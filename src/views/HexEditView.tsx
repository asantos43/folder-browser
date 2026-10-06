import { createHexDoc, isModified, replaceBytes } from '@core/hexEdit.ts'
import { HEX_EDIT_LIMIT } from '@core/fs/edit.ts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { hexBuffers, hexChanged, type HexBuffer } from '@/state/hexBuffers.ts'
import { HexView, type HexSource } from './HexView.tsx'

/**
 * The bytes of a file of a folder in the hexadecimal view, ready to be edited (up to 16 MiB; a bigger file is read a window at a time by `RangeHexView`, and is not edited). The
 * bytes are read by the main process with what the file is like on disk (to notice at Save that it changed), unless a draft of changes not saved comes back from the last session.
 * The document being edited is kept by the key of the tab (`hexBuffers`), so changes and undo survive going to another tab.
 */
export function HexEditView({ tabKey, rootId, path, name, onSave, onSaveFile, onSaveAs, onOpenWith, zoom, findToken, onChanged, onRestored, dirty, fallback }: { tabKey: string; rootId: string; path: string; name: string; /** Saves the bytes to the file. */ onSave: () => void; /** Save As of the file as it is on disk (when there are no changes). */ onSaveFile: () => void; /** Save As of the bytes on screen. */ onSaveAs: (bytes: Uint8Array) => void; onOpenWith?: () => void; zoom?: number; findToken?: number; onChanged: (key: string, changed: boolean) => void; onRestored?: (name: string) => void; /** What the workbench says of the tab: a save made the bytes clean. */ dirty?: boolean; fallback: () => ReactNode }) {
  const [buffer, setBuffer] = useState<HexBuffer | null | 'refused'>(() => hexBuffers.get(tabKey) ?? null)
  // The bytes changed: the view draws them again (the document is changed in place).
  const [, setTick] = useState(0)
  const changedNow = useRef(onChanged)
  changedNow.current = onChanged
  const restoredNow = useRef(onRestored)
  restoredNow.current = onRestored

  useEffect(() => {
    if (buffer !== null) return
    let alive = true
    void (async () => {
      const draft = await window.fb?.drafts.get(rootId, path).catch(() => null)
      const result = await window.fb?.edit.openBytes(rootId, path)
      if (!alive || !result) return
      if (!result.ok) return setBuffer('refused')
      const doc = createHexDoc(result.bytes)
      let version = result.version
      if (draft && draft.kind === 'bytes') {
        const same = draft.bytes.length === result.bytes.length && draft.bytes.every((b, i) => b === result.bytes[i]) && draft.base.mtimeMs === result.version.mtimeMs
        if (!same) {
          // The changes of the last session, as one edit over the file as it is on disk; what differs is marked. The version is the one the changes began from.
          const disk = result.bytes.slice()
          replaceBytes(doc, 0, disk.length, draft.bytes)
          if (draft.bytes.length === disk.length) doc.changed = Uint8Array.from(draft.bytes, (b, i) => (b === disk[i] ? 0 : 1))
          version = draft.base
          restoredNow.current?.(name)
        } else void window.fb?.drafts.delete(rootId, path)
      }
      const made: HexBuffer = { doc, version }
      hexBuffers.set(tabKey, made)
      setBuffer(made)
    })()
    return () => {
      alive = false
    }
  }, [buffer, rootId, path, tabKey, name])

  const ready = buffer !== null && buffer !== 'refused' ? buffer : null
  // The tab says so when it has bytes that are not saved (also when it is shown again).
  useEffect(() => {
    if (ready) changedNow.current(tabKey, hexChanged(ready))
  }, [ready, tabKey])
  // A save (the workbench's) made the bytes clean without an edit.
  useEffect(() => {
    if (ready) setTick((n) => n + 1)
  }, [dirty, ready])

  const bytes = ready?.doc.bytes
  const source = useMemo<HexSource | null>(() => (bytes ? { bytes } : null), [bytes, ready?.doc.undo.length, ready?.doc.redo.length])

  if (buffer === 'refused') return <>{fallback()}</>
  if (!ready || !source) return <div className="min-h-0 flex-1 bg-editor" aria-busy="true" />
  return (
    <HexView
      name={name}
      source={source}
      onSave={onSaveFile}
      onOpenWith={onOpenWith}
      zoom={zoom}
      findToken={findToken}
      editing={{
        doc: ready.doc,
        modified: isModified(ready.doc),
        tooLarge: ready.doc.bytes.length > HEX_EDIT_LIMIT,
        onEdited: () => {
          setTick((n) => n + 1)
          changedNow.current(tabKey, hexChanged(ready))
        },
        onSave,
        onSaveAs: () => onSaveAs(ready.doc.bytes),
      }}
    />
  )
}
