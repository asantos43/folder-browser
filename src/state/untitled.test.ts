import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { Detected } from './detectLanguage.ts'
import { changeSize, nextLanguage, PLAIN_TEXT, pickedLanguage } from './untitled.ts'

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
