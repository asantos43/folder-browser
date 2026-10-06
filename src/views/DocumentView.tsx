import type { DocMessage } from '@core/docs.ts'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/context.tsx'
import { OtherView } from './OtherView.tsx'
import { SaveButton, Separator, Toolbar, ToolbarButton } from './Toolbar.tsx'

/** The longest a document may take to be drawn before it is given up on. */
const PATIENCE_MS = 45_000

type Load = { state: 'opening' } | { state: 'drawing'; url: string } | { state: 'drawn'; url: string } | { state: 'failed'; reason: 'tooLarge' | 'readError' | 'notDrawn'; detail?: string }

/**
 * An office document (Word, Excel, PowerPoint, OpenDocument) in a tab. It is not drawn here: the main process gives the file a page of its own (`fb:doc-open`), and that page
 * draws it by the library that suits it, in a frame that is sandboxed, has no network and cannot reach this window (core/docs.ts). The page says how it went (`postMessage`);
 * a document it cannot draw is said in words, with Save As and the hexadecimal view as the way out.
 */
export function DocumentView({ snapshotId, path, name, mediaType, size, onSave, onHex }: { snapshotId: string; path: string; name: string; mediaType: string | undefined; size: number; onSave: () => void; onHex: () => void }) {
  const { t } = useI18n()
  const [load, setLoad] = useState<Load>({ state: 'opening' })
  const frame = useRef<HTMLIFrameElement>(null)
  const url = 'url' in load ? load.url : undefined

  useEffect(() => {
    let alive = true
    let token: string | undefined
    setLoad({ state: 'opening' })
    void window.fb?.docs.open(snapshotId, path).then((result) => {
      if ('error' in result) {
        if (alive) setLoad({ state: 'failed', reason: result.error === 'too-large' ? 'tooLarge' : 'readError' })
        return
      }
      token = result.token
      // The tab closed while the main process was reading the file: the page is let go at once.
      if (!alive) return void window.fb?.docs.release(result.token)
      setLoad({ state: 'drawing', url: result.url })
    })
    return () => {
      alive = false
      if (token) void window.fb?.docs.release(token)
    }
  }, [snapshotId, path])

  // What the page says, and only the page of this frame.
  useEffect(() => {
    if (!url) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Partial<DocMessage> | null
      if (event.source !== frame.current?.contentWindow || !data || data.fbDoc !== true) return
      if (data.type === 'ready') setLoad((old) => ('url' in old ? { state: 'drawn', url: old.url } : old))
      else if (data.type === 'error') setLoad({ state: 'failed', reason: 'notDrawn', detail: typeof data.message === 'string' ? data.message.slice(0, 300) : '' })
    }
    window.addEventListener('message', onMessage)
    const timer = setTimeout(() => setLoad((old) => (old.state === 'drawing' ? { state: 'failed', reason: 'notDrawn', detail: t('doc.tooSlow') } : old)), PATIENCE_MS)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
  }, [url, t])

  if (load.state === 'failed') return <OtherView name={name} mediaType={mediaType} size={size} reason={load.reason} detail={load.detail} onSave={onSave} onHex={onHex} />
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar>
        <SaveButton label={t('file.saveAs')} onClick={onSave} />
        <Separator />
        <ToolbarButton icon="file-binary" label={t('hex.viewTitle')} onClick={onHex} />
      </Toolbar>
      <div className="relative min-h-0 flex-1 bg-[#525659]">
        {url ? <iframe ref={frame} title={t('doc.frame', { name })} src={url} sandbox="allow-scripts" className="absolute inset-0 h-full w-full border-0" /> : null}
        {load.state !== 'drawn' ? <p role="status" className="absolute top-0 left-0 m-0 p-6 text-[13px] text-white/80">{t('doc.drawing')}</p> : null}
      </div>
    </div>
  )
}
