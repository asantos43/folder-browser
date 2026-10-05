import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionStore } from './session-store.ts'

let dir: string
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-session-'))))
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('SessionStore', () => {
  it('keeps what it is given, as it was, and gives it back to another store of the same file', () => {
    const file = path.join(dir, 'profile/session.json')
    new SessionStore(file).save({ tabs: [{ snapshot: '/a.wsnp', kind: 'page' }], active: 0 })
    expect(new SessionStore(file).load()).toEqual({ tabs: [{ snapshot: '/a.wsnp', kind: 'page' }], active: 0 })
    expect(fs.readdirSync(path.dirname(file))).toEqual(['session.json'])
  })
  it('replaces what it kept, and forgets with null', () => {
    const store = new SessionStore(path.join(dir, 's.json'))
    store.save({ n: 1 })
    store.save({ n: 2 })
    expect(store.load()).toEqual({ n: 2 })
    store.save(null)
    expect(store.load()).toBeNull()
    store.save(null)
  })
  it('has nothing when there is no file, a file that is not JSON, or one that is too large', () => {
    const file = path.join(dir, 's.json')
    expect(new SessionStore(file).load()).toBeNull()
    fs.writeFileSync(file, '{not json')
    expect(new SessionStore(file).load()).toBeNull()
    fs.writeFileSync(file, JSON.stringify({ text: 'x'.repeat(300 * 1024) }))
    expect(new SessionStore(file).load()).toBeNull()
  })
  it('does not keep what is too large, and keeps what was there', () => {
    const store = new SessionStore(path.join(dir, 's.json'))
    store.save({ n: 1 })
    store.save({ text: 'x'.repeat(300 * 1024) })
    expect(store.load()).toEqual({ n: 1 })
  })
  it('is not stopped by a place it cannot write', () => {
    const blocker = path.join(dir, 'a-file')
    fs.writeFileSync(blocker, 'x')
    expect(() => new SessionStore(path.join(blocker, 'inside/s.json')).save({ n: 1 })).not.toThrow()
  })
})
