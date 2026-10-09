import { history, undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import type { FileVersion, RootInfo } from '@core/api.ts'
import { languageOf } from '@core/filekind.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bufferChanged } from '@/state/buffers.ts'
import { editorBuffers, hasChanges } from '@/state/editors.ts'
import { fileLanguage } from '@/state/fileLanguage.ts'
import { newUntitledBuffer } from '@/state/untitled.ts'
import { empty, reduce, type Action, type Workspace } from '@/state/workspace.ts'
import { convertSavedUntitled, folderOf, isTextName, rootOf, type SavedUntitledDeps } from './savedUntitled.ts'

const work: RootInfo = { id: 'r1', kind: 'folder', path: '/home/me/work', name: 'work' }
const deep: RootInfo = { id: 'r2', kind: 'folder', path: '/home/me/work/deep', name: 'deep' }
const archive: RootInfo = { id: 'z1', kind: 'zip', path: '/home/me/work/a.zip', name: 'a.zip' }
const version: FileVersion = { mtimeMs: 1234, size: 5 }

/** The workbench, as far as the conversion sees it: the reducer, and spies for the rest. */
function setup(roots: RootInfo[] = [work], text = 'one', lang?: Parameters<typeof newUntitledBuffer>[3]) {
  let ws: Workspace = empty
  for (const root of roots) ws = reduce(ws, { type: 'root-opened', root })
  ws = reduce(ws, { type: 'open-untitled' })
  const buffer = newUntitledBuffer('u:1', false, text, lang)
  buffer.state = EditorState.create({ doc: text, extensions: [history()] })
  const actions: Action[] = []
  const deps = {
    get roots() {
      return ws.roots
    },
    openFolder: vi.fn(async (folder: string): Promise<RootInfo | null> => {
      const root: RootInfo = { id: 'new', kind: 'folder', path: folder, name: folder.split('/').at(-1) ?? folder }
      ws = reduce(ws, { type: 'root-opened', root })
      return root
    }),
    readVersion: vi.fn(async (): Promise<FileVersion | null> => version),
    dispatch: vi.fn((action: Action) => {
      actions.push(action)
      ws = reduce(ws, action)
    }),
    moveKeyed: vi.fn(),
    chosenAfter: vi.fn(),
    forgetRead: vi.fn(),
    releaseDraft: vi.fn(),
  } satisfies SavedUntitledDeps
  return { buffer, deps, actions, ws: () => ws, doc: () => buffer.state.doc }
}

beforeEach(() => {
  editorBuffers.clear()
  fileLanguage.clear()
})
afterEach(() => {
  editorBuffers.clear()
  fileLanguage.clear()
})

describe('rootOf', () => {
  it('finds the open folder that contains the file, with the path inside it', () => {
    expect(rootOf({ r1: work }, '/home/me/work/notes/a.txt')).toEqual({ rootId: 'r1', path: 'notes/a.txt' })
    expect(rootOf({ r1: work }, '/home/me/other/a.txt')).toBeNull()
    expect(rootOf({ r1: work }, '/home/me/workshop/a.txt')).toBeNull()
  })
  it('takes the most specific folder, and never a ZIP file or the trash', () => {
    expect(rootOf({ r1: work, r2: deep }, '/home/me/work/deep/a.txt')).toEqual({ rootId: 'r2', path: 'a.txt' })
    expect(rootOf({ z1: archive }, '/home/me/work/a.zip/x.txt')).toBeNull()
    expect(rootOf({ t: { ...work, trash: true } }, '/home/me/work/a.txt')).toBeNull()
  })
  it('reads either kind of slash, and ignores the case of a Windows drive', () => {
    expect(rootOf({ w: { id: 'w', kind: 'folder', path: 'C:\\Users\\Me', name: 'Me' } }, 'c:\\users\\me\\docs\\a.txt')).toEqual({ rootId: 'w', path: 'docs/a.txt' })
  })
})

describe('folderOf and isTextName', () => {
  it('gives the folder a file is in, also at the top of a disk', () => {
    expect(folderOf('/home/me/a.txt')).toBe('/home/me')
    expect(folderOf('/a.txt')).toBe('/')
    expect(folderOf('C:\\a.txt')).toBe('C:\\')
  })
  it('tells a text by its name, and a picture or a video is not one', () => {
    expect(isTextName('a.html')).toBe(true)
    expect(isTextName('notes')).toBe(true)
    expect(isTextName('a.png')).toBe(false)
    expect(isTextName('a.mp4')).toBe(false)
  })
})

describe('convertSavedUntitled', () => {
  it('turns the tab into the tab of the file in an open folder, and moves what the tab had', async () => {
    const t = setup()
    const done = await convertSavedUntitled('u:1', '/home/me/work/notes.txt', t.doc(), t.deps)
    expect(done).toEqual({ converted: true, key: 'f:r1:notes.txt', text: true })
    expect(t.ws().tabs.map((tab) => tab.key)).toEqual(['f:r1:notes.txt'])
    expect(t.ws().active).toBe('f:r1:notes.txt')
    expect(t.deps.openFolder).not.toHaveBeenCalled()
    expect(t.deps.moveKeyed).toHaveBeenCalledWith('u:1', 'f:r1:notes.txt')
    expect(t.deps.chosenAfter).toHaveBeenCalledWith('u:1', 'r1', 'notes.txt')
    expect(t.deps.forgetRead).toHaveBeenCalledWith('r1', 'notes.txt')
    expect(editorBuffers.get('u:1')).toBeUndefined()
    expect(editorBuffers.get('f:r1:notes.txt')).toBe(t.buffer)
  })
  it('opens the folder as a root when no open folder has the file (the user chose that place)', async () => {
    const t = setup()
    const done = await convertSavedUntitled('u:1', '/tmp/elsewhere/a.md', t.doc(), t.deps)
    expect(t.deps.openFolder).toHaveBeenCalledWith('/tmp/elsewhere')
    expect(done).toEqual({ converted: true, key: 'f:new:a.md', text: true })
    expect(t.ws().roots.new).toBeDefined()
    expect(t.ws().tabs.map((tab) => tab.key)).toEqual(['f:new:a.md'])
    expect(t.deps.readVersion).toHaveBeenCalledWith('new', 'a.md')
  })
  it('does not change anything when the folder cannot be opened, but the text is saved', async () => {
    const t = setup()
    t.deps.openFolder.mockResolvedValueOnce(null)
    const done = await convertSavedUntitled('u:1', '/tmp/elsewhere/a.md', t.doc(), t.deps)
    expect(done).toEqual({ converted: false })
    expect(t.ws().tabs.map((tab) => tab.key)).toEqual(['u:1'])
    expect(editorBuffers.get('u:1')).toBe(t.buffer)
    expect(hasChanges(t.buffer)).toBe(false)
  })
  it('stays a new text when the file cannot be read back', async () => {
    const t = setup()
    t.deps.readVersion.mockResolvedValueOnce(null)
    expect(await convertSavedUntitled('u:1', '/home/me/work/a.txt', t.doc(), t.deps)).toEqual({ converted: false })
    expect(t.ws().tabs.map((tab) => tab.key)).toEqual(['u:1'])
    expect(t.deps.moveKeyed).not.toHaveBeenCalled()
  })
  it('does nothing without a buffer', async () => {
    const t = setup()
    editorBuffers.delete('u:1')
    expect(await convertSavedUntitled('u:1', '/home/me/work/a.txt', t.doc(), t.deps)).toEqual({ converted: false })
    expect(t.actions).toEqual([])
  })
  it('gives the buffer the version of the file, and marks it clean', async () => {
    const t = setup()
    await convertSavedUntitled('u:1', '/home/me/work/a.txt', t.doc(), t.deps)
    expect(t.buffer.version).toEqual(version)
    expect(hasChanges(t.buffer)).toBe(false)
    expect(bufferChanged('f:r1:a.txt')).toBe(false)
    expect(t.ws().dirty).toEqual({})
  })
  it('keeps the mark of changes when the text was typed in while the dialog was open', async () => {
    const t = setup()
    const saved = t.doc()
    t.buffer.state = t.buffer.state.update({ changes: { from: 3, insert: ' more' } }).state
    await convertSavedUntitled('u:1', '/home/me/work/a.txt', saved, t.deps)
    expect(hasChanges(t.buffer)).toBe(true)
    expect(t.actions.at(-1)).toEqual({ type: 'dirty', key: 'f:r1:a.txt', dirty: true })
  })
  it('keeps the line ending, the byte order mark and the undo history', async () => {
    const t = setup()
    t.buffer.eol = 'crlf'
    t.buffer.bom = true
    t.buffer.state = t.buffer.state.update({ changes: { from: 3, insert: ' two' }, userEvent: 'input' }).state
    await convertSavedUntitled('u:1', '/home/me/work/a.txt', t.buffer.state.doc, t.deps)
    const moved = editorBuffers.get('f:r1:a.txt')!
    expect([moved.eol, moved.bom]).toEqual(['crlf', true])
    let state = moved.state
    undo({ state, dispatch: (tr) => void (state = tr.state) })
    expect(state.doc.toString()).toBe('one')
  })
  it('drops what only a new text has, and lets the draft go', async () => {
    const t = setup([work], 'x', { language: 'html', detected: true, manual: false })
    await convertSavedUntitled('u:1', '/home/me/work/a.txt', t.doc(), t.deps)
    expect(t.buffer.lang).toBeUndefined()
    expect(t.deps.releaseDraft).toHaveBeenCalledWith('u:1')
  })
  it('moves the comparison and the zoom of the tab to the file', async () => {
    const t = setup()
    await convertSavedUntitled('u:1', '/home/me/work/a.txt', t.doc(), t.deps)
    expect(t.deps.moveKeyed).toHaveBeenCalledTimes(1)
    expect(t.deps.chosenAfter).toHaveBeenCalledTimes(1)
  })
})

describe('the language after a save', () => {
  it.each([
    ['a.html', 'html'],
    ['a.md', 'markdown'],
    ['a.json', 'json'],
    ['a.py', 'python'],
  ])('%s: the extension beats the guess of the text', async (name, language) => {
    const t = setup([work], 'x', { language: 'xml', detected: true, manual: false })
    await convertSavedUntitled('u:1', `/home/me/work/${name}`, t.doc(), t.deps)
    // The tab of a file takes the language of its extension (`FileView`) when nothing is picked.
    expect(fileLanguage.get(`r1:${name}`)).toBeUndefined()
    expect(languageOf(undefined, name)).toBe(language)
  })
  it('a name with no extension keeps the language the text had', async () => {
    const t = setup([work], 'x', { language: 'html', detected: true, manual: false })
    await convertSavedUntitled('u:1', '/home/me/work/page', t.doc(), t.deps)
    expect(fileLanguage.get('r1:page')).toBe('html')
  })
  it('a name with no extension and a text that is plain stays plain', async () => {
    const t = setup()
    await convertSavedUntitled('u:1', '/home/me/work/page', t.doc(), t.deps)
    expect(fileLanguage.get('r1:page')).toBeUndefined()
  })
  it('a language the user picked stays picked, also with an extension', async () => {
    const t = setup([work], 'x', { language: 'python', detected: false, manual: true })
    expect(fileLanguage.get('u:1')).toBe('python')
    await convertSavedUntitled('u:1', '/home/me/work/a.html', t.doc(), t.deps)
    expect(fileLanguage.get('u:1')).toBeUndefined()
    expect(fileLanguage.get('r1:a.html')).toBe('python')
  })
})

describe('a name that is not a text', () => {
  it('opens as that kind of file, says so, and lets the text and the draft go', async () => {
    const t = setup()
    const done = await convertSavedUntitled('u:1', '/home/me/work/picture.png', t.doc(), t.deps)
    expect(done).toEqual({ converted: true, key: 'f:r1:picture.png', text: false })
    expect(t.ws().tabs.map((tab) => tab.key)).toEqual(['f:r1:picture.png'])
    expect(editorBuffers.get('u:1')).toBeUndefined()
    expect(editorBuffers.get('f:r1:picture.png')).toBeUndefined()
    expect(t.deps.readVersion).not.toHaveBeenCalled()
    expect(t.deps.releaseDraft).toHaveBeenCalledWith('u:1')
    expect(t.ws().dirty).toEqual({})
  })
})

describe('the next Save', () => {
  it('is the save of a file: the tab is not a new text any more, so Save As is not asked again', async () => {
    const t = setup()
    await convertSavedUntitled('u:1', '/home/me/work/a.txt', t.doc(), t.deps)
    const tab = t.ws().tabs[0]
    expect(tab.view).toBeUndefined()
    expect(tab.path).toBe('a.txt')
    expect(tab.snapshotId).toBe('r1')
    // (`saveKey` asks Save As only for a tab with `view === 'untitled'`; the buffer is under the key of the file, with the version to check.)
    expect(editorBuffers.get(tab.key)?.version).toEqual(version)
  })
})
