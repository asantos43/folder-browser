import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveInside } from './guard.ts'
import { isHidden } from './hidden.ts'
import { compareEntries, sortEntries } from './sort.ts'

let dir: string
let outside: string
beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-fs-'))
  dir = path.join(base, 'root')
  outside = path.join(base, 'outside')
  fs.mkdirSync(path.join(dir, 'a'), { recursive: true })
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(dir, 'a', 'x.txt'), 'x')
  fs.writeFileSync(path.join(outside, 'secret.txt'), 's')
})
afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }))

describe('isHidden', () => {
  it('is a name that starts with a dot', () => {
    for (const name of ['.git', '.env', '.a.b']) expect(isHidden(name)).toBe(true)
    for (const name of ['a', 'a.b', 'a.', '..', '.', '']) expect(isHidden(name)).toBe(false)
  })
})

describe('sortEntries', () => {
  it('puts folders first and numbers in order, without caring for case', () => {
    const rows = [{ name: 'file10', kind: 'file' }, { name: 'File2', kind: 'file' }, { name: 'zeta', kind: 'dir' }, { name: 'alpha', kind: 'dir' }]
    expect(sortEntries(rows).map((r) => r.name)).toEqual(['alpha', 'zeta', 'File2', 'file10'])
  })
})

describe('resolveInside', () => {
  it('finds what is inside, and the root itself', async () => {
    const real = fs.realpathSync(dir)
    expect(await resolveInside(dir, '')).toBe(dir)
    expect(await resolveInside(dir, 'a/x.txt')).toBe(path.join(real, 'a', 'x.txt'))
    expect(await resolveInside(dir, 'a')).toBe(path.join(real, 'a'))
  })
  it.each(['../outside/secret.txt', 'a/../../outside/secret.txt', '/etc/passwd', 'C:/Windows', 'a\\x.txt', 'a/\0', 'a/./x.txt', '..'])('refuses %j', async (relative) => {
    expect(await resolveInside(dir, relative)).toBeNull()
  })
  it('refuses what is not there', async () => {
    expect(await resolveInside(dir, 'a/none.txt')).toBeNull()
  })
  it.skipIf(process.platform === 'win32')('refuses a symbolic link whose target is outside the root, and follows one that stays inside', async () => {
    fs.symlinkSync(outside, path.join(dir, 'escape'))
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'inside'))
    expect(await resolveInside(dir, 'escape')).toBeNull()
    expect(await resolveInside(dir, 'escape/secret.txt')).toBeNull()
    expect(await resolveInside(dir, 'inside/x.txt')).toBe(path.join(fs.realpathSync(dir), 'a', 'x.txt'))
  })
})

describe('compareEntries', () => {
  const e = (name: string, kind: string, size = 0, modified = '2026-01-01T00:00:00.000Z') => ({ name, kind, size, modified })
  const rows = [e('b.txt', 'file', 300, '2026-03-01T00:00:00.000Z'), e('A.txt', 'file', 100, '2026-05-01T00:00:00.000Z'), e('dir2', 'dir', 0, '2026-04-01T00:00:00.000Z'), e('c.txt', 'file', 200, '2026-01-01T00:00:00.000Z'), e('dir10', 'dir', 0, '2026-02-01T00:00:00.000Z')]
  const order = (key: 'name' | 'modified' | 'size', desc: boolean) => [...rows].sort(compareEntries(key, desc)).map((r) => r.name)

  it('orders by name, folders first, numbers as numbers, case apart', () => {
    expect(order('name', false)).toEqual(['dir2', 'dir10', 'A.txt', 'b.txt', 'c.txt'])
    expect(order('name', true)).toEqual(['dir10', 'dir2', 'c.txt', 'b.txt', 'A.txt'])
  })
  it('orders by date, the oldest first, and the newest first when descending; folders still first', () => {
    expect(order('modified', false)).toEqual(['dir10', 'dir2', 'c.txt', 'b.txt', 'A.txt'])
    expect(order('modified', true)).toEqual(['dir2', 'dir10', 'A.txt', 'b.txt', 'c.txt'])
  })
  it('orders by size, the smallest first, and the largest first when descending; folders by name', () => {
    expect(order('size', false)).toEqual(['dir2', 'dir10', 'A.txt', 'c.txt', 'b.txt'])
    expect(order('size', true)).toEqual(['dir2', 'dir10', 'b.txt', 'c.txt', 'A.txt'])
  })
  it('settles a tie by the name', () => {
    const same = [e('z', 'file', 5), e('a', 'file', 5), e('m', 'file', 5)]
    expect(same.sort(compareEntries('size')).map((r) => r.name)).toEqual(['a', 'm', 'z'])
    expect(same.sort(compareEntries('modified')).map((r) => r.name)).toEqual(['a', 'm', 'z'])
  })
  it('keeps the order of the main process for the default', () => {
    expect([...rows].sort(compareEntries()).map((r) => r.name)).toEqual(sortEntries([...rows]).map((r) => r.name))
  })
})
