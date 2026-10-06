// @vitest-environment happy-dom
import type { FbApi, ListResult } from '@core/api.ts'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { MediaView, neighbours } from './MediaView.tsx'

afterEach(() => {
  cleanup()
  delete window.fb
})

const entry = (path: string) => ({ name: path.split('/').at(-1)!, path, kind: 'file' as const, size: 1, modified: '2026-01-01T00:00:00.000Z', hidden: false })
function setup(open: FbApi['media']['open'] = async () => ({ token: 'm1', url: 'fb-media://m1/', kind: 'audio', mime: 'audio/mpeg', size: 9 }), siblings: string[] = ['music/a.mp3', 'music/b.mp3', 'music/c.mp3', 'music/cover.jpg', 'music/notes.txt']) {
  const release = vi.fn(async () => {})
  const listDir = vi.fn(async (): Promise<ListResult> => ({ entries: siblings.map(entry), truncated: false }))
  window.fb = { media: { open: vi.fn(open), release }, listDir } as unknown as FbApi
  const handlers = { onOpenSibling: vi.fn(), onOpenWith: vi.fn(), onSave: vi.fn() }
  const view = (path: string) => (
    <I18nProvider language="en">
      <MediaView rootId="r1" path={path} size={9} {...handlers} />
    </I18nProvider>
  )
  return { release, listDir, handlers, ...render(view('music/b.mp3')) }
}

describe('neighbours', () => {
  it('names the media files before and after one, in the order of the tree, and none for the ends or for a file that is not there', () => {
    const names = ['m/10.mp3', 'm/2.mp3', 'm/1.mp3', 'm/cover.jpg', 'm/Intro.wav']
    expect(neighbours(names, 'm/2.mp3')).toEqual({ previous: 'm/1.mp3', next: 'm/10.mp3' })
    expect(neighbours(names, 'm/1.mp3')).toEqual({ next: 'm/2.mp3' })
    expect(neighbours(names, 'm/Intro.wav')).toEqual({ previous: 'm/10.mp3' })
    expect(neighbours(names, 'm/gone.mp3')).toEqual({})
    expect(neighbours(['a.mp3'], 'a.mp3')).toEqual({})
  })
})

describe('MediaView', () => {
  it('plays a sound with the browser’s own player, from the address the main process gave, and asks for the folder of the file', async () => {
    const { listDir } = setup()
    const audio = await waitFor(() => {
      const el = document.querySelector('audio')
      if (!el) throw new Error('no player yet')
      return el
    })
    expect(audio.getAttribute('src')).toBe('fb-media://m1/')
    expect(audio.hasAttribute('controls')).toBe(true)
    expect(audio.getAttribute('aria-label')).toBe('b.mp3')
    expect(window.fb!.media.open).toHaveBeenCalledWith('r1', 'music/b.mp3')
    expect(listDir).toHaveBeenCalledWith('r1', 'music')
  })
  it('shows a video in a video element', async () => {
    setup(async () => ({ token: 'm2', url: 'fb-media://m2/', kind: 'video', mime: 'video/mp4', size: 9 }))
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe('fb-media://m2/'))
    expect(document.querySelector('audio')).toBeNull()
  })
  it('goes to the file before and after, with the buttons; the first and the last have only one', async () => {
    const { handlers } = setup()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(handlers.onOpenSibling).toHaveBeenLastCalledWith('music/c.mp3')
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(handlers.onOpenSibling).toHaveBeenLastCalledWith('music/a.mp3')
    cleanup()
    setup(undefined, ['music/b.mp3'])
    await screen.findByRole('toolbar')
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('goes on to the next when a sound ends, and repeats instead when asked', async () => {
    const { handlers } = setup()
    const audio = await waitFor(() => {
      const el = document.querySelector('audio')
      if (!el) throw new Error('no player yet')
      return el
    })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Repeat' }))
    expect(screen.getByRole('button', { name: 'Repeat' }).getAttribute('aria-pressed')).toBe('true')
    expect(audio.loop).toBe(true)
    fireEvent.ended(audio)
    expect(handlers.onOpenSibling).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Repeat' }))
    fireEvent.ended(audio)
    expect(handlers.onOpenSibling).toHaveBeenCalledWith('music/c.mp3')
  })
  it('lets the address go when the tab closes, and when another file takes its place', async () => {
    const { release, unmount } = setup()
    await waitFor(() => expect(document.querySelector('audio')).not.toBeNull())
    expect(release).not.toHaveBeenCalled()
    unmount()
    expect(release).toHaveBeenCalledWith('m1')
  })
  it('says in words what cannot be played, and offers Open With… and Save As', async () => {
    const { handlers } = setup(async () => ({ error: 'too-large' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('too large to be played from a ZIP')
    fireEvent.click(screen.getByRole('button', { name: 'Open With…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(handlers.onOpenWith).toHaveBeenCalledTimes(1)
    expect(handlers.onSave).toHaveBeenCalledTimes(1)
  })
  it('says the format is not known when the player fails on it', async () => {
    setup()
    const audio = await waitFor(() => {
      const el = document.querySelector('audio')
      if (!el) throw new Error('no player yet')
      return el
    })
    act(() => void fireEvent.error(audio))
    expect((await screen.findByRole('alert')).textContent).toContain('does not know its format')
    expect(screen.getByRole('button', { name: 'Open With…' })).toBeTruthy()
  })
})
