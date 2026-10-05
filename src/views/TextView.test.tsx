// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context.tsx'
import { formatSource, wordWrap } from '@/state/setting.ts'
import { FORMAT_LIMIT } from './format.ts'
import { TextView } from './TextView.tsx'

beforeEach(() => {
  localStorage.clear()
  wordWrap.reload()
  formatSource.reload()
})
afterEach(cleanup)

const MIN_JSON = '{"name":"harbor","items":[{"id":1},{"id":2}],"ok":true}'
const show = (text: string, language: Parameters<typeof TextView>[0]['language'], size = text.length, onSave = vi.fn()) => {
  render(
    <I18nProvider language="en">
      <TextView text={text} language={language} size={size} onSave={onSave} />
    </I18nProvider>,
  )
  return onSave
}
const content = () => document.querySelector('.cm-content')?.textContent ?? ''

describe('TextView: formatting', () => {
  it('shows minified JSON laid out, says so, and counts the lines it now has', async () => {
    show(MIN_JSON, 'json')
    await waitFor(() => expect(screen.getByText('Formatted')).toBeTruthy())
    expect(content()).toContain('"name": "harbor",')
    expect(screen.getByText(/\d+ lines/).textContent).not.toBe('1 lines')
    expect(screen.getByText('JSON')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Show the file laid out/ }).getAttribute('aria-pressed')).toBe('true')
  })
  it('shows the file as it was saved when Format is switched off, and remembers it for every file', async () => {
    show(MIN_JSON, 'json')
    await waitFor(() => expect(screen.getByText('Formatted')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Show the file laid out/ }))
    await waitFor(() => expect(content()).toContain('{"name":"harbor","items"'))
    expect(screen.getByText('As saved')).toBeTruthy()
    expect(screen.getByText('1 lines')).toBeTruthy()
    expect(localStorage.getItem('fb:formatSource')).toBe('false')
    cleanup()
    show('{"a":1,"b":2}', 'json')
    expect(content()).toBe('{"a":1,"b":2}')
  })
  it('has no Format button for what is not formatted (plain text, Markdown, YAML), and says what the language is', () => {
    show('just text\nsecond line\n', 'plain')
    expect(screen.queryByRole('button', { name: /Show the file laid out/ })).toBeNull()
    expect(screen.getByText('Plain Text')).toBeTruthy()
    expect(screen.getByText('2 lines')).toBeTruthy()
    cleanup()
    show('# Title\n', 'markdown')
    expect(screen.getByText('Markdown')).toBeTruthy()
    cleanup()
    show('a: 1\n', 'yaml')
    expect(screen.getByText('YAML')).toBeTruthy()
  })
  it('does not lay out a file over the limit: it is shown as saved, and Format is off', () => {
    show(MIN_JSON, 'json', FORMAT_LIMIT + 1)
    expect(screen.getByText('Too large to format: shown as saved.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Show the file laid out/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(content()).toBe(MIN_JSON)
  })
})

describe('TextView: word wrap', () => {
  it('wraps long lines when Word Wrap is on, without making the editor again, and remembers it', async () => {
    show('word '.repeat(400), 'plain')
    expect(document.querySelector('.cm-lineWrapping')).toBeNull()
    const editor = document.querySelector('.cm-editor')
    fireEvent.click(screen.getByRole('button', { name: /Wrap long lines/ }))
    await waitFor(() => expect(document.querySelector('.cm-lineWrapping')).not.toBeNull())
    expect(document.querySelector('.cm-editor')).toBe(editor)
    expect(screen.getByRole('button', { name: /Wrap long lines/ }).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('fb:wordWrap')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Wrap long lines/ }))
    await waitFor(() => expect(document.querySelector('.cm-lineWrapping')).toBeNull())
  })
  it('turns on and off with Alt+Z, as in VS Code', async () => {
    show('x', 'plain')
    act(() => void fireEvent.keyDown(window, { key: 'z', altKey: true }))
    await waitFor(() => expect(wordWrap.get()).toBe(true))
    act(() => void fireEvent.keyDown(window, { key: 'Z', altKey: true }))
    await waitFor(() => expect(wordWrap.get()).toBe(false))
  })
  it('starts wrapped when the setting says so', () => {
    wordWrap.set(true)
    show('word '.repeat(400), 'plain')
    expect(document.querySelector('.cm-lineWrapping')).not.toBeNull()
  })
})

describe('TextView: the rest of the toolbar', () => {
  it('has Save As', () => {
    const onSave = show('x', 'plain')
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))
    expect(onSave).toHaveBeenCalledOnce()
  })
})
