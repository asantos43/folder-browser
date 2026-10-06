// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { Workbench } from './Workbench.tsx'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})
afterEach(cleanup)

const shown = () => render(<I18nProvider language="en"><Workbench /></I18nProvider>)

describe('the workbench', () => {
  it('has the parts of VS Code: title bar, activity bar, side bar, editor group and status bar', () => {
    shown()
    expect(screen.getByTestId('titlebar')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Activity Bar' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Explorer' })).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByRole('contentinfo')).toBeTruthy()
    // Nothing of snapshots until one is open: the side bar is for folders.
    expect(screen.queryByText('No snapshot is open.')).toBeNull()
    expect(screen.queryByRole('listbox', { name: 'Open Snapshots' })).toBeNull()
    expect(screen.getByText('No folder is open.')).toBeTruthy()
  })
  it('draws the menu of VS Code in the title bar (File, Edit, View, Go, Help)', () => {
    shown()
    const bar = screen.getByRole('menubar')
    expect([...bar.querySelectorAll('[role=menuitem]')].map((b) => b.textContent)).toEqual(['File', 'Edit', 'View', 'Go', 'Help'])
  })
  it('toggles the side bar with Ctrl+B and remembers it', () => {
    shown()
    const toggle = screen.getByRole('button', { name: 'Toggle Primary Side Bar' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem('fb:sideBarVisible')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })
  it('toggles the side bar from the View menu', () => {
    shown()
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Toggle Side Bar/ }))
    expect(screen.getByRole('button', { name: 'Toggle Primary Side Bar' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('opens one menu at a time and closes it on Escape', () => {
    shown()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByRole('menu', { name: 'Edit' })).toBeTruthy()
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('closes a menu when the window loses focus (a click inside a snapshot frame)', () => {
    shown()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('switches the theme from the manage menu and keeps the choice', () => {
    shown()
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Light+' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('fb:theme')).toBe('"light"')
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Dark+' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
  it('speaks Brazilian Portuguese when asked', () => {
    render(<I18nProvider language="pt-BR"><Workbench /></I18nProvider>)
    expect([...screen.getByRole('menubar').querySelectorAll('[role=menuitem]')].map((b) => b.textContent)).toEqual(['Arquivo', 'Editar', 'Exibir', 'Ir', 'Ajuda'])
    expect(screen.queryByText('Nenhum snapshot aberto.')).toBeNull()
    expect(screen.getByText('Nenhuma pasta aberta.')).toBeTruthy()
  })
})
