// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { PropertiesDialog } from './PropertiesDialog.tsx'

afterEach(cleanup)
const entry = { name: 'a.txt', path: 'docs/a.txt', kind: 'file' as const, size: 2048, modified: '2026-03-01T10:00:00.000Z', hidden: false }
const show = (e = entry, onClose = vi.fn()) => (render(<I18nProvider language="en"><PropertiesDialog entry={e} location="/home/me/work/docs/a.txt" onClose={onClose} /></I18nProvider>), onClose)

describe('PropertiesDialog', () => {
  it('says the name, the place, the kind, the size and whether it is hidden', () => {
    show()
    const dialog = screen.getByRole('dialog', { name: 'Properties' })
    expect(dialog.textContent).toContain('/home/me/work/docs/a.txt')
    expect(dialog.textContent).toContain('File')
    expect(dialog.textContent).toContain('2.0 KB (2,048 B)')
    expect(screen.getByText('Hidden').nextSibling?.textContent).toBe('No')
  })
  it('has no size for a folder, and says when a file is hidden or a link', () => {
    show({ ...entry, kind: 'file', hidden: true, link: true } as typeof entry)
    expect(screen.getByText('Hidden').nextSibling?.textContent).toBe('Yes')
    expect(screen.getByText('Symbolic link')).toBeTruthy()
    cleanup()
    show({ ...entry, kind: 'dir' as never })
    expect(screen.queryByText('Size')).toBeNull()
  })
  it('closes with Escape and with the button', () => {
    const onClose = show()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
