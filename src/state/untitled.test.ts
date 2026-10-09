import { afterEach, describe, expect, it } from 'vitest'
import { history, undo } from '@codemirror/commands'
import { editorBuffers } from './editors.ts'
import { fileLanguage } from './fileLanguage.ts'
import { EditorState } from '@codemirror/state'
import type { Detected } from './detectLanguage.ts'
import { changeSize, moveEditorBuffer, newUntitledBuffer, nextLanguage, PLAIN_TEXT, pickedLanguage } from './untitled.ts'

const html: Detected = { language: 'html', confidence: 0.95 }
const json: Detected = { language: 'json', confidence: 0.9 }

describe('nextLanguage', () => {
  it('applies a detection to a text that has none', () => {
    expect(nextLanguage(PLAIN_TEXT, html)).toEqual({ language: 'html', detected: true, manual: false })
  })
  it('follows the text when it changes its mind', () => {
    expect(nextLanguage({ language: 'html', detected: true, manual: false }, json)).toEqual({ language: 'json', detected: true, manual: false })
  })
  it('does not change what is already so (the same object comes back)', () => {
    const state = { language: 'html' as const, detected: true, manual: false }
    expect(nextLanguage(state, html)).toBe(state)
    expect(nextLanguage(PLAIN_TEXT, null)).toBe(PLAIN_TEXT)
  })
  it('never overwrites a choice of the user', () => {
    const chosen = { language: 'python' as const, detected: false, manual: true }
    expect(nextLanguage(chosen, html)).toBe(chosen)
    expect(nextLanguage(chosen, null)).toBe(chosen)
  })
  it('goes back to plain text when the text no longer convinces', () => {
    expect(nextLanguage({ language: 'html', detected: true, manual: false }, null)).toEqual(PLAIN_TEXT)
  })
})

describe('pickedLanguage', () => {
  it('a chosen language sticks, and so does Plain Text', () => {
    expect(pickedLanguage('python', html)).toEqual({ language: 'python', detected: false, manual: true })
    expect(pickedLanguage('plain', html)).toEqual({ language: 'plain', detected: false, manual: true })
  })
  it('Auto Detect gives the text its own language back, or plain text', () => {
    expect(pickedLanguage(undefined, html)).toEqual({ language: 'html', detected: true, manual: false })
    expect(pickedLanguage(undefined, null)).toEqual(PLAIN_TEXT)
  })
})

describe('changeSize', () => {
  it('counts what a change put in and took out', () => {
    const state = EditorState.create({ doc: 'abcdef' })
    expect(changeSize(state.update({ changes: { from: 0, to: 3, insert: 'xy' } }).changes)).toBe(5)
    expect(changeSize(state.update({ changes: { from: 6, insert: 'z' } }).changes)).toBe(1)
  })
})

describe('moveEditorBuffer', () => {
  afterEach(() => {
    editorBuffers.clear()
    fileLanguage.clear()
  })

  it('gives the text of the new text to the file, with its undo history, without what only a new text has', () => {
    const buffer = newUntitledBuffer('u:1', false, '', { language: 'python', detected: false, manual: true })
    buffer.state = EditorState.create({ doc: 'one', extensions: [history()] })
    buffer.state = buffer.state.update({ changes: { from: 3, insert: ' two' }, userEvent: 'input' }).state
    moveEditorBuffer('u:1', 'f:r1:new.py')
    expect(editorBuffers.get('u:1')).toBeUndefined()
    const moved = editorBuffers.get('f:r1:new.py')
    expect(moved).toBe(buffer)
    expect(moved?.lang).toBeUndefined()
    expect(moved?.state.doc.toString()).toBe('one two')
    // The history went with it: undo takes the typing back.
    let state = moved!.state
    undo({ state, dispatch: (tr) => void (state = tr.state) })
    expect(state.doc.toString()).toBe('one')
    // The language the user picked stays picked, under the new key.
    expect(fileLanguage.get('u:1')).toBeUndefined()
    expect(fileLanguage.get('f:r1:new.py')).toBe('python')
  })
  it('replaces the buffer the file had, and does nothing without a buffer or for the same key', () => {
    const made = newUntitledBuffer('u:1', false, 'text')
    editorBuffers.set('f:r1:a.txt', { ...made, state: EditorState.create({ doc: 'old' }) })
    moveEditorBuffer('u:1', 'f:r1:a.txt')
    expect(editorBuffers.get('f:r1:a.txt')?.state.doc.toString()).toBe('text')
    moveEditorBuffer('u:9', 'f:r1:b.txt')
    expect(editorBuffers.get('f:r1:b.txt')).toBeUndefined()
    moveEditorBuffer('f:r1:a.txt', 'f:r1:a.txt')
    expect(editorBuffers.get('f:r1:a.txt')?.state.doc.toString()).toBe('text')
  })
})
