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

  it('remembers that a file was shown as its bytes, and brings it back as that tab', () => {
    const ws = run({ type: 'snapshot-opened', snapshot: a }, { type: 'open-file', snapshotId: 'a', path: 'assets/files/x.bin', keep: true, size: 5, as: 'hex' })
    const session = sessionOf(ws)
    expect(session.tabs.at(-1)).toMatchObject({ kind: 'file', file: 'assets/files/x.bin', as: 'hex' })
    expect(isSession(session)).toBe(true)
    expect(keyOfEntry(session.tabs.at(-1)!, 'q')).toBe('x:q:assets/files/x.bin')
    expect(isSession({ ...session, tabs: [{ snapshot: 's', kind: 'file', file: 'f', as: 'other' }] })).toBe(false)
  })

  it('has nothing to remember when nothing is open', () => {
    expect(sessionOf(empty)).toEqual({ roots: [], tabs: [], active: -1 })
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

  it('remembers the folders and ZIP files that were open, also with no tab, and the files of them in the tabs', () => {
    const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
    const ws = run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path: 'docs/a.txt', keep: true, size: 5 })
    const session = sessionOf(ws)
    expect(session.roots).toEqual(['/home/me/work'])
    expect(session.tabs).toEqual([{ snapshot: '/home/me/work', kind: 'file', file: 'docs/a.txt', size: 5 }])
    expect(isSession(session)).toBe(true)
    expect(sessionOf(run({ type: 'root-opened', root })).roots).toEqual(['/home/me/work'])
  })
  it('takes a session without roots (an older one), and refuses roots that are not names', () => {
    expect(isSession({ tabs: [], active: -1 })).toBe(true)
    expect(isSession({ roots: ['/a'], tabs: [], active: -1 })).toBe(true)
    expect(isSession({ roots: [1], tabs: [], active: -1 })).toBe(false)
    expect(isSession({ roots: 'x', tabs: [], active: -1 })).toBe(false)
  })
})
