import { describe, expect, it } from 'vitest'
import { snapshotInfo } from '@/test/fixtures.ts'
import { isSession, keyOfEntry, sessionOf } from './session.ts'
import { empty, reduce, type Action, type Workspace } from './workspace.ts'

const run = (...actions: Action[]): Workspace => actions.reduce(reduce, empty)
const a = snapshotInfo('a', 'Alpha')
const b = snapshotInfo('b', 'Beta')

describe('session', () => {
  it('remembers the tabs in order, with the one in front, by the names of the snapshots and files only', () => {
    const ws = run(
      { type: 'snapshot-opened', snapshot: a },
      { type: 'open-file', snapshotId: 'a', path: 'assets/styles/site.css', keep: true },
      { type: 'snapshot-opened', snapshot: b },
      { type: 'open-metadata', snapshotId: 'b' },
      { type: 'open-settings' },
      { type: 'open-file', snapshotId: 'a', path: 'assets/files/bundle.zip!/docs/readme.txt', keep: true, size: 40 },
    )
    const session = sessionOf(ws)
    expect(session.tabs.map((t) => [t.snapshot, t.kind, t.file, t.size])).toEqual([
      ['/home/me/a.wsnp', 'page', undefined, undefined],
      ['/home/me/a.wsnp', 'file', 'assets/styles/site.css', undefined],
      ['/home/me/b.wsnp', 'page', undefined, undefined],
      ['/home/me/b.wsnp', 'metadata', undefined, undefined],
      ['/home/me/a.wsnp', 'file', 'assets/files/bundle.zip!/docs/readme.txt', 40],
    ])
    expect(session.tabs[session.active]).toMatchObject({ kind: 'file', file: 'assets/files/bundle.zip!/docs/readme.txt' })
    expect(JSON.stringify(session)).not.toContain('contents')
  })

  it('has nothing to remember when nothing is open', () => {
    expect(sessionOf(empty)).toEqual({ tabs: [], active: -1 })
  })

  it('says which tab an entry is, once its snapshot is open', () => {
    expect(keyOfEntry({ snapshot: 'x', kind: 'page' }, 'q')).toBe('s:q')
    expect(keyOfEntry({ snapshot: 'x', kind: 'metadata' }, 'q')).toBe('m:q')
    expect(keyOfEntry({ snapshot: 'x', kind: 'file', file: 'a/b.txt' }, 'q')).toBe('f:q:a/b.txt')
  })

  it('takes back only what has the shape of a session', () => {
    expect(isSession({ tabs: [{ snapshot: '/a.wsnp', kind: 'page' }, { snapshot: '/a.wsnp', kind: 'file', file: 'x.css', size: 3 }], active: 1 })).toBe(true)
    expect(isSession({ tabs: [], active: -1 })).toBe(true)
    for (const bad of [null, 5, {}, { tabs: 'x', active: 0 }, { tabs: [{ snapshot: 1, kind: 'page' }], active: 0 }, { tabs: [{ snapshot: 'a', kind: 'file' }], active: 0 }, { tabs: [{ snapshot: 'a', kind: 'other' }], active: 0 }, { tabs: [{ snapshot: 'a', kind: 'page', size: 'x' }], active: 0 }, { tabs: Array.from({ length: 101 }, () => ({ snapshot: 'a', kind: 'page' })), active: 0 }]) {
      expect(isSession(bad)).toBe(false)
    }
  })
})
