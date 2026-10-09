import { EditorState } from '@codemirror/state'
import type { FbApi } from '@core/api.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_DELAY_MS, flushDrafts, forgetDrafts, releaseDraft, setDraftsEnabled, syncDrafts, touchDraft } from './drafts.ts'
import { editorBuffers, type EditorBuffer } from './editors.ts'
import { empty, reduce, type Action, type Workspace } from './workspace.ts'

const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
const run = (...actions: Action[]): Workspace => actions.reduce(reduce, empty)
const KEY = 'f:r1:a.txt'

function setup() {
  const put = vi.fn(async () => true)
  const del = vi.fn(async () => {})
  const api = { drafts: { put, delete: del } } as unknown as Pick<FbApi, 'drafts'>
  const state = EditorState.create({ doc: 'saved text' })
  const buffer: EditorBuffer = { state, saved: state.doc, version: { mtimeMs: 5, size: 10 }, eol: 'crlf', bom: true }
  editorBuffers.set(KEY, buffer)
  const type = (text: string) => void (buffer.state = buffer.state.update({ changes: { from: 0, to: buffer.state.doc.length, insert: text } }).state)
  return { api, put, del, buffer, type }
}
const dirtyWs = (): Workspace => run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path: 'a.txt', keep: true }, { type: 'dirty', key: KEY, dirty: true })
const cleanWs = (): Workspace => run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path: 'a.txt', keep: true })

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  forgetDrafts()
  editorBuffers.clear()
})

describe('drafts of the tabs with changes', () => {
  it('writes a draft a moment after the changes pause, with the text, the version they began from, and how the file ends its lines', async () => {
    const { api, put, type } = setup()
    type('changed text')
    touchDraft(api, KEY, 'r1', 'a.txt')
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS - 100)
    expect(put).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(put).toHaveBeenCalledWith('r1', 'a.txt', { kind: 'text', text: 'changed text', base: { mtimeMs: 5, size: 10 }, eol: 'crlf', bom: true })
  })
  it('writes once for a run of changes (the wait starts again at each one), with the latest text', async () => {
    const { api, put, type } = setup()
    for (const text of ['a', 'ab', 'abc']) {
      type(text)
      touchDraft(api, KEY, 'r1', 'a.txt')
      await vi.advanceTimersByTimeAsync(500)
    }
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS)
    expect(put).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledWith('r1', 'a.txt', expect.objectContaining({ text: 'abc' }))
  })
  it('writes at once what is waiting when the window is closing, and writes nothing for a text with no changes', async () => {
    const { api, put, type } = setup()
    type('last words')
    touchDraft(api, KEY, 'r1', 'a.txt')
    await flushDrafts(api)
    expect(put).toHaveBeenCalledOnce()
    put.mockClear()
    type('saved text')
    touchDraft(api, KEY, 'r1', 'a.txt')
    await flushDrafts(api)
    expect(put).not.toHaveBeenCalled()
  })
  it('lets go of the draft of a tab that has no changes any more (saved, undone, closed), and not of one that has', () => {
    const { api, del, type } = setup()
    type('x')
    touchDraft(api, KEY, 'r1', 'a.txt')
    syncDrafts(api, dirtyWs())
    expect(del).not.toHaveBeenCalled()
    syncDrafts(api, cleanWs())
    expect(del).toHaveBeenCalledWith('r1', 'a.txt')
    del.mockClear()
    syncDrafts(api, cleanWs())
    expect(del).not.toHaveBeenCalled()
  })
  it('does not write the draft that was waiting when the tab became clean', async () => {
    const { api, put, type } = setup()
    type('x')
    touchDraft(api, KEY, 'r1', 'a.txt')
    syncDrafts(api, cleanWs())
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2)
    expect(put).not.toHaveBeenCalled()
  })
  it('gives a tab that has changes and no draft yet one (its file was renamed, so its key is new)', async () => {
    const { api, put, buffer, type } = setup()
    type('moved text')
    editorBuffers.move(KEY, 'f:r1:b.txt')
    const ws = run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path: 'b.txt', keep: true }, { type: 'dirty', key: 'f:r1:b.txt', dirty: true })
    syncDrafts(api, ws)
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS + 100)
    expect(put).toHaveBeenCalledWith('r1', 'b.txt', expect.objectContaining({ text: 'moved text' }))
    expect(buffer.state.doc.toString()).toBe('moved text')
  })
  it('writes nothing, and keeps nothing, when the setting is off', async () => {
    const { api, put, type } = setup()
    setDraftsEnabled(false)
    type('x')
    touchDraft(api, KEY, 'r1', 'a.txt')
    syncDrafts(api, dirtyWs())
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2)
    expect(put).not.toHaveBeenCalled()
  })
})

describe('drafts of a new text file (Untitled-N)', () => {
  const untitledWs = (dirty: boolean): Workspace => run({ type: 'open-untitled' }, ...(dirty ? [{ type: 'dirty', key: 'u:1', dirty: true } as const] : []))
  const buffer = (text: string) => {
    const state = EditorState.create({ doc: text })
    editorBuffers.set('u:1', { state, saved: EditorState.create({ doc: '' }).doc, version: { mtimeMs: 0, size: 0 }, eol: 'lf', bom: false })
  }

  it('is kept under the name @untitled, with the key of its tab as the path, once its text has changes', async () => {
    const api = { drafts: { put: vi.fn(async () => true), delete: vi.fn(async () => {}) } } as unknown as Pick<FbApi, 'drafts'>
    buffer('pasted text')
    syncDrafts(api, untitledWs(true))
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS + 100)
    expect(api.drafts.put).toHaveBeenCalledWith('@untitled', 'u:1', { kind: 'text', text: 'pasted text', base: { mtimeMs: 0, size: 0 }, eol: 'lf', bom: false })
  })
  it('releaseDraft cancels the write that waits and lets the kept draft go (a new text saved as a file)', async () => {
    const api = { drafts: { put: vi.fn(async () => true), delete: vi.fn(async () => {}) } } as unknown as Pick<FbApi, 'drafts'>
    buffer('pasted text')
    syncDrafts(api, untitledWs(true))
    releaseDraft(api, 'u:1')
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS + 100)
    expect(api.drafts.put).not.toHaveBeenCalled()
    expect(api.drafts.delete).toHaveBeenCalledWith('@untitled', 'u:1')
    releaseDraft(api, 'u:1')
    expect(api.drafts.delete).toHaveBeenCalledTimes(1)
  })
  it('is let go when the text has no changes any more (saved, emptied, or the tab closed)', async () => {
    const api = { drafts: { put: vi.fn(async () => true), delete: vi.fn(async () => {}) } } as unknown as Pick<FbApi, 'drafts'>
    buffer('pasted text')
    syncDrafts(api, untitledWs(true))
    syncDrafts(api, untitledWs(false))
    expect(api.drafts.delete).toHaveBeenCalledWith('@untitled', 'u:1')
  })
})
