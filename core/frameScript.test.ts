// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FRAME_SCRIPT, readFrameMessage, WHEEL_STEP, wheelSteps } from './frameScript.ts'

const added: [string, EventListenerOrEventListenerObject, AddEventListenerOptions | boolean | undefined][] = []
const add = window.addEventListener.bind(window)
window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
  added.push([type, fn, options])
  add(type, fn, options)
}) as typeof window.addEventListener
// Each test has a page of its own: what the script of the one before listened to goes.
afterEach(() => {
  for (const [type, fn, options] of added.splice(0)) window.removeEventListener(type, fn, options)
})

/** The script run in a page: its wheel and key events, and what it posts to the parent. */
function runInPage() {
  const posted: unknown[] = []
  const window_ = window as unknown as { parent: unknown; __wsnpZoom?: boolean }
  const parent = { postMessage: vi.fn((m: unknown) => void posted.push(m)) }
  Object.defineProperty(window_, 'parent', { value: parent, configurable: true })
  delete window_.__wsnpZoom
  new Function(FRAME_SCRIPT)()
  return posted
}
const key = (init: KeyboardEventInit) => {
  const e = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  window.dispatchEvent(e)
  return e
}
// (happy-dom's WheelEvent does not take the modifier keys of its init.)
const wheel = (init: WheelEventInit) => {
  const e = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init })
  if (init.ctrlKey) Object.defineProperty(e, 'ctrlKey', { value: true })
  window.dispatchEvent(e)
  return e
}

describe('the script run in a page of a snapshot', () => {
  it('posts the direction of the zoom keys, with Control or Command, and keeps them from the page', () => {
    const posted = runInPage()
    for (const [init, direction] of [[{ key: '=', ctrlKey: true }, 'in'], [{ key: '+', ctrlKey: true, shiftKey: true }, 'in'], [{ key: '-', ctrlKey: true }, 'out'], [{ key: '0', metaKey: true }, 'reset']] as const) {
      expect(key(init).defaultPrevented, `${init.key}`).toBe(true)
      expect(posted.at(-1)).toEqual({ wsnp: 'wsnp-zoom', direction })
    }
    expect(posted).toHaveLength(4)
  })

  it('leaves every other key to the page, and the zoom keys without Control, or with Alt', () => {
    const posted = runInPage()
    expect(key({ key: '=' }).defaultPrevented).toBe(false)
    expect(key({ key: 'a', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(key({ key: '=', ctrlKey: true, altKey: true }).defaultPrevented).toBe(false)
    expect(posted).toEqual([])
  })

  it('posts the turn of the wheel with Control held, and keeps the browser from zooming the window; an ordinary wheel scrolls', () => {
    const posted = runInPage()
    expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true)
    expect(posted).toEqual([{ wsnp: 'wsnp-zoom', wheel: -100 }])
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false)
    expect(wheel({ deltaY: 0, ctrlKey: true }).defaultPrevented).toBe(false)
    expect(posted).toHaveLength(1)
  })

  it('is put in a page once', () => {
    const posted = runInPage()
    new Function(FRAME_SCRIPT)()
    key({ key: '=', ctrlKey: true })
    expect(posted).toHaveLength(1)
  })
})

describe('the links of a page', () => {
  /** A page at a made-up address with the links of the test, and the pointer moved over one of them. */
  function page(html: string) {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('http://snap1.test/dir/index.html')
    document.body.innerHTML = html
    const posted = runInPage()
    const over = (selector: string, x = 12, y = 34) => {
      const target = document.querySelector(selector) ?? document.body
      target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }))
    }
    return { posted, over }
  }

  it('tells the address of a link the pointer comes over, with where the pointer is, once for each link', () => {
    const { posted, over } = page('<a id="web" href="https://example.com/a?b=1#c"><b id="in">text</b></a>')
    over('#in')
    over('#web', 50, 60)
    expect(posted).toEqual([{ wsnp: 'wsnp-link', link: 'https://example.com/a?b=1#c', x: 12, y: 34 }])
  })

  it('names a link inside the page by its fragment, and a file of the snapshot by its path, as a person reads it', () => {
    const { posted, over } = page('<a id="a" href="#end">end</a><a id="b" href="../assets/files/my%20report.pdf">pdf</a><a id="c" href="index.html#top">top</a>')
    over('#a')
    over('#b')
    over('#c')
    expect(posted.map((m) => (m as { link: string }).link)).toEqual(['#end', 'assets/files/my report.pdf', '#top'])
  })

  it('also tells of the links of an image map', () => {
    const { posted, over } = page('<map><area id="m" href="https://example.com/m"></map>')
    over('#m')
    expect(posted).toEqual([{ wsnp: 'wsnp-link', link: 'https://example.com/m', x: 12, y: 34 }])
  })

  it('tells when the pointer leaves the link, and not again; a script address and a link without one say nothing', () => {
    const { posted, over } = page('<a id="a" href="https://example.com/">a</a><a id="js" href="javascript:alert(1)">js</a><a id="none">none</a><p id="p">p</p>')
    over('#js')
    over('#none')
    over('#p')
    expect(posted).toEqual([])
    over('#a')
    over('#p')
    over('#p')
    expect(posted.map((m) => (m as { link: unknown }).link)).toEqual(['https://example.com/', null])
  })

  it.each([
    ['the pointer is pressed', () => window.dispatchEvent(new MouseEvent('mousedown'))],
    ['the page scrolls', () => window.dispatchEvent(new Event('scroll'))],
    ['the wheel turns', () => wheel({ deltaY: 10 })],
  ])('takes the tooltip back when %s', (_name, event) => {
    const { posted, over } = page('<a id="a" href="https://example.com/">a</a>')
    over('#a')
    event()
    expect(posted.map((m) => (m as { link: unknown }).link)).toEqual(['https://example.com/', null])
  })

  it('cuts a very long address', () => {
    const { posted, over } = page(`<a id="a" href="https://example.com/${'x'.repeat(5000)}">a</a>`)
    over('#a')
    expect((posted[0] as { link: string }).link).toHaveLength(2000)
  })
})

describe('readFrameMessage', () => {
  it('takes a link with its place, or none, and nothing else of a link', () => {
    expect(readFrameMessage({ wsnp: 'wsnp-link', link: 'https://a.test/', x: 1, y: 2 })).toEqual({ link: 'https://a.test/', x: 1, y: 2 })
    expect(readFrameMessage({ wsnp: 'wsnp-link', link: null })).toEqual({ link: null })
    expect(readFrameMessage({ wsnp: 'wsnp-link', link: 'x'.repeat(3000), x: 1, y: 2 })).toMatchObject({ link: 'x'.repeat(2000) })
    for (const bad of [{ wsnp: 'wsnp-link' }, { wsnp: 'wsnp-link', link: '' , x: 1, y: 2 }, { wsnp: 'wsnp-link', link: 'a', x: 1 }, { wsnp: 'wsnp-link', link: 'a', x: NaN, y: 2 }, { wsnp: 'wsnp-link', link: 5, x: 1, y: 2 }]) {
      expect(readFrameMessage(bad)).toBeNull()
    }
  })

  it('takes a direction or a turn of the wheel, and nothing else', () => {
    expect(readFrameMessage({ wsnp: 'wsnp-zoom', direction: 'out' })).toEqual({ direction: 'out' })
    expect(readFrameMessage({ wsnp: 'wsnp-zoom', wheel: -120 })).toEqual({ wheel: -120 })
    for (const bad of [null, 'x', {}, { wsnp: 'other', direction: 'in' }, { wsnp: 'wsnp-zoom' }, { wsnp: 'wsnp-zoom', direction: 'sideways' }, { wsnp: 'wsnp-zoom', wheel: 'big' }, { wsnp: 'wsnp-zoom', wheel: 0 }, { wsnp: 'wsnp-zoom', wheel: Infinity }]) {
      expect(readFrameMessage(bad)).toBeNull()
    }
  })
})

describe('wheelSteps', () => {
  it('makes a step for a notch of a mouse, up zooming in and down out', () => {
    expect(wheelSteps(0, -100)).toEqual({ steps: 1, rest: 0 })
    expect(wheelSteps(0, 100)).toEqual({ steps: -1, rest: 0 })
    expect(wheelSteps(30, -120)).toEqual({ steps: 1, rest: 0 })
  })
  it('adds up the small turns of a trackpad, and carries what is left over', () => {
    let carried = 0
    let total = 0
    for (let i = 0; i < 30; i++) {
      const { steps, rest } = wheelSteps(carried, -10)
      total += steps
      carried = rest
    }
    expect(total).toBe(300 / WHEEL_STEP)
    expect(wheelSteps(0, -30)).toEqual({ steps: 0, rest: 30 })
    // Turning back before a step is made takes the carried turns back.
    expect(wheelSteps(30, 20)).toEqual({ steps: 0, rest: 10 })
  })
})
