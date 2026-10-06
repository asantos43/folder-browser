// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'

afterEach(cleanup)
function show(danger: boolean) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <I18nProvider language="en">
      <ConfirmDialog title="Empty?" message="For good." confirmLabel="Empty" danger={danger} onConfirm={onConfirm} onCancel={onCancel} />
    </I18nProvider>,
  )
  return { onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('asks, and says yes only to its button', () => {
    const { onConfirm, onCancel } = show(false)
    expect(screen.getByRole('alertdialog', { name: 'Empty?' }).textContent).toContain('For good.')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Empty' }))
    fireEvent.click(screen.getByRole('button', { name: 'Empty' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })
  it('starts on Cancel when the answer is destructive, and Escape, Cancel and a click outside say no', () => {
    const { onConfirm, onCancel } = show(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.mouseDown(screen.getByRole('alertdialog').parentElement!)
    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onConfirm).not.toHaveBeenCalled()
  })
  it('keeps the focus between the two buttons', () => {
    show(true)
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Empty' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })
})
