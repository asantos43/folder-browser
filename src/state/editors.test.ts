import { EditorState } from '@codemirror/state'
import type { EditSave, FbApi } from '@core/api.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorBuffers, hasChanges, saveBuffer, type EditorBuffer } from './editors.ts'

afterEach(() => editorBuffers.clear())

const make = (text: string, extra: Partial<EditorBuffer> = {}): EditorBuffer => {
  const state = EditorState.create({ doc: text })
  return { state, saved: state.doc, version: { mtimeMs: 1, size: text.length }, eol: 'lf', bom: false, ...extra }
}
const type = (buffer: EditorBuffer, text: string) => void (buffer.state = buffer.state.update({ changes: { from: 0, to: buffer.state.doc.length, insert: text } }).state)

describe('hasChanges', () => {
  it('is false for the text that was saved, true when it differs, and false again when it is back to it', () => {
    const buffer = make('hello')
    expect(hasChanges(buffer)).toBe(false)
    type(buffer, 'hello!')
    expect(hasChanges(buffer)).toBe(true)
    type(buffer, 'hello')
    expect(hasChanges(buffer)).toBe(false)
  })
})

describe('editorBuffers', () => {
  it('keeps a buffer by the key of its tab, and a tab with a new key keeps its text', () => {
    const buffer = make('a')
    editorBuffers.set('f:r1:a.txt', buffer)
    editorBuffers.move('f:r1:a.txt', 'f:r1:b.txt')
    expect(editorBuffers.get('f:r1:a.txt')).toBeUndefined()
    expect(editorBuffers.get('f:r1:b.txt')).toBe(buffer)
  })
  it('lets go of the buffers of the tabs that are closed', () => {
    editorBuffers.set('a', make('a'))
    editorBuffers.set('b', make('b'))
    editorBuffers.keep(new Set(['b']))
    expect(editorBuffers.get('a')).toBeUndefined()
    expect(editorBuffers.get('b')).toBeDefined()
  })
})

describe('saveBuffer', () => {
  const api = (answer: EditSave) => ({ edit: { save: vi.fn(async () => answer) } }) as unknown as Pick<FbApi, 'edit'> & { edit: { save: ReturnType<typeof vi.fn> } }

  it('sends the text with what the file was like and how it ends, and the buffer is clean with the new version after', async () => {
    const buffer = make('one', { eol: 'crlf', bom: true })
    editorBuffers.set('k', buffer)
    type(buffer, 'two')
    const fake = api({ ok: true, version: { mtimeMs: 9, size: 3 } })
    expect(await saveBuffer(fake, 'r1', 'a.txt', 'k')).toEqual({ ok: true, version: { mtimeMs: 9, size: 3 } })
    expect(fake.edit.save).toHaveBeenCalledWith('r1', 'a.txt', 'two', { mtimeMs: 1, size: 3 }, { eol: 'crlf', bom: true, overwrite: false })
    expect(hasChanges(buffer)).toBe(false)
    expect(buffer.version).toEqual({ mtimeMs: 9, size: 3 })
  })
  it('leaves the buffer as it was when the file was not written (it changed on disk), and sends overwrite when asked', async () => {
    const buffer = make('one')
    editorBuffers.set('k', buffer)
    type(buffer, 'two')
    const changed = api({ ok: false, error: 'changed' })
    expect(await saveBuffer(changed, 'r1', 'a.txt', 'k')).toEqual({ ok: false, error: 'changed' })
    expect(hasChanges(buffer)).toBe(true)
    expect(buffer.version.mtimeMs).toBe(1)
    const fine = api({ ok: true, version: { mtimeMs: 5, size: 3 } })
    await saveBuffer(fine, 'r1', 'a.txt', 'k', true)
    expect(fine.edit.save).toHaveBeenCalledWith('r1', 'a.txt', 'two', { mtimeMs: 1, size: 3 }, { eol: 'lf', bom: false, overwrite: true })
  })
  it('counts what was typed while the file was being written as a change still to save', async () => {
    const buffer = make('one')
    editorBuffers.set('k', buffer)
    type(buffer, 'two')
    const slow = { edit: { save: vi.fn(async () => { type(buffer, 'two and more'); return { ok: true as const, version: { mtimeMs: 7, size: 3 } } }) } } as unknown as Pick<FbApi, 'edit'>
    await saveBuffer(slow, 'r1', 'a.txt', 'k')
    expect(buffer.saved.toString()).toBe('two')
    expect(hasChanges(buffer)).toBe(true)
  })
  it('says there is no buffer for a tab that has none', async () => {
    expect(await saveBuffer(api({ ok: true, version: { mtimeMs: 1, size: 1 } }), 'r1', 'a.txt', 'nope')).toEqual({ ok: false, error: 'no-buffer' })
  })
})
