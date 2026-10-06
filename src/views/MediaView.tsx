import { mediaKind } from '@core/filekind.ts'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useI18n } from '@/i18n/context.tsx'
import { basename, formatBytes } from '@/lib/format.ts'
import { Toolbar, ToolbarButton } from './Toolbar.tsx'

/** The file the player went on to by itself (a sound that ended): the tab that opens for it starts playing at once. */
let startNext: string | null = null

type Opened = { state: 'loading' } | { state: 'ready'; url: string; kind: 'video' | 'audio' } | { state: 'failed'; reason: 'no-file' | 'too-large' | 'unsupported' | 'codec' }

/** The media files next to this one, in the order of the tree, and where this one is among them. */
export function neighbours(names: readonly string[], current: string): { previous?: string; next?: string } {
  const files = names.filter((n) => mediaKind(undefined, n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))
  const at = files.indexOf(current)
  return at < 0 ? {} : { ...(at > 0 ? { previous: files[at - 1] } : {}), ...(at < files.length - 1 ? { next: files[at + 1] } : {}) }
}

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/')
  const inner = path.lastIndexOf('!/')
  // The folder that holds the file: up to the last `/`, or the ZIP itself (`a.zip!/x.mp3` is in `a.zip`).
  return inner > slash ? path.slice(0, inner) : slash < 0 ? '' : path.slice(0, slash)
}

/**
 * A video or a sound of a folder or a ZIP, played in a tab: the browser's own player (play, seek, volume, speed, full screen), served by ranges from the main process
 * (`fb-media://`), with Previous and Next through the media files of its folder, Repeat, and the system's media keys. A sound that ends goes on to the next. What the browser cannot
 * decode (HEVC, some containers) is said in words, with Open With… as the way out.
 */
export function MediaView({ rootId, path, size, onOpenSibling, onOpenWith, onSave }: { rootId: string; path: string; size: number; onOpenSibling: (path: string) => void; onOpenWith: () => void; onSave: () => void }) {
  const { t } = useI18n()
  const name = basename(path)
  const [opened, setOpened] = useState<Opened>({ state: 'loading' })
  const [siblings, setSiblings] = useState<{ previous?: string; next?: string }>({})
  const [repeat, setRepeat] = useState(false)
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const goTo = useRef(onOpenSibling)
  goTo.current = onOpenSibling
  const near = useRef(siblings)
  near.current = siblings

  useEffect(() => {
    let token: string | undefined
    let alive = true
    setOpened({ state: 'loading' })
    void window.fb?.media.open(rootId, path).then((result) => {
      if (!alive) {
        if ('token' in result) void window.fb?.media.release(result.token)
        return
      }
      if ('error' in result) return setOpened({ state: 'failed', reason: result.error })
      token = result.token
      setOpened({ state: 'ready', url: result.url, kind: result.kind })
    })
    return () => {
      alive = false
      if (token) void window.fb?.media.release(token)
    }
  }, [rootId, path])

  // Previous and Next: the media files of the folder (or ZIP) the file is in.
  useEffect(() => {
    let alive = true
    void window.fb?.listDir(rootId, dirOf(path)).then((result) => {
      if (alive && 'entries' in result) setSiblings(neighbours(result.entries.filter((e) => e.kind === 'file').map((e) => e.path), path))
    })
    return () => {
      alive = false
    }
  }, [rootId, path])

  // The system's media keys and the notification of the desktop.
  useEffect(() => {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (!session || opened.state !== 'ready') return
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // an action this browser does not have
      }
    }
    try {
      session.metadata = new MediaMetadata({ title: name })
    } catch {
      // no metadata
    }
    set('play', () => void player.current?.play())
    set('pause', () => player.current?.pause())
    set('previoustrack', near.current.previous ? () => goTo.current(near.current.previous!) : null)
    set('nexttrack', near.current.next ? () => goTo.current(near.current.next!) : null)
    return () => {
      for (const action of ['play', 'pause', 'previoustrack', 'nexttrack'] as const) set(action, null)
    }
  }, [opened.state, name, siblings])

  if (opened.state === 'failed') {
    const text = opened.reason === 'too-large' ? t('media.tooLarge') : opened.reason === 'codec' ? t('media.codec') : opened.reason === 'unsupported' ? t('media.unsupported') : t('media.missing')
    return (
      <div role="alert" className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-editor p-6 text-editor-fg select-text">
        <Icon name="warning" className="text-[48px] text-fg-muted" />
        <h2 className="m-0 text-[16px] font-normal break-all">{name}</h2>
        <p className="m-0 max-w-[560px] text-center text-fg-muted">{text}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onOpenWith} className="flex h-[26px] items-center gap-1.5 rounded-sm bg-button px-4 text-[13px] text-button-fg hover:bg-button-hover">
            <Icon name="link-external" />
            {t('tree.openWith')}
          </button>
          <button type="button" onClick={onSave} className="flex h-[26px] items-center gap-1.5 rounded-sm px-4 text-[13px] hover:bg-toolbar-hover">
            <Icon name="save-as" />
            {t('file.saveAs')}
          </button>
        </div>
      </div>
    )
  }

  const ready = opened.state === 'ready' ? opened : null
  const common = {
    ref: player,
    src: ready?.url,
    controls: true,
    loop: repeat,
    preload: 'metadata' as const,
    autoPlay: startNext === path,
    onPlay: () => void (startNext = null),
    onError: () => setOpened({ state: 'failed', reason: 'codec' }),
    // A sound that ends goes on to the next, unless it is to be repeated.
    onEnded: () => {
      if (!repeat && near.current.next) {
        startNext = near.current.next
        goTo.current(near.current.next)
      }
    },
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-editor text-editor-fg">
      <Toolbar>
        <ToolbarButton icon="chevron-left" label={t('media.previous')} disabled={!siblings.previous} onClick={() => siblings.previous && onOpenSibling(siblings.previous)} />
        <ToolbarButton icon="chevron-right" label={t('media.next')} disabled={!siblings.next} onClick={() => siblings.next && onOpenSibling(siblings.next)} />
        <ToolbarButton icon="sync" label={t('media.repeat')} pressed={repeat} onClick={() => setRepeat(!repeat)} />
        <span className="ml-2 min-w-0 truncate text-fg-muted">{name} · {formatBytes(size)}</span>
      </Toolbar>
      {ready?.kind === 'video' ? (
        <video {...common} aria-label={name} className="min-h-0 flex-1 bg-black object-contain" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6">
          <Icon name="unmute" className="text-[96px] text-fg-muted" />
          <h2 className="m-0 text-[16px] font-normal break-all">{name}</h2>
          {ready ? <audio {...common} aria-label={name} className="w-[min(560px,100%)]" /> : null}
        </div>
      )}
    </div>
  )
}
