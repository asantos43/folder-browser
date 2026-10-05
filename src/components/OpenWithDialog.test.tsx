// @vitest-environment happy-dom
import type { Chooser } from '@core/api.ts'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { OpenWithDialog } from './OpenWithDialog.tsx'

afterEach(cleanup)

const chooser: Chooser = {
  token: 't1',
  name: 'photo.png',
  mime: 'image/png',
  mimeLabel: 'PNG image',
  apps: [
    { id: 'loupe.desktop', name: 'Image Viewer', recommended: true, iconUrl: 'data:image/png;base64,AA==' },
    { id: 'chrome.desktop', name: 'Google Chrome', recommended: true },
    { id: 'editor.desktop', name: 'Text Editor', recommended: false },
    { id: 'pinta.desktop', name: 'Pinta Image Editor', recommended: false },
  ],
}
const show = (overrides: Partial<Chooser> = {}) => {
  const onChoose = vi.fn()
  const onCancel = vi.fn()
  render(
    <I18nProvider language="en">
      <OpenWithDialog chooser={{ ...chooser, ...overrides }} onChoose={onChoose} onCancel={onCancel} />
    </I18nProvider>,
  )
  return { onChoose, onCancel }
}
const names = () => screen.getAllByRole('option').map((o) => o.textContent)
const picked = () => screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent)

describe('OpenWithDialog', () => {
  it('says which file, lists the recommended apps and then the others, with the first picked and the search box focused', () => {
    show()
    const dialog = screen.getByRole('dialog', { name: 'Open With' })
    expect(dialog.textContent).toContain('Choose an app to open photo.png')
    expect(names()).toEqual(['Image Viewer', 'Google Chrome', 'Text Editor', 'Pinta Image Editor'])
    expect(screen.getByText('Recommended Apps')).toBeTruthy()
    expect(screen.getByText('Other Apps')).toBeTruthy()
    expect(picked()).toEqual(['Image Viewer'])
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search apps' }))
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==')
    expect(screen.getByText('PNG image')).toBeTruthy()
  })

  it('opens the one picked, with the button, with Enter and with a double click', () => {
    const { onChoose } = show()
    fireEvent.click(screen.getByRole('option', { name: 'Google Chrome' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onChoose).toHaveBeenLastCalledWith('chrome.desktop', false)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })
    expect(onChoose).toHaveBeenLastCalledWith('chrome.desktop', false)
    fireEvent.doubleClick(screen.getByRole('option', { name: 'Pinta Image Editor' }))
    expect(onChoose).toHaveBeenLastCalledWith('pinta.desktop', false)
    expect(onChoose).toHaveBeenCalledTimes(3)
  })

  it('moves with the arrows, through both lists, and stops at the ends', () => {
    show()
    const dialog = screen.getByRole('dialog')
    for (const expected of ['Google Chrome', 'Text Editor', 'Pinta Image Editor', 'Pinta Image Editor']) {
      fireEvent.keyDown(dialog, { key: 'ArrowDown' })
      expect(picked()).toEqual([expected])
    }
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    expect(picked()).toEqual(['Text Editor'])
  })

  it('searches by name, keeps the pick among what is shown, and says when nothing matches', () => {
    const { onChoose } = show()
    const box = screen.getByRole('textbox', { name: 'Search apps' })
    fireEvent.change(box, { target: { value: 'IMAGE' } })
    expect(names()).toEqual(['Image Viewer', 'Pinta Image Editor'])
    expect(screen.queryByText('Other Apps')).toBeTruthy()
    fireEvent.change(box, { target: { value: 'pinta' } })
    expect(names()).toEqual(['Pinta Image Editor'])
    expect(picked()).toEqual(['Pinta Image Editor'])
    expect(screen.queryByText('Recommended Apps')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onChoose).toHaveBeenCalledWith('pinta.desktop', false)
    fireEvent.change(box, { target: { value: 'zzz' } })
    expect(screen.getByText('No application found.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('passes "Always use for this file type" on, and names the type beside it', () => {
    const { onChoose } = show()
    const toggle = screen.getByRole('switch', { name: 'Always use for this file type' })
    expect((toggle as HTMLInputElement).checked).toBe(false)
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onChoose).toHaveBeenCalledWith('loupe.desktop', true)
  })

  it('cancels with the button, with Escape, and with a click outside', () => {
    const { onCancel } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(onCancel).toHaveBeenCalledTimes(3)
  })

  it('has a picture to show for an application that has no icon', () => {
    show({ apps: [{ id: 'a.desktop', name: 'Plain', recommended: true }] })
    expect(within(screen.getByRole('option')).queryByRole('img')).toBeNull()
    expect(screen.getByRole('option').querySelector('.codicon')).toBeTruthy()
  })
})
