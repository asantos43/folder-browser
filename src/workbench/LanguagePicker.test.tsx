// @vitest-environment happy-dom
import { LANGUAGES } from '@core/filekind.ts'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { en } from '@/i18n/en.ts'
import { ptBR } from '@/i18n/pt-BR.ts'
import { fileLanguage, shownSource } from '@/state/fileLanguage.ts'
import { LanguagePicker } from './LanguagePicker.tsx'

beforeEach(() => fileLanguage.clear())
afterEach(cleanup)

const file = { key: 's1:defs.inc', language: 'pascal', detected: 'pascal' } as const
const open = (onClose = vi.fn(), language: 'en' | 'pt-BR' = 'en') => {
  render(
    <I18nProvider language={language}>
      <LanguagePicker file={file} onClose={onClose} />
    </I18nProvider>,
  )
  return onClose
}
const options = () => screen.getAllByRole('option').map((o) => o.textContent ?? '')

describe('LanguagePicker', () => {
  it('lists Auto Detect (with the detected language), Plain Text first, then every language by name', () => {
    open()
    const names = options()
    expect(names[0]).toBe('Auto DetectPascal')
    expect(names[1]).toBe('Plain Text')
    expect(names).toHaveLength(LANGUAGES.length + 1)
    expect(names).toContain('PHP')
    expect(names).toContain('Shell Script')
    const rest = names.slice(2)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
  })
  it('filters by what is typed, and Enter picks the first match for this file', () => {
    const onClose = open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'php' } })
    expect(options()).toEqual(['PHP'])
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(fileLanguage.get(file.key)).toBe('php')
    expect(fileLanguage.get('s1:other.inc')).toBeUndefined()
    expect(onClose).toHaveBeenCalled()
  })
  it('walks the list with the arrows, and a click picks', () => {
    open()
    const box = screen.getByRole('combobox')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(fileLanguage.get(file.key)).toBe('plain')
    cleanup()
    open()
    fireEvent.click(screen.getByRole('option', { name: /^Python/ }))
    expect(fileLanguage.get(file.key)).toBe('python')
  })
  it('goes back to the detected language with Auto Detect, and marks the one in use', () => {
    fileLanguage.set(file.key, 'php')
    open()
    expect(screen.getByRole('option', { name: /^PHP/ }).querySelector('.codicon-check')).not.toBeNull()
    expect(screen.getByRole('option', { name: /^Auto Detect/ }).querySelector('.codicon-check')).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /^Auto Detect/ }))
    expect(fileLanguage.get(file.key)).toBeUndefined()
  })
  it('closes with Escape without changing anything', () => {
    const onClose = open()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(fileLanguage.get(file.key)).toBeUndefined()
  })
  it('names the languages in Portuguese too', () => {
    open(vi.fn(), 'pt-BR')
    expect(options()[0]).toContain('Detectar Automaticamente')
    expect(options()).toContain('Script de Shell')
  })
})

describe('the languages have a name in both languages', () => {
  it('every language of the list', () => {
    for (const language of LANGUAGES) {
      expect(en[`text.language.${language}` as keyof typeof en], language).toBeTruthy()
      expect(ptBR[`text.language.${language}` as keyof typeof ptBR], language).toBeTruthy()
    }
  })
})

describe('shownSource', () => {
  it('is the file shown now, and is gone when its tab is', () => {
    const off = shownSource.set({ key: 'a', language: 'sql', detected: 'plain' })
    expect(shownSource.get()?.language).toBe('sql')
    act(() => off())
    expect(shownSource.get()).toBeNull()
  })
})
