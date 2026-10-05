// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { translator } from '@/i18n/index.ts'
import { snapshotInfo } from '@/test/fixtures.ts'
import { empty, reduce, type Action, type Workspace } from '@/state/workspace.ts'
import { describeTabs } from './tabInfo.ts'
import { TabStrip } from './TabStrip.tsx'

afterEach(cleanup)

const build = (...actions: Action[]): Workspace => actions.reduce(reduce, empty)
const opened = (id: string, title?: string): Action => ({ type: 'snapshot-opened', snapshot: snapshotInfo(id, title) })
function show(ws: Workspace) {
  const dispatch = vi.fn()
  const onCopy = vi.fn()
  const onReveal = vi.fn()
  render(
    <I18nProvider language="en">
      <TabStrip ws={ws} views={describeTabs(ws, translator('en'))} dispatch={dispatch} onCopy={onCopy} onReveal={onReveal} />
    </I18nProvider>,
  )
  return { dispatch, onCopy, onReveal }
}

describe('TabStrip', () => {
  it('shows a tab for each snapshot and file, the active one selected, a preview in italics', () => {
    const ws = build(opened('a', 'Alpha'), opened('b', 'Beta'), { type: 'open-file', snapshotId: 'b', path: 'assets/styles/site.css', keep: false })
    show(ws)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.querySelector('span.truncate')?.textContent)).toEqual(['Alpha', 'Beta', 'site.css'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true'])
    expect(tabs[2].querySelector('span.truncate')?.className).toContain('italic')
    expect(tabs[0].querySelector('span.truncate')?.className).not.toContain('italic')
  })
  it('says where a tab is from when two have the same name', () => {
    const ws = build(opened('a', 'Alpha'), opened('b', 'Beta'), { type: 'open-file', snapshotId: 'a', path: 'index.html', keep: true }, { type: 'open-file', snapshotId: 'b', path: 'index.html', keep: true })
    show(ws)
    const same = screen.getAllByRole('tab').filter((t) => t.textContent?.includes('index.html'))
    expect(same.map((t) => t.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Alpha'), expect.stringContaining('Beta')]))
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
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Close', 'Close Others', 'Close to the Right', 'Close All', 'Pin', 'Show Metadata', 'Copy Source Address', 'Reveal in File Manager'])
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
