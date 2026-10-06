// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { csvView } from '@/state/setting.ts'
import { CsvView } from './CsvView.tsx'

beforeEach(() => {
  localStorage.clear()
  csvView.reload()
})
afterEach(cleanup)

const show = (text: string, tab = false, onSave = vi.fn()) => {
  render(
    <I18nProvider language="en">
      <CsvView text={text} name="boats.csv" tab={tab} onSave={onSave} />
    </I18nProvider>,
  )
  return onSave
}

describe('CsvView', () => {
  it('draws the first row as the header and numbers the rows under it', () => {
    show('Boat,Seats\nGull,12\nHeron,8\n')
    const table = screen.getByRole('table', { name: 'Table of boats.csv' })
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(3)
    expect(screen.getByRole('columnheader', { name: 'Boat' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Gull' })).toBeTruthy()
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['2', '3'])
    expect(screen.getByText('3 rows, 2 columns')).toBeTruthy()
  })
  it('reads a semicolon file and a TSV', () => {
    show('nome;preço\nmaçã;1,5\n')
    expect(screen.getByRole('cell', { name: '1,5' })).toBeTruthy()
    cleanup()
    show('a\tb\n1\t2\n', true)
    expect(screen.getByRole('cell', { name: '2' })).toBeTruthy()
  })
  it('shows what a cell holds as text, never as markup', () => {
    show('x\n<img src=x onerror=alert(1)><b>bold</b>\n')
    expect(document.querySelector('table img')).toBeNull()
    expect(document.querySelector('table b')).toBeNull()
    expect(screen.getByRole('cell').textContent).toBe('<img src=x onerror=alert(1)><b>bold</b>')
  })
  it('says when only the start of a big file is drawn', () => {
    show(`h\n${'x\n'.repeat(5200)}`)
    expect(screen.getByText('Only the first 5000 rows and 200 columns are shown.')).toBeTruthy()
  })
  it('has the switch to the text, which remembers the choice, and Save As', () => {
    const onSave = show('a,b\n1,2\n')
    expect(screen.getByRole('button', { name: 'Show the file as a table' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Show the file as text' }))
    expect(csvView.get()).toBe('text')
    expect(localStorage.getItem('fb:csvView')).toBe('"text"')
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(onSave).toHaveBeenCalledOnce()
  })
  it('has View as hex and Open With…', () => {
    const onHex = vi.fn()
    const onOpenWith = vi.fn()
    render(
      <I18nProvider language="en">
        <CsvView text={'a,b\n1,2\n'} name="x.csv" tab={false} onSave={() => {}} onHex={onHex} onOpenWith={onOpenWith} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View as hex' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open With…' }))
    expect(onHex).toHaveBeenCalledOnce()
    expect(onOpenWith).toHaveBeenCalledOnce()
  })
})
