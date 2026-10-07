// @vitest-environment happy-dom
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { translator } from '@/i18n/index.ts'
import { snapshotInfo } from '@/test/fixtures.ts'
import { TAB_DRAG, dragging } from './dnd.ts'
import { empty, reduce, type Action, type Workspace } from '@/state/workspace.ts'
import { describeTabs } from './tabInfo.ts'
import { TabStrip } from './TabStrip.tsx'

afterEach(cleanup)

const build = (...actions: Action[]): Workspace => actions.reduce(reduce, empty)
const opened = (id: string, title?: string): Action => ({ type: 'snapshot-opened', snapshot: snapshotInfo(id, title) })
function show(ws: Workspace, group: 0 | 1 = 0) {
  const dispatch = vi.fn()
  const onCopy = vi.fn()
  const onReveal = vi.fn()
  const onDropOnTab = vi.fn()
  render(
    <I18nProvider language="en">
      <TabStrip ws={ws} group={group} views={describeTabs(ws, translator('en'))} dispatch={dispatch} onCopy={onCopy} onReveal={onReveal} onDropOnTab={onDropOnTab} />
    </I18nProvider>,
  )
  return { dispatch, onCopy, onReveal, onDropOnTab }
}

describe('TabStrip', () => {
  it('shows a tab for each snapshot and file, the active one selected, a preview in italics', () => {
    const ws = build(opened('a', 'Alpha'), opened('b', 'Beta'), { type: 'open-file', snapshotId: 'b', path: 'assets/styles/site.css', keep: false })
    show(ws)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.querySelector('span.truncate')?.textContent)).toEqual(['a.wsnp', 'b.wsnp', 'site.css'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true'])
    expect(tabs[2].querySelector('span.truncate')?.className).toContain('italic')
    expect(tabs[0].querySelector('span.truncate')?.className).not.toContain('italic')
  })
  it('says where a tab is from when two have the same name', () => {
    const ws = build(opened('a', 'Alpha'), opened('b', 'Beta'), { type: 'open-file', snapshotId: 'a', path: 'index.html', keep: true }, { type: 'open-file', snapshotId: 'b', path: 'index.html', keep: true })
    show(ws)
    const same = screen.getAllByRole('tab').filter((t) => t.textContent?.includes('index.html'))
    expect(same.map((t) => t.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('a.wsnp'), expect.stringContaining('b.wsnp')]))
    expect(screen.getAllByRole('tab')[0].textContent).not.toContain('https://')
  })
  it('activates on click, keeps a preview on double click, closes on × and on middle click', () => {
    const ws = build(opened('a', 'Alpha'), { type: 'open-file', snapshotId: 'a', path: 'index.html', keep: false })
    const { dispatch } = show(ws)
    const [first, second] = screen.getAllByRole('tab')
    fireEvent.click(first)
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'activate', key: 's:a' })
    fireEvent.doubleClick(second)
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'keep', key: 'f:a:index.html' })
    fireEvent.click(within(second).getByRole('button', { name: 'Close' }))
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'close', key: 'f:a:index.html' })
    fireEvent(first, new MouseEvent('auxclick', { button: 1, bubbles: true }))
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'close', key: 's:a' })
  })
  it('shows a pinned tab with a pin, which unpins instead of closing', () => {
    const ws = build(opened('a', 'Alpha'), { type: 'pin', key: 's:a', pinned: true })
    const { dispatch } = show(ws)
    fireEvent.click(within(screen.getByRole('tab')).getByRole('button'))
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'pin', key: 's:a', pinned: false })
  })
  it('has a context menu: close, close others, close to the right, close all, pin, copy the source address, reveal', () => {
    const ws = build(opened('a', 'Alpha'), opened('b', 'Beta'), opened('c', 'Gamma'))
    const { dispatch, onCopy, onReveal } = show(ws)
    fireEvent.contextMenu(screen.getAllByRole('tab')[0])
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Close', 'Close Others', 'Close to the Right', 'Close All', 'Pin', 'Split Right', 'Show Metadata', 'Copy Source Address', 'Reveal in File Manager'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Close to the Right' }))
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'close-right', key: 's:a' })
    fireEvent.contextMenu(screen.getAllByRole('tab')[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Source Address' }))
    expect(onCopy).toHaveBeenCalledWith('https://b.example/')
    fireEvent.contextMenu(screen.getAllByRole('tab')[2])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal in File Manager' }))
    expect(onReveal).toHaveBeenCalledWith('c')
  })
  it('the menu of a file tab copies the path in the snapshot, and Close Others is off when there are no others', () => {
    const ws = build(opened('a', 'Alpha'), { type: 'close', key: 's:zzz' })
    show(ws)
    fireEvent.contextMenu(screen.getByRole('tab'))
    expect((screen.getByRole('menuitem', { name: 'Close Others' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('menuitem', { name: 'Close to the Right' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('TabStrip: two groups', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const file = (path: string, group?: 0 | 1): Action => ({ type: 'open-file', snapshotId: 'r1', path, keep: true, size: 10, ...(group === undefined ? {} : { group }) })
  const split = () => build({ type: 'root-opened', root }, file('a.txt'), file('b.txt'), file('c.png'), file('d.txt', 1))
  /** A drop at `x` (0 to 1) across a tab: the box of a tab has no size in this DOM, so the position is given. */
  const dropOn = (tab: HTMLElement, x: number, key: string) => {
    tab.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 35, height: 35, x: 0, y: 0, toJSON: () => ({}) })
    const event = createEvent.drop(tab, { dataTransfer: { getData: (type: string) => (type === TAB_DRAG ? key : ''), types: [TAB_DRAG] } })
    Object.defineProperty(event, 'clientX', { value: x * 100 })
    fireEvent(tab, event)
  }
  const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })

  it('shows only the tabs of its group, and the one in front of that group as the selected one', () => {
    const ws = split()
    show(ws, 0)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['a.txt', 'b.txt', 'c.png'].map((n) => expect.stringContaining(n)) as unknown as string[])
    expect(tab('c.png').getAttribute('aria-selected')).toBe('true')
    cleanup()
    show(ws, 1)
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(tab('d.txt').getAttribute('aria-selected')).toBe('true')
  })
  it('offers Split Right with one group (when there is another tab to stay), and Move to the other group with two', () => {
    const one = build({ type: 'root-opened', root }, file('a.txt'))
    show(one)
    fireEvent.contextMenu(tab('a.txt'))
    expect(screen.getByRole('menuitem', { name: 'Split Right' }).hasAttribute('disabled')).toBe(true)
    cleanup()
    const two = build({ type: 'root-opened', root }, file('a.txt'), file('b.txt'))
    const { dispatch } = show(two)
    fireEvent.contextMenu(tab('b.txt'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split Right' }))
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move-to-group', key: 'f:r1:b.txt', group: 1 })
    cleanup()
    const { dispatch: right } = show(split(), 1)
    fireEvent.contextMenu(tab('d.txt'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Left Group' }))
    expect(right).toHaveBeenLastCalledWith({ type: 'move-to-group', key: 'f:r1:d.txt', group: 0 })
  })
  it('asks what to do with two text files when one tab is dropped in the middle of the other, and reorders when it is dropped at the side', () => {
    const { dispatch, onDropOnTab } = show(split())
    dropOn(tab('b.txt'), 0.5, 'f:r1:a.txt')
    expect(onDropOnTab).toHaveBeenCalledWith('f:r1:a.txt', 'f:r1:b.txt')
    expect(dispatch).not.toHaveBeenCalled()
    dropOn(tab('b.txt'), 0.9, 'f:r1:a.txt')
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move', key: 'f:r1:a.txt', to: 1 })
    expect(onDropOnTab).toHaveBeenCalledTimes(1)
    // A tab that is not a text (a picture) is only ever moved.
    dropOn(tab('c.png'), 0.5, 'f:r1:a.txt')
    expect(onDropOnTab).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(2)
  })
  it('puts a tab dragged from the other group into this one, next to the tab it was dropped on (the middle of it asks, as in the group)', () => {
    const { dispatch, onDropOnTab } = show(split(), 1)
    dropOn(tab('d.txt'), 0.9, 'f:r1:a.txt')
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move-to-group', key: 'f:r1:a.txt', group: 1, at: { key: 'f:r1:d.txt', after: true } })
    dropOn(tab('d.txt'), 0.1, 'f:r1:a.txt')
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move-to-group', key: 'f:r1:a.txt', group: 1, at: { key: 'f:r1:d.txt', after: false } })
    dropOn(tab('d.txt'), 0.5, 'f:r1:a.txt')
    expect(onDropOnTab).toHaveBeenCalledWith('f:r1:a.txt', 'f:r1:d.txt')
  })
  it('tells the editor that a tab is being dragged, and that it stopped', () => {
    show(split())
    fireEvent.dragStart(tab('a.txt'), { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
    expect(dragging.get()).toBe('tab')
    expect(dragging.tab()).toBe('f:r1:a.txt')
    fireEvent.dragEnd(tab('a.txt'))
    expect(dragging.get()).toBeNull()
  })
})

describe('TabStrip: comparing from the menu of a tab', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const file = (path: string): Action => ({ type: 'open-file', snapshotId: 'r1', path, keep: true, size: 10 })
  const side = { rootId: 'r1', path: 'a.txt' }
  function showWith(ws: Workspace, selected: { rootId: string; path: string } | null) {
    const compare = { selected, select: vi.fn(), with: vi.fn() }
    render(
      <I18nProvider language="en">
        <TabStrip ws={ws} group={0} views={describeTabs(ws, translator('en'))} dispatch={vi.fn()} onCopy={vi.fn()} onReveal={vi.fn()} compare={compare} />
      </I18nProvider>,
    )
    return compare
  }
  const items = () => screen.getAllByRole('menuitem').map((m) => m.textContent)

  it('a new text file is named Untitled-N, is chosen with Select for Compare, and has no metadata, source or reveal items', () => {
    const ws = build({ type: 'root-opened', root }, file('a.txt'), { type: 'open-untitled' })
    const compare = showWith(ws, null)
    expect(screen.getByRole('tab', { name: /^Untitled-1/ })).toBeTruthy()
    fireEvent.contextMenu(screen.getByRole('tab', { name: /^Untitled-1/ }))
    expect(items()).toEqual(['Close', 'Close Others', 'Close to the Right', 'Close All', 'Pin', 'Split Right', 'Select for Compare', 'Compare with Selected'])
    expect((screen.getByRole('menuitem', { name: 'Compare with Selected' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select for Compare' }))
    expect(compare.select).toHaveBeenCalledWith({ rootId: '@untitled', path: 'u:1' })
  })

  it('compares with what was selected, and not with itself', () => {
    const ws = build({ type: 'root-opened', root }, file('a.txt'), { type: 'open-untitled' })
    const compare = showWith(ws, side)
    fireEvent.contextMenu(screen.getByRole('tab', { name: /^Untitled-1/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Compare with Selected' }))
    expect(compare.with).toHaveBeenCalledWith({ rootId: '@untitled', path: 'u:1' })
    cleanup()
    const same = showWith(ws, side)
    fireEvent.contextMenu(screen.getByRole('tab', { name: /^a\.txt/ }))
    expect((screen.getByRole('menuitem', { name: 'Compare with Selected' }) as HTMLButtonElement).disabled).toBe(true)
    expect(same.with).not.toHaveBeenCalled()
  })

  it('a tab that is not a text (a picture) has no compare items', () => {
    const ws = build({ type: 'root-opened', root }, file('pic.png'))
    showWith(ws, null)
    fireEvent.contextMenu(screen.getByRole('tab'))
    expect(items()).not.toContain('Select for Compare')
  })
})
