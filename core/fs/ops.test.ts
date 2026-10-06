import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntry, moveEntry, removeEntry, renameEntry } from './ops.ts'

let base: string
let root: string
const at = (...p: string[]) => path.join(root, ...p)
const text = (...p: string[]) => fs.readFileSync(at(...p), 'utf8')

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ops-'))
  root = path.join(base, 'work')
  fs.mkdirSync(path.join(root, 'docs', 'deep'), { recursive: true })
  fs.mkdirSync(path.join(root, 'empty'))
  fs.writeFileSync(at('a.txt'), 'A')
  fs.writeFileSync(at('b.txt'), 'B')
  fs.writeFileSync(at('docs', 'readme.md'), '# hi')
  fs.writeFileSync(at('docs', 'deep', 'n.json'), '{}')
  fs.writeFileSync(path.join(base, 'outside.txt'), 'outside')
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

describe('createEntry', () => {
  it('makes an empty file and a folder, in the root and in a folder', async () => {
    expect(await createEntry(root, '', 'new.txt', 'file')).toEqual({ ok: true, path: 'new.txt' })
    expect(await createEntry(root, 'docs', 'sub', 'dir')).toEqual({ ok: true, path: 'docs/sub' })
    expect(fs.readFileSync(at('new.txt'), 'utf8')).toBe('')
    expect(fs.statSync(at('docs', 'sub')).isDirectory()).toBe(true)
  })
  it('never replaces: a name that is taken is refused, and what was there is untouched', async () => {
    expect(await createEntry(root, '', 'a.txt', 'file')).toEqual({ ok: false, error: 'exists' })
    expect(await createEntry(root, '', 'docs', 'dir')).toEqual({ ok: false, error: 'exists' })
    expect(text('a.txt')).toBe('A')
  })
  it('refuses a bad name, a parent that is not a folder or not there, one that leaves the root or is inside a ZIP', async () => {
    expect(await createEntry(root, '', '../x', 'file')).toEqual({ ok: false, error: 'invalid-name' })
    expect(await createEntry(root, '', '', 'file')).toEqual({ ok: false, error: 'invalid-name' })
    expect(await createEntry(root, 'a.txt', 'x', 'file')).toEqual({ ok: false, error: 'not-folder' })
    expect(await createEntry(root, 'nope', 'x', 'file')).toEqual({ ok: false, error: 'not-found' })
    expect(await createEntry(root, '../', 'x', 'file')).toEqual({ ok: false, error: 'outside' })
    expect(await createEntry(root, 'p.zip!/in', 'x', 'file')).toEqual({ ok: false, error: 'unsupported' })
    expect(fs.existsSync(path.join(base, 'x'))).toBe(false)
  })
  it('does not write through a symbolic link that leaves the root', async () => {
    fs.symlinkSync(base, at('escape'))
    expect(await createEntry(root, 'escape', 'planted.txt', 'file')).toEqual({ ok: false, error: 'outside' })
    expect(fs.existsSync(path.join(base, 'planted.txt'))).toBe(false)
  })
})

describe('renameEntry', () => {
  it('renames a file and a folder, and keeps what is in the folder', async () => {
    expect(await renameEntry(root, 'a.txt', 'z.txt')).toEqual({ ok: true, path: 'z.txt' })
    expect(await renameEntry(root, 'docs', 'papers')).toEqual({ ok: true, path: 'papers' })
    expect(text('z.txt')).toBe('A')
    expect(fs.existsSync(at('a.txt'))).toBe(false)
    expect(text('papers', 'deep', 'n.json')).toBe('{}')
    expect(await renameEntry(root, 'papers/readme.md', 'README.md')).toEqual({ ok: true, path: 'papers/README.md' })
  })
  it('never replaces: onto a name that is taken, by a file or a folder', async () => {
    expect(await renameEntry(root, 'a.txt', 'b.txt')).toEqual({ ok: false, error: 'exists' })
    expect(await renameEntry(root, 'a.txt', 'docs')).toEqual({ ok: false, error: 'exists' })
    expect(await renameEntry(root, 'empty', 'docs')).toEqual({ ok: false, error: 'exists' })
    expect([text('a.txt'), text('b.txt')]).toEqual(['A', 'B'])
  })
  it('says the same name is the same place, and refuses a bad name, a missing item, the root and the inside of a ZIP', async () => {
    expect(await renameEntry(root, 'a.txt', 'a.txt')).toEqual({ ok: false, error: 'same-place' })
    expect(await renameEntry(root, 'a.txt', 'a/b')).toEqual({ ok: false, error: 'invalid-name' })
    expect(await renameEntry(root, 'gone.txt', 'x')).toEqual({ ok: false, error: 'not-found' })
    expect(await renameEntry(root, '', 'x')).toEqual({ ok: false, error: 'unsupported' })
    expect(await renameEntry(root, 'p.zip!/in.txt', 'x')).toEqual({ ok: false, error: 'unsupported' })
    expect(await renameEntry(root, '../outside.txt', 'x')).toEqual({ ok: false, error: 'outside' })
    expect(fs.readFileSync(path.join(base, 'outside.txt'), 'utf8')).toBe('outside')
  })
  it('renames a symbolic link as the link, and leaves what it points to', async () => {
    fs.symlinkSync(path.join(base, 'outside.txt'), at('link.txt'))
    expect(await renameEntry(root, 'link.txt', 'pointer.txt')).toEqual({ ok: true, path: 'pointer.txt' })
    expect(fs.lstatSync(at('pointer.txt')).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(path.join(base, 'outside.txt'), 'utf8')).toBe('outside')
    expect(fs.existsSync(path.join(base, 'pointer.txt'))).toBe(false)
  })
})

describe('moveEntry', () => {
  it('moves a file and a folder into a folder, and into the root', async () => {
    expect(await moveEntry(root, 'a.txt', 'docs')).toEqual({ ok: true, path: 'docs/a.txt' })
    expect(await moveEntry(root, 'docs/deep', '')).toEqual({ ok: true, path: 'deep' })
    expect(text('docs', 'a.txt')).toBe('A')
    expect(text('deep', 'n.json')).toBe('{}')
    expect(fs.existsSync(at('a.txt'))).toBe(false)
  })
  it('never replaces: a name that is taken in the folder is refused', async () => {
    fs.writeFileSync(at('docs', 'a.txt'), 'other')
    expect(await moveEntry(root, 'a.txt', 'docs')).toEqual({ ok: false, error: 'exists' })
    expect(text('a.txt')).toBe('A')
    expect(text('docs', 'a.txt')).toBe('other')
  })
  it('never puts a folder inside itself or inside what is in it', async () => {
    expect(await moveEntry(root, 'docs', 'docs')).toEqual({ ok: false, error: 'into-itself' })
    expect(await moveEntry(root, 'docs', 'docs/deep')).toEqual({ ok: false, error: 'into-itself' })
    expect(fs.existsSync(at('docs', 'deep', 'n.json'))).toBe(true)
  })
  it('says a move to the folder it is in is not a move, and refuses a target that is not a folder, not there, outside or in a ZIP', async () => {
    expect(await moveEntry(root, 'a.txt', '')).toEqual({ ok: false, error: 'same-place' })
    expect(await moveEntry(root, 'docs/readme.md', 'docs')).toEqual({ ok: false, error: 'same-place' })
    expect(await moveEntry(root, 'a.txt', 'b.txt')).toEqual({ ok: false, error: 'not-folder' })
    expect(await moveEntry(root, 'a.txt', 'nope')).toEqual({ ok: false, error: 'not-found' })
    expect(await moveEntry(root, 'a.txt', '../')).toEqual({ ok: false, error: 'outside' })
    expect(await moveEntry(root, 'a.txt', 'p.zip!/in')).toEqual({ ok: false, error: 'unsupported' })
    expect(await moveEntry(root, '', 'docs')).toEqual({ ok: false, error: 'unsupported' })
    expect(text('a.txt')).toBe('A')
  })
  it('does not move out of the root through a symbolic link', async () => {
    fs.symlinkSync(base, at('escape'))
    expect(await moveEntry(root, 'a.txt', 'escape')).toEqual({ ok: false, error: 'outside' })
    expect(fs.existsSync(path.join(base, 'a.txt'))).toBe(false)
  })
})

describe('removeEntry', () => {
  it('hands the real path of the item to the trash, and says done', async () => {
    const trash = vi.fn(async () => {})
    expect(await removeEntry(root, 'docs/readme.md', 'trash', trash)).toEqual({ ok: true, path: 'docs/readme.md' })
    expect(trash).toHaveBeenCalledWith(fs.realpathSync(at('docs', 'readme.md')))
  })
  it('says the trash failed when it does, and leaves the item', async () => {
    const trash = vi.fn(async () => {
      throw new Error('no trash here')
    })
    expect(await removeEntry(root, 'a.txt', 'trash', trash)).toEqual({ ok: false, error: 'trash-failed' })
    expect(text('a.txt')).toBe('A')
  })
  it('deletes for good a file and a folder with what is in it, when asked', async () => {
    const trash = vi.fn(async () => {})
    expect(await removeEntry(root, 'a.txt', 'forever', trash)).toEqual({ ok: true, path: 'a.txt' })
    expect(await removeEntry(root, 'docs', 'forever', trash)).toEqual({ ok: true, path: 'docs' })
    expect(fs.existsSync(at('a.txt'))).toBe(false)
    expect(fs.existsSync(at('docs'))).toBe(false)
    expect(trash).not.toHaveBeenCalled()
  })
  it('removes a symbolic link as the link, never what it points to', async () => {
    fs.symlinkSync(base, at('escape'))
    expect(await removeEntry(root, 'escape', 'forever', async () => {})).toEqual({ ok: true, path: 'escape' })
    expect(fs.existsSync(at('escape'))).toBe(false)
    expect(fs.existsSync(path.join(base, 'outside.txt'))).toBe(true)
  })
  it('refuses the root, a missing item, what is outside and what is in a ZIP', async () => {
    const trash = vi.fn(async () => {})
    expect(await removeEntry(root, '', 'forever', trash)).toEqual({ ok: false, error: 'unsupported' })
    expect(await removeEntry(root, 'gone', 'trash', trash)).toEqual({ ok: false, error: 'not-found' })
    expect(await removeEntry(root, '../outside.txt', 'forever', trash)).toEqual({ ok: false, error: 'outside' })
    expect(await removeEntry(root, 'p.zip!/x', 'forever', trash)).toEqual({ ok: false, error: 'unsupported' })
    expect(fs.existsSync(path.join(base, 'outside.txt'))).toBe(true)
    expect(trash).not.toHaveBeenCalled()
  })
})
