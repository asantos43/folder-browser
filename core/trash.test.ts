import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseTrashInfo, Trash, trashFolderOf } from './trash.ts'

let base: string
let files: string
let info: string
let home: string
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-trash-'))
  home = path.join(base, 'home')
  files = path.join(base, 'Trash', 'files')
  info = path.join(base, 'Trash', 'info')
  fs.mkdirSync(files, { recursive: true })
  fs.mkdirSync(info)
  fs.mkdirSync(path.join(home, 'docs'), { recursive: true })
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

const throwAway = (name: string, original: string, content: string | null, date = '2026-02-03T10:00:00') => {
  if (content === null) fs.mkdirSync(path.join(files, name))
  else fs.writeFileSync(path.join(files, name), content)
  fs.writeFileSync(path.join(info, `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(original)}\nDeletionDate=${date}\n`)
}

describe('trashFolderOf', () => {
  it('is where each system keeps the trashed files, and nowhere on Windows', () => {
    expect(trashFolderOf('linux', '/home/me', {})).toBe(path.join('/home/me', '.local', 'share', 'Trash', 'files'))
    expect(trashFolderOf('linux', '/home/me', { XDG_DATA_HOME: '/data' })).toBe(path.join('/data', 'Trash', 'files'))
    expect(trashFolderOf('linux', '/home/me', { XDG_DATA_HOME: 'relative' })).toBe(path.join('/home/me', '.local', 'share', 'Trash', 'files'))
    expect(trashFolderOf('darwin', '/Users/me', {})).toBe(path.join('/Users/me', '.Trash'))
    expect(trashFolderOf('win32', 'C:\\Users\\me')).toBeNull()
  })
})

describe('parseTrashInfo', () => {
  it('reads the path (decoded) and the date, and ignores a path that is not absolute or not valid', () => {
    expect(parseTrashInfo('[Trash Info]\nPath=/home/me/a%20b.txt\nDeletionDate=2026-01-01T09:30:00\n')).toEqual({ originalPath: '/home/me/a b.txt', deletedAt: '2026-01-01T09:30:00' })
    expect(parseTrashInfo('Path=relative/x\n')).toEqual({})
    expect(parseTrashInfo('Path=%E0%A4%A\n')).toEqual({})
    expect(parseTrashInfo('')).toEqual({})
  })
})

describe('Trash', () => {
  it('lists what is in it, the latest thrown away first, with where it was', async () => {
    throwAway('old.txt', path.join(home, 'docs', 'old.txt'), 'old', '2026-01-01T10:00:00')
    throwAway('new.txt', path.join(home, 'docs', 'new file.txt'), 'new!', '2026-03-01T10:00:00')
    throwAway('folder', path.join(home, 'docs', 'folder'), null, '2026-02-01T10:00:00')
    const items = await new Trash(files).list()
    expect(items.map((i) => i.name)).toEqual(['new.txt', 'folder', 'old.txt'])
    expect(items[0]).toMatchObject({ kind: 'file', size: 4, originalPath: path.join(home, 'docs', 'new file.txt') })
    expect(items[1]).toMatchObject({ kind: 'dir', size: 0 })
  })
  it('lists a trash with no records (macOS) with no origin', async () => {
    fs.writeFileSync(path.join(files, 'x.txt'), 'x')
    expect(await new Trash(files, false).list()).toEqual([{ name: 'x.txt', kind: 'file', size: 1 }])
    expect(await new Trash(files, false).restore('x.txt')).toEqual({ error: 'unknown-origin' })
  })
  it('puts an item back where it was, with its record gone, and not over what is there now', async () => {
    const original = path.join(home, 'docs', 'old.txt')
    throwAway('old.txt', original, 'old')
    const trash = new Trash(files)
    expect(await trash.restore('old.txt')).toEqual({ restored: original })
    expect(fs.readFileSync(original, 'utf8')).toBe('old')
    expect(fs.existsSync(path.join(files, 'old.txt'))).toBe(false)
    expect(fs.existsSync(path.join(info, 'old.txt.trashinfo'))).toBe(false)
    throwAway('old.txt', original, 'newer')
    expect(await trash.restore('old.txt')).toEqual({ error: 'exists' })
    expect(fs.readFileSync(original, 'utf8')).toBe('old')
    expect(fs.existsSync(path.join(files, 'old.txt'))).toBe(true)
  })
  it('makes the folder an item came from, if it is gone', async () => {
    const original = path.join(home, 'gone', 'deep', 'a.txt')
    throwAway('a.txt', original, 'a')
    expect(await new Trash(files).restore('a.txt')).toEqual({ restored: original })
    expect(fs.readFileSync(original, 'utf8')).toBe('a')
  })
  it('refuses a name that is not an item of the trash', async () => {
    const trash = new Trash(files)
    for (const name of ['', '.', '..', '../x', 'a/b', 'a\\b', 'missing.txt']) expect(await trash.restore(name), name).toEqual({ error: 'no-item' })
  })
  it('empties it for good, records included, and says how many', async () => {
    throwAway('a.txt', path.join(home, 'a.txt'), 'a')
    throwAway('d', path.join(home, 'd'), null)
    fs.writeFileSync(path.join(files, 'd', 'inner.txt'), 'i')
    expect(await new Trash(files).empty()).toBe(2)
    expect(fs.readdirSync(files)).toEqual([])
    expect(fs.readdirSync(info)).toEqual([])
    expect(await new Trash(path.join(base, 'nowhere', 'files')).empty()).toBe(0)
  })
})
