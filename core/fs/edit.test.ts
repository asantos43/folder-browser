import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectLineEnding, EDIT_LIMIT, HEX_EDIT_LIMIT, readBytesForEdit, readForEdit, saveEdited, saveEditedBytes } from './edit.ts'

let base: string
let root: string
const at = (...p: string[]) => path.join(root, ...p)

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-edit-'))
  root = path.join(base, 'work')
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  fs.writeFileSync(at('a.txt'), 'line one\nline two\n')
  fs.writeFileSync(path.join(base, 'outside.txt'), 'outside')
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

describe('detectLineEnding', () => {
  it('says which ending most lines have, and LF for a text with none', () => {
    expect(detectLineEnding('a\nb\nc')).toBe('lf')
    expect(detectLineEnding('a\r\nb\r\nc\n')).toBe('crlf')
    expect(detectLineEnding('a\rb\rc')).toBe('cr')
    expect(detectLineEnding('no breaks')).toBe('lf')
    expect(detectLineEnding('')).toBe('lf')
  })
})

describe('readForEdit', () => {
  it('gives the text, the ending, the mark and the version of a file', async () => {
    const got = await readForEdit(root, 'a.txt')
    expect(got).toMatchObject({ ok: true, text: 'line one\nline two\n', eol: 'lf', bom: false, version: { size: 18 } })
  })
  it('takes CRLF and a byte order mark out of the text, and says they were there', async () => {
    fs.writeFileSync(at('w.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb\r\n')]))
    expect(await readForEdit(root, 'w.txt')).toMatchObject({ ok: true, text: 'a\nb\n', eol: 'crlf', bom: true })
  })
  it('refuses a binary file, another encoding, a file that is too big, a missing one, a folder', async () => {
    fs.writeFileSync(at('bin.dat'), Buffer.from([1, 2, 0, 3]))
    fs.writeFileSync(at('latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    fs.writeFileSync(at('big.txt'), 'x'.repeat(EDIT_LIMIT + 1))
    expect(await readForEdit(root, 'bin.dat')).toEqual({ ok: false, error: 'not-text' })
    expect(await readForEdit(root, 'latin.txt')).toEqual({ ok: false, error: 'not-utf8' })
    expect(await readForEdit(root, 'big.txt')).toEqual({ ok: false, error: 'too-large' })
    expect(await readForEdit(root, 'gone.txt')).toEqual({ ok: false, error: 'no-file' })
    expect(await readForEdit(root, 'docs')).toEqual({ ok: false, error: 'no-file' })
  })
  it('refuses what leaves the root, a link that does, the root itself and the inside of a ZIP', async () => {
    fs.symlinkSync(path.join(base, 'outside.txt'), at('link.txt'))
    expect(await readForEdit(root, '../outside.txt')).toEqual({ ok: false, error: 'no-file' })
    expect(await readForEdit(root, 'link.txt')).toEqual({ ok: false, error: 'no-file' })
    expect(await readForEdit(root, '')).toEqual({ ok: false, error: 'unsupported' })
    expect(await readForEdit(root, 'p.zip!/in.txt')).toEqual({ ok: false, error: 'unsupported' })
  })
})

describe('saveEdited', () => {
  const open = async (name: string) => {
    const got = await readForEdit(root, name)
    if (!got.ok) throw new Error(got.error)
    return got
  }
  it('writes the new text, and the file is whole: no temporary file is left', async () => {
    const got = await open('a.txt')
    const saved = await saveEdited(root, 'a.txt', 'changed\n', got.version, { eol: got.eol, bom: got.bom })
    expect(saved.ok).toBe(true)
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('changed\n')
    expect(fs.readdirSync(root).filter((n) => n.endsWith('.fbtmp'))).toEqual([])
    // The version it gives is what the disk has now: a second save needs no overwrite.
    const again = await saveEdited(root, 'a.txt', 'changed twice\n', (saved as { version: { mtimeMs: number; size: number } }).version, { eol: 'lf', bom: false })
    expect(again.ok).toBe(true)
  })
  it('puts back the line endings and the byte order mark: a file read and saved unchanged is the same bytes', async () => {
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb\r\nc')])
    fs.writeFileSync(at('w.txt'), original)
    const got = await open('w.txt')
    await saveEdited(root, 'w.txt', got.text, got.version, { eol: got.eol, bom: got.bom })
    expect(fs.readFileSync(at('w.txt')).equals(original)).toBe(true)
    await saveEdited(root, 'w.txt', 'x\ny\n', (await open('w.txt')).version, { eol: got.eol, bom: got.bom })
    expect(fs.readFileSync(at('w.txt')).equals(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x\r\ny\r\n')]))).toBe(true)
  })
  it('keeps the permissions of the file', async () => {
    fs.chmodSync(at('a.txt'), 0o640)
    const got = await open('a.txt')
    await saveEdited(root, 'a.txt', 'x', got.version, { eol: 'lf', bom: false })
    expect(fs.statSync(at('a.txt')).mode & 0o777).toBe(0o640)
  })
  it('writes nothing when the file changed since it was read (the size or the time), unless the user chose to overwrite', async () => {
    const got = await open('a.txt')
    fs.writeFileSync(at('a.txt'), 'someone else wrote this\n')
    expect(await saveEdited(root, 'a.txt', 'mine\n', got.version, { eol: 'lf', bom: false })).toEqual({ ok: false, error: 'changed' })
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('someone else wrote this\n')
    const sameSize = await open('a.txt')
    fs.utimesSync(at('a.txt'), new Date(2020, 1, 1), new Date(2020, 1, 1))
    expect(await saveEdited(root, 'a.txt', 'mine\n', sameSize.version, { eol: 'lf', bom: false })).toEqual({ ok: false, error: 'changed' })
    expect((await saveEdited(root, 'a.txt', 'mine\n', got.version, { eol: 'lf', bom: false, overwrite: true })).ok).toBe(true)
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('mine\n')
  })
  it('says a file that is gone is gone, and refuses the root, what leaves it and the inside of a ZIP', async () => {
    const got = await open('a.txt')
    fs.rmSync(at('a.txt'))
    expect(await saveEdited(root, 'a.txt', 'x', got.version, { eol: 'lf', bom: false })).toEqual({ ok: false, error: 'no-file' })
    expect(await saveEdited(root, '../outside.txt', 'x', got.version, { eol: 'lf', bom: false, overwrite: true })).toEqual({ ok: false, error: 'no-file' })
    expect(await saveEdited(root, '', 'x', got.version, { eol: 'lf', bom: false })).toEqual({ ok: false, error: 'unsupported' })
    expect(await saveEdited(root, 'p.zip!/a', 'x', got.version, { eol: 'lf', bom: false })).toEqual({ ok: false, error: 'unsupported' })
    expect(fs.readFileSync(path.join(base, 'outside.txt'), 'utf8')).toBe('outside')
  })
  it('does not write through a link that leaves the root', async () => {
    fs.symlinkSync(path.join(base, 'outside.txt'), at('link.txt'))
    expect(await saveEdited(root, 'link.txt', 'planted', { mtimeMs: 0, size: 0 }, { eol: 'lf', bom: false, overwrite: true })).toEqual({ ok: false, error: 'no-file' })
    expect(fs.readFileSync(path.join(base, 'outside.txt'), 'utf8')).toBe('outside')
  })
  it('writes through a link that stays inside the root, to the file it points to', async () => {
    fs.symlinkSync(at('a.txt'), at('docs', 'alias.txt'))
    const got = await open('docs/alias.txt')
    expect((await saveEdited(root, 'docs/alias.txt', 'via the link\n', got.version, { eol: 'lf', bom: false })).ok).toBe(true)
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('via the link\n')
    expect(fs.lstatSync(at('docs', 'alias.txt')).isSymbolicLink()).toBe(true)
  })
  it('leaves the file as it was, and no temporary file, when the folder cannot be written to', async () => {
    if (process.getuid?.() === 0) return
    const got = await open('a.txt')
    fs.chmodSync(root, 0o500)
    try {
      expect(await saveEdited(root, 'a.txt', 'nope', got.version, { eol: 'lf', bom: false })).toEqual({ ok: false, error: 'denied' })
    } finally {
      fs.chmodSync(root, 0o700)
    }
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('line one\nline two\n')
    expect(fs.readdirSync(root).filter((n) => n.endsWith('.fbtmp'))).toEqual([])
  })
})

describe('readBytesForEdit and saveEditedBytes', () => {
  it('reads all the bytes of a file, binary too, with its version', async () => {
    fs.writeFileSync(at('prog.bin'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 255]))
    const got = await readBytesForEdit(root, 'prog.bin')
    expect(got.ok && [...got.bytes]).toEqual([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 255])
    expect(got.ok && got.version.size).toBe(8)
  })
  it('refuses a file that is too big, a missing one, the root and the inside of a ZIP', async () => {
    fs.writeFileSync(at('big.bin'), Buffer.alloc(HEX_EDIT_LIMIT + 1))
    expect(await readBytesForEdit(root, 'big.bin')).toEqual({ ok: false, error: 'too-large' })
    expect(await readBytesForEdit(root, 'gone.bin')).toEqual({ ok: false, error: 'no-file' })
    expect(await readBytesForEdit(root, '')).toEqual({ ok: false, error: 'unsupported' })
    expect(await readBytesForEdit(root, 'p.zip!/a')).toEqual({ ok: false, error: 'unsupported' })
    expect(await readBytesForEdit(root, '../outside.txt')).toEqual({ ok: false, error: 'no-file' })
  })
  it('writes bytes whole through a temporary file, keeps the permissions (the executable bit), and a longer or shorter file is fine', async () => {
    fs.writeFileSync(at('run.bin'), Buffer.from([1, 2, 3, 4]))
    fs.chmodSync(at('run.bin'), 0o755)
    const got = await readBytesForEdit(root, 'run.bin')
    if (!got.ok) throw new Error('read')
    const saved = await saveEditedBytes(root, 'run.bin', Uint8Array.from([9, 8, 7, 6, 5, 4]), got.version)
    expect(saved.ok).toBe(true)
    expect([...fs.readFileSync(at('run.bin'))]).toEqual([9, 8, 7, 6, 5, 4])
    expect(fs.statSync(at('run.bin')).mode & 0o777).toBe(0o755)
    expect(fs.readdirSync(root).filter((n) => n.endsWith('.fbtmp'))).toEqual([])
  })
  it('writes nothing when the file changed since it was read, unless told to overwrite', async () => {
    fs.writeFileSync(at('x.bin'), Buffer.from([1, 2]))
    const got = await readBytesForEdit(root, 'x.bin')
    if (!got.ok) throw new Error('read')
    fs.writeFileSync(at('x.bin'), Buffer.from([1, 2, 3]))
    expect(await saveEditedBytes(root, 'x.bin', Uint8Array.from([0]), got.version)).toEqual({ ok: false, error: 'changed' })
    expect((await saveEditedBytes(root, 'x.bin', Uint8Array.from([0]), got.version, true)).ok).toBe(true)
    expect([...fs.readFileSync(at('x.bin'))]).toEqual([0])
  })
})
