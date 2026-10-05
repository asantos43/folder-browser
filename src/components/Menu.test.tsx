// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MenuList, type MenuEntry } from './Menu.tsx'

afterEach(cleanup)

const entries = (run = vi.fn()): MenuEntry[] => [
  { id: 'a', label: 'Alpha', shortcut: 'Ctrl+A', run },
  { separator: true },
  { id: 'b', label: 'Beta', disabled: true },
  { id: 'c', label: 'Gamma', checked: true },
]

describe('MenuList', () => {
  const lit = () => [...document.querySelectorAll('[role^="menuitem"]')].filter((i) => i.getAttribute('data-active') === 'true').map((i) => i.textContent)
  it('lights nothing when it is opened with the mouse, and keeps the focus on the menu so that Enter runs nothing', () => {
    const run = vi.fn()
    render(<MenuList entries={entries(run)} label="Test" onClose={() => {}} />)
    expect(lit()).toEqual([])
    expect(document.activeElement).toBe(screen.getByRole('menu'))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' })
    expect(run).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(lit()).toEqual([expect.stringContaining('Alpha')])
  })
  it('lights one item at a time: the one the pointer is over, then the one an arrow key moves to', () => {
    render(<MenuList entries={entries()} label="Test" onClose={() => {}} />)
    fireEvent.mouseEnter(screen.getByRole('menuitemcheckbox', { name: /Gamma/ }))
    expect(lit()).toEqual([expect.stringContaining('Gamma')])
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Alpha/ }))
    expect(lit()).toEqual([expect.stringContaining('Alpha')])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(lit()).toEqual([expect.stringContaining('Gamma')])
    // A disabled item is never lit, not even under the pointer.
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Beta/ }))
    expect(lit()).toEqual([expect.stringContaining('Gamma')])
  })
  it('focuses and lights the first enabled item when it is opened from the keyboard (autoSelect), and shows the shortcut and the check', () => {
    render(<MenuList entries={entries()} label="Test" onClose={() => {}} autoSelect />)
    expect(lit()).toEqual([expect.stringContaining('Alpha')])
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Alpha/ }))
    expect(screen.getByText('Ctrl+A')).toBeTruthy()
    expect(screen.getByRole('menuitemcheckbox', { name: /Gamma/ }).getAttribute('aria-checked')).toBe('true')
  })
  it('moves with the arrows, skipping the disabled item and wrapping around', () => {
    render(<MenuList entries={entries()} label="Test" onClose={() => {}} autoSelect />)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: /Gamma/ }))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Alpha/ }))
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: /Gamma/ }))
  })
  it('runs an item and closes; a disabled item does nothing', () => {
    const run = vi.fn()
    const onClose = vi.fn()
    render(<MenuList entries={entries(run)} label="Test" onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /Beta/ }))
    expect(run).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: /Alpha/ }))
    expect(run).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('opens a submenu with the right arrow, closes it with the left one, and runs an item of it', () => {
    const run = vi.fn()
    const onClose = vi.fn()
    const items: MenuEntry[] = [{ id: 'recent', label: 'Open Recent', submenu: [{ id: 'one', label: 'One.wsnp', run }, { id: 'clear', label: 'Clear' }] }, { id: 'x', label: 'Other' }]
    render(<MenuList entries={items} label="File" onClose={onClose} autoSelect />)
    expect(screen.queryByRole('menu', { name: 'Open Recent' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu', { name: 'File' }), { key: 'ArrowRight' })
    const submenu = screen.getByRole('menu', { name: 'Open Recent' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One.wsnp' }))
    fireEvent.keyDown(submenu, { key: 'ArrowLeft' })
    expect(screen.queryByRole('menu', { name: 'Open Recent' })).toBeNull()
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Open Recent/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'One.wsnp' }))
    expect(run).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('closes on Escape and hands over to the neighbouring menu on the side arrows', () => {
    const onClose = vi.fn()
    const onSide = vi.fn()
    render(<MenuList entries={entries()} label="Test" onClose={onClose} onSide={onSide} />)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowRight' })
    fireEvent.keyDown(menu, { key: 'ArrowLeft' })
    expect(onSide.mock.calls).toEqual([[1], [-1]])
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
