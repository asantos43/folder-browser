import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RecentFiles } from './recent.ts'

let dir: string
beforeAll(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-recent-'))))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('RecentFiles', () => {
  it('lists the latest first, without repeats, up to the maximum', () => {
    const recent = new RecentFiles(path.join(dir, 'a.json'), 3)
    for (const p of ['/1', '/2', '/3', '/2', '/4']) recent.add(p)
    expect(recent.list()).toEqual(['/4', '/2', '/3'])
  })
  it('is kept between runs, and clears', () => {
    const file = path.join(dir, 'b', 'recent.json')
    new RecentFiles(file).add('/x.wsnp')
    const again = new RecentFiles(file)
    expect(again.list()).toEqual(['/x.wsnp'])
    again.clear()
    expect(new RecentFiles(file).list()).toEqual([])
  })
  it('starts empty from a missing or damaged file, and ignores what is not a path', () => {
    expect(new RecentFiles(path.join(dir, 'missing.json')).list()).toEqual([])
    const damaged = path.join(dir, 'damaged.json')
    fs.writeFileSync(damaged, '{not json')
    expect(new RecentFiles(damaged).list()).toEqual([])
    const odd = path.join(dir, 'odd.json')
    fs.writeFileSync(odd, JSON.stringify(['/ok', 3, null, { a: 1 }]))
    expect(new RecentFiles(odd).list()).toEqual(['/ok'])
  })
})
