import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DraftStore, type Draft } from './drafts.ts'

let dir: string
let store: DraftStore
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-drafts-'))
  store = new DraftStore(path.join(dir, 'drafts'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const text = (extra: Partial<Draft> = {}): Draft => ({ version: 1, rootPath: '/home/me/work', path: 'docs/a.txt', kind: 'text', text: 'unsaved words', base: { mtimeMs: 10, size: 5 }, eol: 'crlf', bom: true, at: '2026-10-06T12:00:00.000Z', ...extra }) as Draft

describe('DraftStore', () => {
  it('keeps a text draft of a file and gives it back whole, with how the file was and what its lines end with', () => {
    expect(store.put(text())).toBe(true)
    expect(store.get('/home/me/work', 'docs/a.txt')).toEqual(text())
  })
  it('replaces the draft of the same file, keeps the drafts of other files apart, and forgets one on request', () => {
    store.put(text())
    store.put(text({ text: 'newer' } as Partial<Draft>))
    store.put(text({ path: 'b.txt', text: 'other file' } as Partial<Draft>))
    store.put(text({ rootPath: '/home/me/other', text: 'other root' } as Partial<Draft>))
    expect((store.get('/home/me/work', 'docs/a.txt') as { text: string }).text).toBe('newer')
    expect((store.get('/home/me/work', 'b.txt') as { text: string }).text).toBe('other file')
    expect((store.get('/home/me/other', 'docs/a.txt') as { text: string }).text).toBe('other root')
    store.delete('/home/me/work', 'docs/a.txt')
    expect(store.get('/home/me/work', 'docs/a.txt')).toBeNull()
    expect(store.get('/home/me/work', 'b.txt')).not.toBeNull()
  })
  it('keeps bytes (the hex view) beside their meta, and gives them back as they were', () => {
    const bytes = Uint8Array.from([0, 1, 2, 255, 128])
    store.put({ version: 1, rootPath: '/r', path: 'x.bin', kind: 'bytes', bytes, base: { mtimeMs: 1, size: 5 }, at: '2026-10-06T12:00:00.000Z' })
    const got = store.get('/r', 'x.bin')
    expect(got?.kind).toBe('bytes')
    expect([...(got as { bytes: Uint8Array }).bytes]).toEqual([0, 1, 2, 255, 128])
    store.put(text({ rootPath: '/r', path: 'x.bin' }))
    expect(store.get('/r', 'x.bin')?.kind).toBe('text')
    expect(fs.readdirSync(path.join(dir, 'drafts')).filter((n) => n.endsWith('.bin'))).toEqual([])
  })
  it('lists what is kept, the oldest first, without the contents', () => {
    store.put(text({ path: 'b.txt', at: '2026-10-06T13:00:00.000Z' }))
    store.put(text({ path: 'a.txt', at: '2026-10-06T12:00:00.000Z' }))
    const list = store.list()
    expect(list.map((d) => d.path)).toEqual(['a.txt', 'b.txt'])
    expect(JSON.stringify(list)).not.toContain('unsaved words')
  })
  it('refuses a draft that is too large, and says nothing is there for a file with none or a file that is not a draft', () => {
    expect(store.put(text({ text: 'x'.repeat(64 * 2 ** 20 + 1) } as Partial<Draft>))).toBe(false)
    expect(store.get('/nope', 'a.txt')).toBeNull()
    fs.mkdirSync(path.join(dir, 'drafts'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'drafts', 'junk.json'), '{"not":"a draft"}')
    expect(store.list()).toEqual([])
  })
  it('forgets the drafts that are too old, and the leftovers of a write that did not finish', () => {
    store.put(text({ at: '2026-01-01T00:00:00.000Z' }))
    store.put(text({ path: 'new.txt', at: '2026-10-05T00:00:00.000Z' }))
    fs.writeFileSync(path.join(dir, 'drafts', 'abc.json.123.part'), 'half')
    store.prune(30, Date.parse('2026-10-06T00:00:00.000Z'))
    expect(store.list().map((d) => d.path)).toEqual(['new.txt'])
    expect(fs.readdirSync(path.join(dir, 'drafts')).some((n) => n.endsWith('.part'))).toBe(false)
  })
  it('does not break on a folder that is not there', () => {
    expect(store.list()).toEqual([])
    expect(() => store.prune(30)).not.toThrow()
    expect(() => store.delete('/x', 'y')).not.toThrow()
  })
})
