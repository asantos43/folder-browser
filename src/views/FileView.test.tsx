// @vitest-environment happy-dom
import type { FbApi } from '@core/api.ts'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { csvView, markdownView, markdownWide, markdownWrapCode, svgView } from '@/state/setting.ts'
import { FileView, forgetReads } from './FileView.tsx'
import { ImageView } from './ImageView.tsx'

beforeEach(() => {
  forgetReads()
  localStorage.clear()
  svgView.reload()
  markdownView.reload()
  markdownWide.reload()
  markdownWrapCode.reload()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.fb
})

const PNG = new Uint8Array([137, 80, 78, 71])
const show = (path = 'a.txt', id = 's1') =>
  render(
    <I18nProvider language="en">
      <FileView snapshotId={id} path={path} kind="text" mediaType="text/plain" size={5} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} />
    </I18nProvider>,
  )

describe('FileView: no flash between one file and the next', () => {
  it('shows a blank ground, not a message, while a file is read, and the message only when it is slow', async () => {
    vi.useFakeTimers()
    let done: (r: { bytes: Uint8Array }) => void = () => {}
    window.fb = { readFile: vi.fn(() => new Promise((resolve) => void (done = resolve))) } as unknown as FbApi
    show()
    expect(screen.queryByText('Loading…')).toBeNull()
    act(() => void vi.advanceTimersByTime(100))
    expect(screen.queryByText('Loading…')).toBeNull()
    act(() => void vi.advanceTimersByTime(100))
    expect(screen.getByText('Loading…')).toBeTruthy()
    await act(async () => done({ bytes: new TextEncoder().encode('hello') }))
    expect(screen.queryByText('Loading…')).toBeNull()
    vi.useRealTimers()
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toBe('hello'))
  })

  it('reads a file once: shown again it is there at once, from what was read', async () => {
    const readFile = vi.fn(async () => ({ bytes: new TextEncoder().encode('hello') }))
    window.fb = { readFile } as unknown as FbApi
    const first = show()
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toBe('hello'))
    first.unmount()
    show()
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toBe('hello'))
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('reads again a file of another snapshot, and what belongs to a closed snapshot is forgotten', async () => {
    const readFile = vi.fn(async () => ({ bytes: new TextEncoder().encode('hello') }))
    window.fb = { readFile } as unknown as FbApi
    const shown = async (id: string) => {
      const view = show('a.txt', id)
      await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toBe('hello'))
      view.unmount()
    }
    await shown('s1')
    await shown('s2')
    expect(readFile).toHaveBeenCalledTimes(2)
    forgetReads('s1')
    await shown('s2')
    expect(readFile).toHaveBeenCalledTimes(2)
    await shown('s1')
    expect(readFile).toHaveBeenCalledTimes(3)
  })

  it('does not keep a file that is large, nor more than its budget', async () => {
    const big = new Uint8Array(20 * 2 ** 20)
    const readFile = vi.fn(async () => ({ bytes: big }))
    window.fb = { readFile } as unknown as FbApi
    render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path="big.png" kind="image" mediaType="image/png" size={big.length} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} />
      </I18nProvider>,
    ).unmount()
    render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path="big.png" kind="image" mediaType="image/png" size={big.length} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} />
      </I18nProvider>,
    )
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(2))
  })
})

describe('ImageView: no flash while the picture is fitted', () => {
  it('loads the picture out of sight until its size is known, then shows it at the size it is fitted to', () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    render(
      <I18nProvider language="en">
        <ImageView id="s:p" bytes={PNG} mediaType="image/png" name="p.png" onSave={() => {}} />
      </I18nProvider>,
    )
    const img = screen.getByRole('img', { name: 'p.png' }) as HTMLImageElement
    expect(img.style.opacity).toBe('0')
    expect(img.style.position).toBe('absolute')
    Object.defineProperty(img, 'naturalWidth', { value: 320 })
    Object.defineProperty(img, 'naturalHeight', { value: 160 })
    fireEvent.load(img)
    expect(img.style.opacity).toBe('')
    expect(img.style.position).toBe('')
    expect(img.style.width).not.toBe('1px')
  })
})

describe('FileView: an SVG is a picture and its source', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="teal"/></svg>'
  const showSvg = (path = 'mark.svg') => {
    URL.createObjectURL = vi.fn(() => 'blob:svg')
    URL.revokeObjectURL = vi.fn()
    window.fb = { readFile: vi.fn(async () => ({ bytes: new TextEncoder().encode(SVG) })) } as unknown as FbApi
    return render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path={path} kind="text" mediaType="image/svg+xml" size={SVG.length} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} />
      </I18nProvider>,
    )
  }
  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

  it('is shown as a picture at first, with the switch to its source at the start of the toolbar', async () => {
    showSvg()
    expect(await screen.findByRole('img', { name: 'mark.svg' })).toBeTruthy()
    expect(document.querySelector('.cm-content')).toBeNull()
    expect(pressed('Show the SVG as a picture')).toBe('true')
    expect(pressed('Show the SVG as source code')).toBe('false')
    // The picture's own toolbar is there too.
    expect(screen.getByRole('combobox', { name: 'Zoom' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save As…' })).toBeTruthy()
  })

  it('switches to the source and back, with the same switch in the toolbar of either, and keeps the choice for every SVG', async () => {
    const first = showSvg()
    await screen.findByRole('img', { name: 'mark.svg' })
    fireEvent.click(screen.getByRole('button', { name: 'Show the SVG as source code' }))
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('<circle cx="20"'))
    expect(screen.queryByRole('img', { name: 'mark.svg' })).toBeNull()
    expect(pressed('Show the SVG as source code')).toBe('true')
    // Source is coloured as XML, and has its own toolbar (Word Wrap, Save As).
    expect(screen.getByRole('button', { name: /Wrap long lines/ })).toBeTruthy()
    expect(localStorage.getItem('fb:svgView')).toBe('"code"')
    first.unmount()
    showSvg('other.svg')
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Show the SVG as a picture' }))
    expect(await screen.findByRole('img', { name: 'other.svg' })).toBeTruthy()
    expect(localStorage.getItem('fb:svgView')).toBe('"image"')
  })

  it('is not offered for a text that is not an SVG', async () => {
    window.fb = { readFile: vi.fn(async () => ({ bytes: new TextEncoder().encode('<a/>') })) } as unknown as FbApi
    render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path="a.xml" kind="text" mediaType="application/xml" size={4} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} />
      </I18nProvider>,
    )
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Show the SVG as a picture' })).toBeNull()
  })

  it('gives its source the zoom of the tab', async () => {
    svgView.set('code')
    window.fb = { readFile: vi.fn(async () => ({ bytes: new TextEncoder().encode(SVG) })) } as unknown as FbApi
    render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path="z.svg" kind="text" mediaType="image/svg+xml" size={SVG.length} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} zoom={1.5} />
      </I18nProvider>,
    )
    await waitFor(() => expect(document.querySelector('.cm-editor')?.closest('div[style]')?.getAttribute('style')).toContain('--wsnp-zoom: 1.5'))
  })
})

const other = (path: string, size: number, mediaType?: string) =>
  render(
    <I18nProvider language="en">
      <FileView snapshotId="s1" path={path} kind="other" mediaType={mediaType} size={size} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} />
    </I18nProvider>,
  )

describe('FileView: a file of no known type', () => {
  it('is shown as text when what it holds is text', async () => {
    const readFile = vi.fn(async () => ({ bytes: new TextEncoder().encode('first line\nsecond line') }))
    window.fb = { readFile } as unknown as FbApi
    other('notes.xyz', 22)
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('first line'))
    expect(screen.queryByText('This kind of file is not shown here.')).toBeNull()
  })
  it('is shown in hexadecimal when it is binary', async () => {
    window.fb = { readFile: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 0, 3, 4]) })) } as unknown as FbApi
    other('blob.xyz', 5)
    await waitFor(() => expect(screen.getByRole('grid', { name: 'Hexadecimal view of blob.xyz' })).toBeTruthy())
    expect(screen.getByRole('row').textContent).toContain('0102000304')
    expect(document.querySelector('.cm-content')).toBeNull()
  })
  it('is not read at all when its type is known and not shown (a video)', async () => {
    const readFile = vi.fn()
    window.fb = { readFile } as unknown as FbApi
    other('clip.mp4', 5, 'video/mp4')
    expect(screen.getByText('This kind of file is not shown here.')).toBeTruthy()
    expect(readFile).not.toHaveBeenCalled()
  })
})

describe('FileView: hexadecimal', () => {
  it('shows a program in hexadecimal at once, by its type', async () => {
    window.fb = { readFile: vi.fn(async () => ({ bytes: new Uint8Array([0x4d, 0x5a, 0, 0, 0]) })) } as unknown as FbApi
    render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path="setup.exe" kind="hex" mediaType={undefined} size={5} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByRole('grid', { name: 'Hexadecimal view of setup.exe' })).toBeTruthy())
    await waitFor(() => expect(screen.getByText('MS-DOS executable')).toBeTruthy())
  })
  it('offers "View as hex" on a file that is not shown (a text file too large), which opens its bytes in a tab of their own', () => {
    const readFile = vi.fn()
    window.fb = { readFile } as unknown as FbApi
    const onHex = vi.fn()
    render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path="huge.log" kind="other" mediaType="text/plain" size={9 * 2 ** 20} onSave={() => {}} onHex={onHex} onViewEntry={() => {}} onNotify={() => {}} />
      </I18nProvider>,
    )
    expect(readFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'View as hex' }))
    expect(onHex).toHaveBeenCalledOnce()
  })
  it('reads a big file a window at a time, not whole', async () => {
    const readFile = vi.fn()
    const readRange = vi.fn(async () => ({ bytes: new Uint8Array(65536).fill(65), size: 40 * 2 ** 20 }))
    window.fb = { readFile, readRange } as unknown as FbApi
    render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path="disk.iso" kind="hex" mediaType={undefined} size={40 * 2 ** 20} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByRole('grid', { name: 'Hexadecimal view of disk.iso' })).toBeTruthy())
    expect(readFile).not.toHaveBeenCalled()
  })
})

describe('FileView: CSV', () => {
  const csv = (path: string, body: string) => {
    window.fb = { readFile: vi.fn(async () => ({ bytes: new TextEncoder().encode(body) })) } as unknown as FbApi
    render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path={path} kind="text" mediaType={undefined} size={body.length} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} />
      </I18nProvider>,
    )
  }
  it('is a table at first, and its text when the user switches', async () => {
    csvView.set('table')
    csv('boats.csv', 'Boat,Seats\nGull,12\n')
    await waitFor(() => expect(screen.getByRole('table', { name: 'Table of boats.csv' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Show the file as text' }))
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('Gull,12'))
    expect(screen.getByRole('button', { name: 'Show the file as a table' })).toBeTruthy()
    csvView.set('table')
  })
  it('reads a TSV by its tabs', async () => {
    csvView.set('table')
    csv('boats.tsv', 'Boat\tSeats\nGull\t12\n')
    await waitFor(() => expect(screen.getByRole('cell', { name: '12' })).toBeTruthy())
  })
})

describe('FileView: Markdown', () => {
  const MD = '# Harbor notes\n\nThe ferry leaves at **noon**.\n\n- [site](https://example.com/x)\n- <b>raw</b>\n- [bad](javascript:alert(1))\n\n![the map](assets/map.png)\n'
  const markdown = (zoom = 1) => {
    window.fb = { readFile: vi.fn(async () => ({ bytes: new TextEncoder().encode(MD) })), openExternal: vi.fn(async () => {}) } as unknown as FbApi
    render(
      <I18nProvider language="en">
        <FileView snapshotId="s1" path="docs/README.md" kind="text" mediaType="text/markdown" size={MD.length} onSave={() => {}} onHex={() => {}} onViewEntry={() => {}} onNotify={() => {}} zoom={zoom} />
      </I18nProvider>,
    )
  }
  it('opens formatted, with a button for the text and one for the formatting, and the choice is kept', async () => {
    markdown()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Harbor notes' })).toBeTruthy())
    expect(document.querySelector('strong')?.textContent).toBe('noon')
    expect(document.querySelector('.cm-content')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show the Markdown formatted, as it reads' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Show the Markdown as text' }))
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('# Harbor notes'))
    expect(screen.getByRole('button', { name: 'Show the Markdown as text' }).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('fb:markdownView')).toBe('"text"')
    fireEvent.click(screen.getByRole('button', { name: 'Show the Markdown formatted, as it reads' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Harbor notes' })).toBeTruthy())
  })
  it('shows raw HTML as text, drops a link that is not a web address, and loads no picture', async () => {
    markdown()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Harbor notes' })).toBeTruthy())
    const page = document.querySelector('.markdown-body')!
    expect(page.querySelector('b')).toBeNull()
    expect(page.textContent).toContain('<b>raw</b>')
    expect(page.querySelector('img')).toBeNull()
    expect(page.querySelector('.md-image')?.textContent).toBe('the map')
    expect(page.querySelector('a[href^="javascript"]')).toBeNull()
    expect(page.querySelectorAll('a[href]')).toHaveLength(1)
  })
  it('opens a web link in the browser and never in the window', async () => {
    markdown()
    await waitFor(() => expect(screen.getByRole('link', { name: 'site' })).toBeTruthy())
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => void screen.getByRole('link', { name: 'site' }).dispatchEvent(click))
    expect(click.defaultPrevented).toBe(true)
    expect(window.fb!.openExternal).toHaveBeenCalledWith('https://example.com/x')
  })
  it('can be as wide as the window, and its code blocks can wrap; both choices are kept', async () => {
    markdown()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Harbor notes' })).toBeTruthy())
    const page = () => document.querySelector('.markdown-body')!
    expect(page().classList.contains('wide')).toBe(false)
    expect(page().classList.contains('wrap-code')).toBe(false)
    const wide = screen.getByRole('button', { name: 'Use the whole width of the window, not a reading column' })
    const wrap = screen.getByRole('button', { name: 'Wrap long lines of code blocks' })
    expect(wide.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(wide)
    fireEvent.click(wrap)
    expect(page().classList.contains('wide')).toBe(true)
    expect(page().classList.contains('wrap-code')).toBe(true)
    expect(wide.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('fb:markdownWide')).toBe('true')
    expect(localStorage.getItem('fb:markdownWrapCode')).toBe('true')
    fireEvent.click(wide)
    expect(page().classList.contains('wide')).toBe(false)
  })
  it('follows the zoom of the tab', async () => {
    markdown(1.5)
    await waitFor(() => expect(document.querySelector('.markdown-body')?.parentElement?.getAttribute('style')).toContain('--wsnp-zoom: 1.5'))
  })
  it('is not offered for a text that is not Markdown', async () => {
    window.fb = { readFile: vi.fn(async () => ({ bytes: new TextEncoder().encode('plain') })) } as unknown as FbApi
    show()
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Show the Markdown as text' })).toBeNull()
  })
})
