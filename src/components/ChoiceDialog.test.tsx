// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { ChoiceDialog } from './ChoiceDialog.tsx'

afterEach(cleanup)

const show = () => {
  const handlers = { save: vi.fn(), dont: vi.fn(), cancel: vi.fn() }
  render(
    <I18nProvider language="en">
      <ChoiceDialog title="Save changes?" message="a.txt has changes" onCancel={handlers.cancel} choices={[{ label: 'Save', primary: true, run: handlers.save }, { label: 'Don’t Save', run: handlers.dont }]} />
    </I18nProvider>,
  )
  return handlers
}

describe('ChoiceDialog', () => {
  it('has the question, each choice and Cancel, and the primary choice has the focus', () => {
    show()
    expect(screen.getByRole('alertdialog', { name: 'Save changes?' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Don’t Save' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
  it('runs the choice that is clicked, and Cancel and Escape say no', () => {
    const { save, dont, cancel } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Don’t Save' }))
    expect(dont).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(cancel).toHaveBeenCalledTimes(2)
  })
  it('goes through the buttons with Tab, round and round', () => {
    show()
    const dialog = screen.getByRole('alertdialog')
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Don’t Save' }))
    fireEvent.keyDown(dialog, { key: 'Tab' })
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }))
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })
})
