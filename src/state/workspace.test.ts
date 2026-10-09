import type { SnapshotInfo } from '@core/snapshots.ts'
import { describe, expect, it } from 'vitest'
import { diffKey, empty, isSplit, shownIn, fileKey, invalidProblems, isHeldBack, isSnapshotTab, isUnder, metadataKey, moveTabKeyed, reduce, released, remapPath, sideAfterSave, snapshotKey, snapshotLocation, type Action, type Tab, type Workspace } from './workspace.ts'

const snap = (id: string, signature: SnapshotInfo['signature'] = { state: 'unsigned' }): SnapshotInfo => ({ id, path: `/${id}.wsnp`, manifest: { title: id } as SnapshotInfo['manifest'], files: [], signature })
const snapAt = (id: string, path: string, signature: SnapshotInfo['signature'] = { state: 'unsigned' }): SnapshotInfo => ({ id, path, manifest: { title: id } as SnapshotInfo['manifest'], files: [], signature })
const run = (actions: Action[], from: Workspace = empty): Workspace => actions.reduce(reduce, from)
const open = (...ids: string[]): Action[] => ids.map((id) => ({ type: 'snapshot-opened', snapshot: snap(id) }))
const file = (snapshotId: string, path: string, keep = false): Action => ({ type: 'open-file', snapshotId, path, keep })
const keys = (ws: Workspace) => ws.tabs.map((t) => t.key)

describe('opening snapshots', () => {
  it('opens a tab for each snapshot and makes the last one active (the side bar is not about snapshots)', () => {
    const ws = run(open('a', 'b'))
    expect(keys(ws)).toEqual(['s:a', 's:b'])
    expect(ws.active).toBe('s:b')
    expect(ws.selected).toBeNull()
    expect(ws.recent).toEqual(['s:b', 's:a'])
  })
  it('shows the tab that is there when a snapshot is opened again', () => {
    const ws = run([...open('a', 'b'), ...open('a')])
    expect(keys(ws)).toEqual(['s:a', 's:b'])
    expect(ws.active).toBe('s:a')
  })
})

describe('the files of a snapshot: preview tabs', () => {
  it('a single click opens a preview tab that the next single click replaces', () => {
    const ws = run([...open('a'), file('a', 'index.html'), file('a', 'assets/styles/site.css')])
    expect(keys(ws)).toEqual(['s:a', 'f:a:assets/styles/site.css'])
    expect(ws.tabs[1].preview).toBe(true)
    expect(ws.recent).not.toContain(fileKey('a', 'index.html'))
  })
  it('a double click keeps the tab, and it stays when another preview opens', () => {
    const ws = run([...open('a'), file('a', 'index.html', true), file('a', 'x.css')])
    expect(keys(ws)).toEqual(['s:a', 'f:a:index.html', 'f:a:x.css'])
    expect(ws.tabs.map((t) => t.preview)).toEqual([false, false, true])
  })
  it('a double click on a preview tab keeps it, and a click on an open tab only shows it', () => {
    let ws = run([...open('a'), file('a', 'x.css')])
    ws = reduce(ws, file('a', 'x.css', true))
    expect(ws.tabs[1].preview).toBe(false)
    ws = run([file('a', 'y.css'), { type: 'activate', key: snapshotKey('a') }, file('a', 'y.css')], ws)
    expect(ws.active).toBe(fileKey('a', 'y.css'))
    expect(keys(ws)).toHaveLength(3)
  })
  it('a kept tab opens beside the active one', () => {
    const ws = run([...open('a', 'b'), { type: 'activate', key: 's:a' }, file('a', 'k.txt', true)])
    expect(keys(ws)).toEqual(['s:a', 'f:a:k.txt', 's:b'])
  })
})

describe('keeping a preview', () => {
  it('turns a preview into a kept tab, and does nothing to a tab that is kept', () => {
    const ws = run([...open('a'), file('a', 'x.css')])
    const kept = reduce(ws, { type: 'keep', key: 'f:a:x.css' })
    expect(kept.tabs[1].preview).toBe(false)
    expect(reduce(kept, { type: 'keep', key: 'f:a:x.css' }).tabs).toEqual(kept.tabs)
  })
})

describe('closing', () => {
  it('goes back to the tab used before, as VS Code does', () => {
    let ws = run([...open('a', 'b', 'c'), { type: 'activate', key: 's:a' }, { type: 'activate', key: 's:c' }])
    ws = reduce(ws, { type: 'close', key: 's:c' })
    expect(ws.active).toBe('s:a')
    expect(keys(ws)).toEqual(['s:a', 's:b'])
  })
  it('closing the tab of a snapshot closes the snapshot and its file tabs, and says which to release', () => {
    const before = run([...open('a', 'b'), file('a', 'one.txt', true), file('b', 'two.txt', true)])
    const after = reduce(before, { type: 'close', key: 's:a' })
    expect(keys(after)).toEqual(['s:b', 'f:b:two.txt'])
    expect(Object.keys(after.snapshots)).toEqual(['b'])
    expect(released(before, after)).toEqual(['a'])
  })
  it('closing a file tab leaves the snapshot open', () => {
    const ws = run([...open('a'), file('a', 'one.txt', true), { type: 'close', key: 'f:a:one.txt' }])
    expect(keys(ws)).toEqual(['s:a'])
    expect(ws.active).toBe('s:a')
  })
  it('closes the others, the ones to the right, and all, but never a pinned tab', () => {
    const base = run([...open('a', 'b', 'c', 'd'), { type: 'pin', key: 's:b', pinned: true }])
    expect(keys(base)).toEqual(['s:b', 's:a', 's:c', 's:d'])
    expect(keys(reduce(base, { type: 'close-others', key: 's:c' }))).toEqual(['s:b', 's:c'])
    expect(keys(reduce(base, { type: 'close-right', key: 's:a' }))).toEqual(['s:b', 's:a'])
    const all = reduce(base, { type: 'close-all' })
    expect(keys(all)).toEqual(['s:b'])
    expect(all.active).toBe('s:b')
    expect(Object.keys(all.snapshots)).toEqual(['b'])
  })
  it('ends with nothing open and nothing selected when the last tab closes', () => {
    const ws = run([...open('a'), { type: 'close', key: 's:a' }])
    expect(ws).toMatchObject({ tabs: [], active: null, selected: null, snapshots: {}, recent: [] })
  })
  it('ignores a key that is not open', () => {
    const ws = run(open('a'))
    expect(reduce(ws, { type: 'close', key: 's:zzz' })).toBe(ws)
    expect(reduce(ws, { type: 'activate', key: 's:zzz' })).toBe(ws)
  })
})

describe('pinning and moving', () => {
  it('pinned tabs go first and are not previews', () => {
    const ws = run([...open('a'), file('a', 'x.css'), { type: 'pin', key: 'f:a:x.css', pinned: true }])
    expect(keys(ws)).toEqual(['f:a:x.css', 's:a'])
    expect(ws.tabs[0]).toMatchObject({ pinned: true, preview: false })
    expect(keys(reduce(ws, { type: 'pin', key: 'f:a:x.css', pinned: false }))).toEqual(['f:a:x.css', 's:a'])
  })
  it('moves a tab, without crossing the pinned ones', () => {
    const ws = run([...open('a', 'b', 'c'), { type: 'pin', key: 's:c', pinned: true }])
    expect(keys(ws)).toEqual(['s:c', 's:a', 's:b'])
    expect(keys(reduce(ws, { type: 'move', key: 's:b', to: 0 }))).toEqual(['s:c', 's:b', 's:a'])
    expect(keys(reduce(ws, { type: 'move', key: 's:a', to: 9 }))).toEqual(['s:c', 's:b', 's:a'])
    expect(keys(reduce(ws, { type: 'move', key: 's:c', to: 2 }))).toEqual(['s:c', 's:a', 's:b'])
  })
})

describe('moving between tabs', () => {
  it('steps to the next and previous tab, wrapping around', () => {
    const ws = run([...open('a', 'b', 'c'), { type: 'activate', key: 's:a' }])
    expect(reduce(ws, { type: 'step', direction: 1 }).active).toBe('s:b')
    expect(reduce(ws, { type: 'step', direction: -1 }).active).toBe('s:c')
  })
  it('a transient activation (Ctrl+Tab in progress) does not change the order of use until it is committed', () => {
    let ws = run([...open('a', 'b', 'c')])
    expect(ws.recent).toEqual(['s:c', 's:b', 's:a'])
    ws = run([{ type: 'activate', key: 's:b', transient: true }, { type: 'activate', key: 's:a', transient: true }], ws)
    expect(ws.active).toBe('s:a')
    expect(ws.recent).toEqual(['s:c', 's:b', 's:a'])
    ws = reduce(ws, { type: 'touch' })
    expect(ws.recent).toEqual(['s:a', 's:c', 's:b'])
  })
  it('selecting something that is not an open folder does nothing, and selecting a folder changes the tree, not the tabs', () => {
    const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
    const ws = run([...open('a', 'b'), { type: 'root-opened', root }, { type: 'select', snapshotId: 'r1' }])
    expect(ws.selected).toBe('r1')
    expect(ws.active).toBe('s:b')
    expect(reduce(ws, { type: 'select', snapshotId: 'a' })).toBe(ws)
    expect(reduce(ws, { type: 'select', snapshotId: 'zzz' })).toBe(ws)
  })
})

describe('integrity', () => {
  it('keeps the progress and the result of each snapshot, and drops them with the snapshot', () => {
    let ws = run(open('a'))
    ws = reduce(ws, { type: 'integrity', event: { id: 'a', state: 'running', done: 5, total: 10 } })
    expect(ws.integrity.a).toEqual({ state: 'running', done: 5, total: 10 })
    ws = reduce(ws, { type: 'integrity', event: { id: 'a', state: 'done', report: { checked: 3, bytes: 10, problems: [], aborted: false } } })
    expect(ws.integrity.a.state).toBe('done')
    expect(reduce(ws, { type: 'integrity', event: { id: 'gone', state: 'running', done: 0, total: 1 } })).toBe(ws)
    expect(reduce(ws, { type: 'close', key: 's:a' }).integrity).toEqual({})
  })
})

describe('the metadata tab', () => {
  it('opens beside the active tab, once, and is not the tab of the snapshot itself', () => {
    let ws = run([...open('a', 'b'), { type: 'activate', key: 's:a' }, { type: 'open-metadata', snapshotId: 'a' }])
    expect(keys(ws)).toEqual(['s:a', 'm:a', 's:b'])
    expect(ws.active).toBe(metadataKey('a'))
    expect(ws.tabs.map(isSnapshotTab)).toEqual([true, false, true])
    ws = reduce(ws, { type: 'open-metadata', snapshotId: 'a' })
    expect(keys(ws)).toEqual(['s:a', 'm:a', 's:b'])
    expect(reduce(ws, { type: 'open-metadata', snapshotId: 'zzz' })).toBe(ws)
  })
  it('closing it leaves the snapshot open; closing the snapshot closes it', () => {
    const ws = run([...open('a'), { type: 'open-metadata', snapshotId: 'a' }])
    const closed = reduce(ws, { type: 'close', key: 'm:a' })
    expect(keys(closed)).toEqual(['s:a'])
    expect(Object.keys(closed.snapshots)).toEqual(['a'])
    const gone = reduce(ws, { type: 'close', key: 's:a' })
    expect(keys(gone)).toEqual([])
    expect(released(ws, gone)).toEqual(['a'])
  })
})

describe('a snapshot that is not valid', () => {
  const done = (id: string, codes: string[]): Action => ({ type: 'integrity', event: { id, state: 'done', report: { checked: 3, bytes: 9, aborted: false, problems: codes.map((code) => ({ code, path: `${code}.css` })) as never } } })
  it('is held back when a file is not what the manifest says', () => {
    for (const code of ['hash-mismatch', 'size-mismatch', 'read-error']) {
      const ws = run([...open('a'), done('a', [code])])
      expect(isHeldBack(ws, 'a'), code).toBe(true)
      expect(invalidProblems(ws, 'a')).toHaveLength(1)
    }
  })
  it('is not held back for what a scan of the page finds, for a clean check, or while it is still running', () => {
    expect(isHeldBack(run([...open('a'), done('a', ['network-reference', 'inline-script'])]), 'a')).toBe(false)
    expect(isHeldBack(run([...open('a'), done('a', [])]), 'a')).toBe(false)
    expect(isHeldBack(run([...open('a'), { type: 'integrity', event: { id: 'a', state: 'running', done: 1, total: 2 } }]), 'a')).toBe(false)
  })
  it('is shown when the user insists, and forgets that when it is closed', () => {
    let ws = run([...open('a'), done('a', ['hash-mismatch'])])
    ws = reduce(ws, { type: 'show-anyway', snapshotId: 'a' })
    expect(isHeldBack(ws, 'a')).toBe(false)
    expect(invalidProblems(ws, 'a')).toHaveLength(1)
    expect(reduce(ws, { type: 'show-anyway', snapshotId: 'zzz' })).toBe(ws)
    expect(reduce(ws, { type: 'close', key: 's:a' }).shownAnyway).toEqual({})
  })
})

describe('a signature that does not check', () => {
  it('makes the snapshot not valid at once, before the contents are checked, and it can be shown anyway', () => {
    let ws = reduce(empty, { type: 'snapshot-opened', snapshot: snap('a', { state: 'invalid', reason: 'manifest-mismatch' }) })
    expect(isHeldBack(ws, 'a')).toBe(true)
    expect(invalidProblems(ws, 'a')).toEqual([{ code: 'signature-invalid', path: 'manifest.json', detail: 'manifest-mismatch' }])
    ws = reduce(ws, { type: 'show-anyway', snapshotId: 'a' })
    expect(isHeldBack(ws, 'a')).toBe(false)
  })
  it('is not what an unsigned or a rightly signed snapshot has', () => {
    expect(isHeldBack(reduce(empty, { type: 'snapshot-opened', snapshot: snap('a') }), 'a')).toBe(false)
    const valid = snap('b', { state: 'valid', algorithm: 'Ed25519', publicKey: 'x', fingerprint: 'f'.repeat(64), fingerprintShort: 'FFFF' })
    expect(isHeldBack(reduce(empty, { type: 'snapshot-opened', snapshot: valid }), 'b')).toBe(false)
  })
})

describe('the guide tab', () => {
  it('opens once, beside the active tab, in the group that has the focus, and is not a file or a snapshot', () => {
    let ws = run([...open('a', 'b'), { type: 'open-guide' }])
    expect(keys(ws)).toEqual(['s:a', 's:b', 'guide'])
    expect(ws.active).toBe('guide')
    ws = reduce(ws, { type: 'open-guide' })
    expect(ws.tabs.filter((t) => t.key === 'guide')).toHaveLength(1)
    const tab = ws.tabs.find((t) => t.key === 'guide')!
    expect(isSnapshotTab(tab)).toBe(false)
    expect(tab.path).toBeUndefined()
  })
  it('closes without touching the rest', () => {
    const ws = run([...open('a'), { type: 'open-guide' }, { type: 'close', key: 'guide' }])
    expect(keys(ws)).toEqual(['s:a'])
    expect(ws.active).toBe('s:a')
  })
})

describe('the settings tab', () => {
  it('opens once, beside the active tab, and does not change what the side bar is on', () => {
    const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
    let ws = run([...open('a', 'b'), { type: 'root-opened', root }, { type: 'open-settings' }])
    expect(keys(ws)).toEqual(['s:a', 's:b', 'settings'])
    expect(ws.active).toBe('settings')
    expect(ws.selected).toBe('r1')
    ws = reduce(ws, { type: 'open-settings' })
    expect(ws.tabs.filter((t) => t.key === 'settings')).toHaveLength(1)
    expect(ws.tabs.every((t) => t.key !== 'settings' || !isSnapshotTab(t))).toBe(true)
  })
  it('can be open with no snapshot at all, and closes without touching the snapshots', () => {
    let ws = run([{ type: 'open-settings' }])
    expect(keys(ws)).toEqual(['settings'])
    expect(ws.selected).toBeNull()
    ws = run([...open('a'), { type: 'open-settings' }, { type: 'close', key: 'settings' }])
    expect(keys(ws)).toEqual(['s:a'])
    expect(ws.active).toBe('s:a')
  })
})

describe('roots (folders and ZIP files opened to browse)', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const zip = { id: 'r2', kind: 'zip' as const, path: '/home/me/p.zip', name: 'p.zip' }
  const run = (...actions: Action[]) => actions.reduce(reduce, empty)

  it('opening one selects it and opens no tab', () => {
    const ws = run({ type: 'root-opened', root })
    expect(ws.roots).toEqual({ r1: root })
    expect(ws.selected).toBe('r1')
    expect(ws.tabs).toEqual([])
  })
  it('a file of a root gets a tab that names the root; closing the last tab keeps the root open', () => {
    let ws = run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path: 'docs/a.txt', keep: true, size: 3 })
    expect(ws.tabs).toMatchObject([{ key: 'f:r1:docs/a.txt', snapshotId: 'r1', path: 'docs/a.txt', size: 3 }])
    ws = reduce(ws, { type: 'close', key: 'f:r1:docs/a.txt' })
    expect(ws.tabs).toEqual([])
    expect(ws.roots.r1).toEqual(root)
    expect(ws.selected).toBe('r1')
  })
  it('closing a root closes its tabs, and the side bar goes to what is left', () => {
    let ws = run({ type: 'root-opened', root }, { type: 'root-opened', root: zip }, { type: 'open-file', snapshotId: 'r1', path: 'a.txt', keep: true }, { type: 'open-file', snapshotId: 'r2', path: 'b.txt', keep: true })
    ws = reduce(ws, { type: 'root-closed', id: 'r1' })
    expect(Object.keys(ws.roots)).toEqual(['r2'])
    expect(ws.tabs.map((t) => t.key)).toEqual(['f:r2:b.txt'])
    expect(ws.selected).toBe('r2')
    expect(reduce(ws, { type: 'root-closed', id: 'nope' })).toBe(ws)
  })
  it('selecting takes a root, and says which ids to release when they are gone', () => {
    const open = run({ type: 'root-opened', root }, { type: 'root-opened', root: zip })
    expect(reduce(open, { type: 'select', snapshotId: 'r1' }).selected).toBe('r1')
    expect(released(open, reduce(open, { type: 'root-closed', id: 'r2' }))).toEqual(['r2'])
  })
})

describe('a snapshot is a page in a tab, never what the side bar shows', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const base = (): Workspace => run([{ type: 'root-opened', root }])
  const page = (id: string, keep = false): Action => ({ type: 'snapshot-opened', snapshot: snap(id), ...(keep ? {} : { preview: true }) })

  it('a click opens a tab in italics, and the side bar stays on the folder', () => {
    const ws = run([page('a')], base())
    expect(ws.tabs).toMatchObject([{ key: 's:a', snapshotId: 'a', preview: true }])
    expect(ws.active).toBe('s:a')
    expect(ws.selected).toBe('r1')
    expect(Object.keys(ws.snapshots)).toEqual(['a'])
  })
  it('is replaced by the next preview, a file or another snapshot, and the snapshot it was is closed', () => {
    let ws = reduce(run([page('a')], base()), file('r1', 'notes.txt'))
    expect(ws.tabs.map((t) => t.key)).toEqual(['f:r1:notes.txt'])
    expect(Object.keys(ws.snapshots)).toEqual([])
    expect(released(run([page('a')], base()), ws)).toEqual(['a'])
    ws = run([page('a'), page('b')], base())
    expect(ws.tabs.map((t) => t.key)).toEqual(['s:b'])
    expect(Object.keys(ws.snapshots)).toEqual(['b'])
    expect(ws.selected).toBe('r1')
  })
  it('a double click keeps the tab (another tab, not a preview any more), and a preview never takes that back, whatever order the answers come in', () => {
    const ws = run([page('a'), page('a', true)], base())
    expect(ws.tabs).toMatchObject([{ key: 's:a', preview: false }])
    expect(ws.selected).toBe('r1')
    expect(reduce(ws, page('a')).tabs).toMatchObject([{ key: 's:a', preview: false }])
    expect(run([page('a', true), page('a')], base()).tabs).toMatchObject([{ key: 's:a', preview: false }])
  })
  it('does not take the side bar, whatever is done with its tab, its metadata or its files', () => {
    let ws = run([page('a', true), file('r1', 'x.txt', true)], base())
    ws = reduce(ws, { type: 'activate', key: 's:a' })
    expect(ws.selected).toBe('r1')
    ws = reduce(ws, { type: 'keep', key: 's:a' })
    ws = reduce(ws, { type: 'open-metadata', snapshotId: 'a' })
    expect(ws.active).toBe('m:a')
    ws = reduce(ws, { type: 'open-file', snapshotId: 'a', path: 'manifest.json', keep: true })
    ws = reduce(ws, { type: 'close', key: 'f:r1:x.txt' })
    expect(ws.selected).toBe('r1')
  })
  it('stays out of the side bar even when nothing else is open: with no folder there is nothing to show', () => {
    const ws = run([{ type: 'snapshot-opened', snapshot: snap('a') }])
    expect(ws.selected).toBeNull()
    expect(reduce(ws, { type: 'select', snapshotId: 'a' }).selected).toBeNull()
  })
  it('is closed with its snapshot by its own close button, and does not replace a kept tab', () => {
    const closed = reduce(run([page('a')], base()), { type: 'close', key: 's:a' })
    expect(closed.tabs).toEqual([])
    expect(closed.snapshots).toEqual({})
    const ws = run([file('r1', 'kept.txt', true), page('a')], base())
    expect(ws.tabs.map((t) => [t.key, t.preview])).toEqual([['f:r1:kept.txt', false], ['s:a', true]])
  })
  it('a folder is what the side bar is on: coming to the tab of one of its files takes it there', () => {
    const second = { id: 'r2', kind: 'folder' as const, path: '/home/me/other', name: 'other' }
    let ws = run([{ type: 'root-opened', root: second }, file('r2', 'a.txt', true), { type: 'select', snapshotId: 'r1' }], base())
    expect(ws.selected).toBe('r1')
    ws = reduce(ws, { type: 'activate', key: 'f:r2:a.txt' })
    expect(ws.selected).toBe('r2')
  })
})

describe('a snapshot tab follows the Files area to the root that contains its .wsnp', () => {
  const r1 = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const r2 = { id: 'r2', kind: 'folder' as const, path: '/home/me/other', name: 'other' }
  const zip = { id: 'rz', kind: 'zip' as const, path: '/home/me/work/p.zip', name: 'p.zip' }
  const run = (...actions: Action[]) => actions.reduce(reduce, empty)

  it('takes the Files area to the open folder that contains the .wsnp', () => {
    const ws = run({ type: 'root-opened', root: r1 }, { type: 'root-opened', root: r2 }, { type: 'snapshot-opened', snapshot: snapAt('a', '/home/me/work/page.wsnp') })
    expect(ws.selected).toBe('r1')
    expect(snapshotLocation(ws, ws.tabs[0])).toEqual({ rootId: 'r1', path: 'page.wsnp' })
  })
  it('takes the Files area to the open ZIP that has the .wsnp as an entry', () => {
    const ws = run({ type: 'root-opened', root: r1 }, { type: 'root-opened', root: zip }, { type: 'snapshot-opened', snapshot: snapAt('a', '/home/me/work/p.zip!/page.wsnp') })
    expect(ws.selected).toBe('rz')
    expect(snapshotLocation(ws, ws.tabs[0])).toEqual({ rootId: 'rz', path: '!/page.wsnp' })
  })
  it('a folder that contains a ZIP root, both open, picks the ZIP (most specific) for an entry that is the .wsnp', () => {
    const ws = run({ type: 'root-opened', root: r1 }, { type: 'root-opened', root: zip }, { type: 'snapshot-opened', snapshot: snapAt('a', '/home/me/work/p.zip!/nested/page.wsnp') })
    expect(ws.selected).toBe('rz')
    expect(snapshotLocation(ws, ws.tabs[0])).toEqual({ rootId: 'rz', path: '!/nested/page.wsnp' })
  })
  it('leaves the Files area where it was when no open root contains the .wsnp', () => {
    let ws = run({ type: 'root-opened', root: r1 }, { type: 'root-opened', root: r2 }, { type: 'select', snapshotId: 'r2' })
    expect(ws.selected).toBe('r2')
    ws = reduce(ws, { type: 'snapshot-opened', snapshot: snapAt('a', '/elsewhere/page.wsnp') })
    expect(ws.selected).toBe('r2')
    expect(snapshotLocation(ws, ws.tabs.find((t) => t.key === 's:a')!)).toBeNull()
  })
  it('a file tab inside the snapshot follows the same root as the snapshot (the .wsnp itself)', () => {
    let ws = run({ type: 'root-opened', root: r1 }, { type: 'snapshot-opened', snapshot: snapAt('a', '/home/me/work/page.wsnp'), preview: true }, { type: 'keep', key: 's:a' }, { type: 'open-file', snapshotId: 'a', path: 'manifest.json', keep: true })
    expect(ws.selected).toBe('r1')
    expect(snapshotLocation(ws, ws.tabs.find((t) => t.key === 'f:a:manifest.json')!)).toEqual({ rootId: 'r1', path: 'page.wsnp' })
  })
  it('the metadata tab of a snapshot follows the same root', () => {
    let ws = run({ type: 'root-opened', root: r1 }, { type: 'snapshot-opened', snapshot: snapAt('a', '/home/me/work/page.wsnp'), preview: true }, { type: 'keep', key: 's:a' }, { type: 'open-metadata', snapshotId: 'a' })
    expect(ws.active).toBe(metadataKey('a'))
    expect(ws.selected).toBe('r1')
  })
  it('switches between a file of folder A and a snapshot of folder B in either direction', () => {
    let ws = run({ type: 'root-opened', root: r1 }, { type: 'root-opened', root: r2 }, { type: 'open-file', snapshotId: 'r1', path: 'a.txt', keep: true }, { type: 'snapshot-opened', snapshot: snapAt('s', '/home/me/other/page.wsnp'), preview: true }, { type: 'keep', key: 's:s' })
    expect(ws.selected).toBe('r2')
    ws = reduce(ws, { type: 'activate', key: 'f:r1:a.txt' })
    expect(ws.selected).toBe('r1')
    ws = reduce(ws, { type: 'activate', key: 's:s' })
    expect(ws.selected).toBe('r2')
    ws = reduce(ws, { type: 'open-metadata', snapshotId: 's' })
    expect(ws.active).toBe(metadataKey('s'))
    expect(ws.selected).toBe('r2')
  })
  it('a snapshot never becomes a root or enters ws.roots', () => {
    const ws = run({ type: 'root-opened', root: r1 }, { type: 'snapshot-opened', snapshot: snapAt('a', '/home/me/work/page.wsnp') })
    expect(Object.keys(ws.roots)).toEqual(['r1'])
    expect(ws.snapshots).toHaveProperty('a')
    expect(ws.roots).not.toHaveProperty('a')
  })
  it('tabs of files of folders and ZIPs still take the Files area to their own root', () => {
    const z = { id: 'rz2', kind: 'zip' as const, path: '/home/me/p.zip', name: 'p.zip' }
    let ws = run({ type: 'root-opened', root: r1 }, { type: 'root-opened', root: r2 }, { type: 'root-opened', root: z }, { type: 'open-file', snapshotId: 'rz2', path: 'x.txt', keep: true }, { type: 'select', snapshotId: 'r1' })
    expect(ws.selected).toBe('r1')
    ws = reduce(ws, { type: 'activate', key: 'f:rz2:x.txt' })
    expect(ws.selected).toBe('rz2')
  })
  it('snapshotLocation is null for a tab that does not name a snapshot', () => {
    const ws = run({ type: 'root-opened', root: r1 }, { type: 'open-file', snapshotId: 'r1', path: 'a.txt', keep: true }, { type: 'open-guide' })
    expect(snapshotLocation(ws, ws.tabs.find((t) => t.key === 'f:r1:a.txt')!)).toBeNull()
    expect(snapshotLocation(ws, ws.tabs.find((t) => t.key === 'guide')!)).toBeNull()
    expect(snapshotLocation(empty, { key: 'x', snapshotId: 'nope', preview: false, pinned: false } as Tab)).toBeNull()
  })
})

describe('a file shown as its bytes', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const run = (...actions: Action[]) => actions.reduce(reduce, empty)
  it('has a tab of its own, so the file can be open both ways', () => {
    const ws = run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path: 'a.docx', keep: true, size: 9 }, { type: 'open-file', snapshotId: 'r1', path: 'a.docx', keep: true, size: 9, as: 'hex' })
    expect(ws.tabs.map((t) => [t.key, t.as])).toEqual([['f:r1:a.docx', undefined], ['x:r1:a.docx', 'hex']])
    expect(ws.active).toBe('x:r1:a.docx')
  })
  it('opened again, brings its tab to the front and does not open another', () => {
    let ws = run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path: 'a.bin', keep: true, as: 'hex' }, { type: 'open-file', snapshotId: 'r1', path: 'b.txt', keep: true })
    ws = reduce(ws, { type: 'open-file', snapshotId: 'r1', path: 'a.bin', keep: true, as: 'hex' })
    expect(ws.tabs).toHaveLength(2)
    expect(ws.active).toBe('x:r1:a.bin')
  })
  it('follows the side bar to its root, as any file of a root does', () => {
    const ws = run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path: 'a.bin', keep: true, as: 'hex' })
    expect(ws.selected).toBe('r1')
  })
})

describe('an item of a folder renamed, moved or deleted', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const other = { id: 'r2', kind: 'folder' as const, path: '/home/me/other', name: 'other' }
  const open = (snapshotId: string, path: string, extra: Partial<Extract<Action, { type: 'open-file' }>> = {}): Action => ({ type: 'open-file', snapshotId, path, keep: true, ...extra })
  const run = (...actions: Action[]) => actions.reduce(reduce, empty)

  it('knows what is under a path: itself, what is in a folder, and the entries of a ZIP (and not a name that only starts the same)', () => {
    expect(isUnder('a/b.txt', 'a')).toBe(true)
    expect(isUnder('a', 'a')).toBe(true)
    expect(isUnder('p.zip!/x/y', 'p.zip')).toBe(true)
    expect(isUnder('ab/c', 'a')).toBe(false)
    expect(isUnder('a.txt', 'a')).toBe(false)
    expect(remapPath('docs/a/b.txt', 'docs/a', 'docs/z')).toBe('docs/z/b.txt')
    expect(remapPath('p.zip!/in.txt', 'p.zip', 'q.zip')).toBe('q.zip!/in.txt')
    expect(remapPath('other/x', 'docs', 'z')).toBe('other/x')
  })
  it('the tab of a renamed file follows it: its key and path, its place, its preview and its pin, and the one in front stays in front', () => {
    let ws = run({ type: 'root-opened', root }, open('r1', 'a.txt'), open('r1', 'b.txt'), open('r1', 'c.txt', { keep: false }))
    ws = reduce(ws, { type: 'pin', key: 'f:r1:b.txt', pinned: true })
    ws = reduce(ws, { type: 'activate', key: 'f:r1:a.txt' })
    const before = ws.tabs.map((t) => t.key)
    ws = reduce(ws, { type: 'path-changed', rootId: 'r1', from: 'a.txt', to: 'z.txt' })
    expect(ws.tabs.map((t) => t.key)).toEqual(before.map((k) => (k === 'f:r1:a.txt' ? 'f:r1:z.txt' : k)))
    expect(ws.tabs.find((t) => t.path === 'z.txt')).toMatchObject({ key: 'f:r1:z.txt', path: 'z.txt' })
    expect(ws.active).toBe('f:r1:z.txt')
    expect(ws.recent).toContain('f:r1:z.txt')
    expect(ws.recent).not.toContain('f:r1:a.txt')
    expect(ws.tabs.find((t) => t.path === 'b.txt')?.pinned).toBe(true)
    expect(ws.tabs.find((t) => t.path === 'c.txt')?.preview).toBe(true)
  })
  it('a renamed or moved folder takes the tabs of what is in it, the ZIP files in it and their entries, and the bytes of a file', () => {
    let ws = run({ type: 'root-opened', root }, open('r1', 'docs/a.txt'), open('r1', 'docs/deep/b.md'), open('r1', 'docs/p.zip!/x.txt'), open('r1', 'docs/a.txt', { as: 'hex' }), open('r1', 'docsx/c.txt'))
    ws = reduce(ws, { type: 'path-changed', rootId: 'r1', from: 'docs', to: 'papers/docs' })
    expect(ws.tabs.map((t) => t.key)).toEqual(['f:r1:papers/docs/a.txt', 'f:r1:papers/docs/deep/b.md', 'f:r1:papers/docs/p.zip!/x.txt', 'x:r1:papers/docs/a.txt', 'f:r1:docsx/c.txt'])
  })
  it('leaves the tabs of another root and of snapshots alone, and does nothing when no tab is of the item', () => {
    const ws = run({ type: 'root-opened', root }, { type: 'root-opened', root: other }, open('r1', 'a.txt'), open('r2', 'a.txt'))
    const after = reduce(ws, { type: 'path-changed', rootId: 'r1', from: 'a.txt', to: 'z.txt' })
    expect(after.tabs.map((t) => t.key)).toEqual(['f:r1:z.txt', 'f:r2:a.txt'])
    expect(reduce(ws, { type: 'path-changed', rootId: 'r1', from: 'nope', to: 'x' })).toBe(ws)
  })
  it('a deleted file closes its tab, and a deleted folder the tabs of all that was in it; another tab comes to the front', () => {
    let ws = run({ type: 'root-opened', root }, open('r1', 'keep.txt'), open('r1', 'docs/a.txt'), open('r1', 'docs/deep/b.md'), open('r1', 'docs/a.txt', { as: 'hex' }), open('r1', 'docsx/c.txt'))
    ws = reduce(ws, { type: 'path-removed', rootId: 'r1', path: 'docs' })
    expect(ws.tabs.map((t) => t.key)).toEqual(['f:r1:keep.txt', 'f:r1:docsx/c.txt'])
    expect(ws.tabs.some((t) => t.key === ws.active)).toBe(true)
    expect(reduce(ws, { type: 'path-removed', rootId: 'r1', path: 'nothing' })).toBe(ws)
  })
})

describe('tabs with changes not saved', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const open = (path: string): Action => ({ type: 'open-file', snapshotId: 'r1', path, keep: true })
  const run = (...actions: Action[]) => actions.reduce(reduce, empty)

  it('is marked and unmarked by the tab, and a tab that is not open is not marked', () => {
    let ws = run({ type: 'root-opened', root }, open('a.txt'))
    ws = reduce(ws, { type: 'dirty', key: 'f:r1:a.txt', dirty: true })
    expect(ws.dirty).toEqual({ 'f:r1:a.txt': true })
    expect(reduce(ws, { type: 'dirty', key: 'f:r1:a.txt', dirty: true })).toBe(ws)
    expect(reduce(ws, { type: 'dirty', key: 'f:r1:a.txt', dirty: false }).dirty).toEqual({})
    expect(reduce(ws, { type: 'dirty', key: 'f:r1:nope', dirty: true })).toBe(ws)
  })
  it('goes with the tab when it is closed, and follows it when its file is renamed or moved', () => {
    let ws = run({ type: 'root-opened', root }, open('a.txt'), open('docs/b.txt'))
    ws = reduce(reduce(ws, { type: 'dirty', key: 'f:r1:a.txt', dirty: true }), { type: 'dirty', key: 'f:r1:docs/b.txt', dirty: true })
    ws = reduce(ws, { type: 'path-changed', rootId: 'r1', from: 'docs', to: 'papers' })
    expect(Object.keys(ws.dirty).sort()).toEqual(['f:r1:a.txt', 'f:r1:papers/b.txt'])
    ws = reduce(ws, { type: 'close', key: 'f:r1:a.txt' })
    expect(ws.dirty).toEqual({ 'f:r1:papers/b.txt': true })
    ws = reduce(ws, { type: 'path-removed', rootId: 'r1', path: 'papers' })
    expect(ws.dirty).toEqual({})
  })
})

describe('two files compared', () => {
  const r1 = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const r2 = { id: 'r2', kind: 'zip' as const, path: '/home/me/backup.zip', name: 'backup.zip' }
  const left = { rootId: 'r1', path: 'a.txt' }
  const right = { rootId: 'r2', path: 'docs/a.txt' }
  const base = () => run([{ type: 'root-opened', root: r1 }, { type: 'root-opened', root: r2 }, file('r1', 'a.txt', true)])
  const opened = () => reduce(base(), { type: 'open-diff', left, right })

  it('opens one kept tab for the pair, beside the active tab, and shows it again instead of opening a second', () => {
    const ws = opened()
    expect(keys(ws)).toEqual(['f:r1:a.txt', diffKey(left, right)])
    expect(ws.active).toBe(diffKey(left, right))
    expect(ws.tabs[1]).toMatchObject({ view: 'diff', snapshotId: 'r1', preview: false, diff: { left, right } })
    expect(isSnapshotTab(ws.tabs[1])).toBe(false)
    const again = reduce(reduce(ws, { type: 'activate', key: 'f:r1:a.txt' }), { type: 'open-diff', left, right })
    expect(again.tabs).toHaveLength(2)
    expect(again.active).toBe(diffKey(left, right))
    // The other way round is another comparison.
    expect(reduce(ws, { type: 'open-diff', left: right, right: left }).tabs).toHaveLength(3)
  })
  it('is not opened for a root that is not open', () => {
    const ws = base()
    expect(reduce(ws, { type: 'open-diff', left, right: { rootId: 'nope', path: 'x' } })).toBe(ws)
  })
  it('follows a side that is renamed or moved, and closes when a side is deleted', () => {
    const renamed = reduce(opened(), { type: 'path-changed', rootId: 'r1', from: 'a.txt', to: 'b.txt' })
    const key = diffKey({ rootId: 'r1', path: 'b.txt' }, right)
    expect(keys(renamed)).toEqual(['f:r1:b.txt', key])
    expect(renamed.tabs[1].diff).toEqual({ left: { rootId: 'r1', path: 'b.txt' }, right })
    expect(renamed.active).toBe(key)
    expect(renamed.recent).toContain(key)
    // A path that is the same in another root is not the one that moved.
    expect(keys(reduce(opened(), { type: 'path-changed', rootId: 'r2', from: 'a.txt', to: 'c.txt' }))).toEqual(['f:r1:a.txt', diffKey(left, right)])
    expect(keys(reduce(opened(), { type: 'path-removed', rootId: 'r2', path: 'docs' }))).toEqual(['f:r1:a.txt'])
    expect(keys(reduce(opened(), { type: 'path-removed', rootId: 'r1', path: 'a.txt' }))).toEqual([])
  })
  it('closes when either root is closed', () => {
    expect(keys(reduce(opened(), { type: 'root-closed', id: 'r2' }))).toEqual(['f:r1:a.txt'])
    expect(keys(reduce(opened(), { type: 'root-closed', id: 'r1' }))).toEqual([])
  })
})

describe('two editor groups', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const open = (path: string, group?: 0 | 1, keep = true): Action => ({ type: 'open-file', snapshotId: 'r1', path, keep, ...(group === undefined ? {} : { group }) })
  const run = (...actions: Action[]) => actions.reduce(reduce, empty)
  const base = () => run({ type: 'root-opened', root }, open('a.txt'), open('b.txt'), open('c.txt'))
  const groupsOf = (ws: Workspace) => ({ left: ws.tabs.filter((t) => !t.group).map((t) => t.key), right: ws.tabs.filter((t) => t.group === 1).map((t) => t.key) })

  it('has one group until a tab is sent to the second, which takes the focus and leaves the first with its own tab in front', () => {
    let ws = base()
    expect(isSplit(ws)).toBe(false)
    expect(ws).toMatchObject({ focus: 0, other: null, active: 'f:r1:c.txt' })
    ws = reduce(ws, { type: 'move-to-group', key: 'f:r1:c.txt', group: 1 })
    expect(isSplit(ws)).toBe(true)
    expect(groupsOf(ws)).toEqual({ left: ['f:r1:a.txt', 'f:r1:b.txt'], right: ['f:r1:c.txt'] })
    expect(ws).toMatchObject({ focus: 1, active: 'f:r1:c.txt', other: 'f:r1:b.txt' })
    expect(shownIn(ws, 0)).toBe('f:r1:b.txt')
    expect(shownIn(ws, 1)).toBe('f:r1:c.txt')
  })
  it('opens a file in the group asked for, and a file opened without one goes to the group that has the focus', () => {
    let ws = reduce(base(), open('d.txt', 1))
    expect(groupsOf(ws).right).toEqual(['f:r1:d.txt'])
    expect(ws.focus).toBe(1)
    ws = reduce(ws, open('e.txt'))
    expect(groupsOf(ws).right).toEqual(['f:r1:d.txt', 'f:r1:e.txt'])
    ws = reduce(ws, { type: 'activate', key: 'f:r1:a.txt' })
    expect(ws).toMatchObject({ focus: 0, active: 'f:r1:a.txt', other: 'f:r1:e.txt' })
    ws = reduce(ws, open('f.txt'))
    expect(groupsOf(ws).left).toContain('f:r1:f.txt')
  })
  it('moves a file that is open in the other group when it is opened there, and keeps one tab per file', () => {
    let ws = reduce(base(), open('d.txt', 1))
    ws = reduce(ws, open('a.txt', 1))
    expect(ws.tabs.filter((t) => t.key === 'f:r1:a.txt')).toHaveLength(1)
    expect(groupsOf(ws).right).toEqual(['f:r1:d.txt', 'f:r1:a.txt'])
    expect(ws.active).toBe('f:r1:a.txt')
  })
  it('places a tab after the one it is dropped after, in the group', () => {
    let ws = reduce(base(), open('d.txt', 1))
    ws = reduce(ws, open('e.txt', 1))
    ws = reduce(ws, { type: 'move-to-group', key: 'f:r1:a.txt', group: 1, at: { key: 'f:r1:d.txt', after: true } })
    expect(groupsOf(ws).right).toEqual(['f:r1:d.txt', 'f:r1:a.txt', 'f:r1:e.txt'])
    ws = reduce(ws, { type: 'move-to-group', key: 'f:r1:b.txt', group: 1, at: { key: 'f:r1:d.txt', after: false } })
    expect(groupsOf(ws).right).toEqual(['f:r1:b.txt', 'f:r1:d.txt', 'f:r1:a.txt', 'f:r1:e.txt'])
  })
  it('the second group ends when its last tab goes (closed or moved back), and the focus goes to the first', () => {
    const split = reduce(base(), { type: 'move-to-group', key: 'f:r1:c.txt', group: 1 })
    const closed = reduce(split, { type: 'close', key: 'f:r1:c.txt' })
    expect(isSplit(closed)).toBe(false)
    expect(closed).toMatchObject({ focus: 0, other: null, active: 'f:r1:b.txt' })
    const back = reduce(split, { type: 'move-to-group', key: 'f:r1:c.txt', group: 0 })
    expect(isSplit(back)).toBe(false)
    expect(back).toMatchObject({ focus: 0, other: null, active: 'f:r1:c.txt' })
  })
  it('the first group ending leaves the second as the only one', () => {
    let ws = reduce(base(), { type: 'move-to-group', key: 'f:r1:c.txt', group: 1 })
    ws = reduce(reduce(ws, { type: 'close', key: 'f:r1:a.txt' }), { type: 'close', key: 'f:r1:b.txt' })
    expect(isSplit(ws)).toBe(false)
    expect(ws.tabs.map((t) => t.key)).toEqual(['f:r1:c.txt'])
    expect(ws).toMatchObject({ focus: 0, other: null, active: 'f:r1:c.txt' })
    // Moving the only tab of the first group away does the same.
    const two = run({ type: 'root-opened', root }, open('a.txt'), open('b.txt'))
    const moved = reduce(two, { type: 'move-to-group', key: 'f:r1:a.txt', group: 1 })
    const all = reduce(moved, { type: 'move-to-group', key: 'f:r1:b.txt', group: 1 })
    expect(isSplit(all)).toBe(false)
    expect(all.tabs.every((t) => t.group === undefined)).toBe(true)
  })
  it('closing the tab in front of a group brings forward the most recently used one of that group, not of the other', () => {
    let ws = reduce(base(), { type: 'move-to-group', key: 'f:r1:c.txt', group: 1 })
    ws = reduce(ws, open('d.txt'))
    ws = reduce(ws, { type: 'activate', key: 'f:r1:a.txt' })
    ws = reduce(ws, { type: 'activate', key: 'f:r1:d.txt' })
    ws = reduce(ws, { type: 'close', key: 'f:r1:d.txt' })
    expect(ws).toMatchObject({ focus: 1, active: 'f:r1:c.txt', other: 'f:r1:a.txt' })
  })
  it('a preview replaces the preview of its own group only', () => {
    let ws = run({ type: 'root-opened', root }, open('a.txt', 0, false), open('b.txt', 1, false))
    expect(ws.tabs.map((t) => t.key)).toEqual(['f:r1:a.txt', 'f:r1:b.txt'])
    ws = reduce(ws, open('c.txt', 1, false))
    expect(ws.tabs.map((t) => t.key)).toEqual(['f:r1:a.txt', 'f:r1:c.txt'])
  })
  it('steps through the tabs of the group that has the focus, and closes the others of that group only', () => {
    let ws = reduce(base(), { type: 'move-to-group', key: 'f:r1:c.txt', group: 1 })
    ws = reduce(ws, open('d.txt'))
    expect(reduce(ws, { type: 'step', direction: 1 }).active).toBe('f:r1:c.txt')
    expect(reduce(ws, { type: 'step', direction: -1 }).active).toBe('f:r1:c.txt')
    const others = reduce(ws, { type: 'close-others', key: 'f:r1:d.txt' })
    expect(others.tabs.map((t) => t.key)).toEqual(['f:r1:a.txt', 'f:r1:b.txt', 'f:r1:d.txt'])
    const right = reduce(ws, { type: 'close-right', key: 'f:r1:a.txt' })
    expect(right.tabs.map((t) => t.key)).toEqual(['f:r1:a.txt', 'f:r1:c.txt', 'f:r1:d.txt'])
  })
  it('follows a renamed file in either group, also the one that is not in front of the focused group', () => {
    let ws = reduce(base(), { type: 'move-to-group', key: 'f:r1:c.txt', group: 1 })
    ws = reduce(ws, { type: 'path-changed', rootId: 'r1', from: 'b.txt', to: 'z.txt' })
    expect(ws.other).toBe('f:r1:z.txt')
    expect(groupsOf(ws).left).toEqual(['f:r1:a.txt', 'f:r1:z.txt'])
  })
  it('a comparison opens in the group that has the focus', () => {
    const two = { type: 'root-opened' as const, root: { id: 'r2', kind: 'folder' as const, path: '/b', name: 'b' } }
    let ws = reduce(reduce(base(), two), { type: 'move-to-group', key: 'f:r1:c.txt', group: 1 })
    ws = reduce(ws, { type: 'open-diff', left: { rootId: 'r1', path: 'a.txt' }, right: { rootId: 'r2', path: 'a.txt' } })
    expect(ws.tabs.find((t) => t.view === 'diff')?.group).toBe(1)
  })
  it('closing a root closes its tabs in both groups', () => {
    let ws = reduce(base(), { type: 'move-to-group', key: 'f:r1:c.txt', group: 1 })
    ws = reduce(ws, { type: 'root-closed', id: 'r1' })
    expect(ws).toMatchObject({ tabs: [], active: null, other: null, focus: 0 })
  })
})

describe('a new text file (untitled)', () => {
  const r1 = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const base = () => run([{ type: 'root-opened', root: r1 }, file('r1', 'a.txt', true)])
  const untitled = (n: number) => ({ rootId: '@untitled', path: `u:${n}` })

  it('opens a kept tab with no path beside the active one, numbered from the lowest free number', () => {
    let ws = reduce(base(), { type: 'open-untitled' })
    expect(keys(ws)).toEqual(['f:r1:a.txt', 'u:1'])
    expect(ws.active).toBe('u:1')
    expect(ws.tabs[1]).toMatchObject({ view: 'untitled', preview: false, pinned: false })
    expect(ws.tabs[1].path).toBeUndefined()
    expect(isSnapshotTab(ws.tabs[1])).toBe(false)
    ws = reduce(reduce(ws, { type: 'open-untitled' }), { type: 'open-untitled' })
    expect(keys(ws).filter((k) => k.startsWith('u:'))).toEqual(['u:1', 'u:2', 'u:3'])
    // A number that was closed is used again.
    ws = reduce(ws, { type: 'close', key: 'u:2' })
    expect(reduce(ws, { type: 'open-untitled' }).active).toBe('u:2')
  })
  it('comes back with its own number when it was kept from the last session, and an open one is only shown again', () => {
    let ws = reduce(base(), { type: 'open-untitled', key: 'u:4' })
    expect(keys(ws)).toEqual(['f:r1:a.txt', 'u:4'])
    ws = reduce(reduce(ws, { type: 'activate', key: 'f:r1:a.txt' }), { type: 'open-untitled', key: 'u:4' })
    expect(keys(ws)).toEqual(['f:r1:a.txt', 'u:4'])
    expect(ws.active).toBe('u:4')
    // A key that is not one of a new text is not taken: the next free number is.
    expect(keys(reduce(base(), { type: 'open-untitled', key: '../x' }))).toEqual(['f:r1:a.txt', 'u:1'])
  })
  it('is opened in the group that has the focus', () => {
    const ws = run([{ type: 'root-opened', root: r1 }, file('r1', 'a.txt', true), file('r1', 'b.txt', true), { type: 'move-to-group', key: 'f:r1:b.txt', group: 1 }, { type: 'open-untitled' }])
    expect(ws.tabs.find((t) => t.key === 'u:1')?.group).toBe(1)
  })
  it('is compared with a file, or with another new text file, in a tab of its own', () => {
    const ws = reduce(base(), { type: 'open-untitled' })
    const side = { rootId: 'r1', path: 'a.txt' }
    const compared = reduce(ws, { type: 'open-diff', left: untitled(1), right: side })
    expect(compared.active).toBe(diffKey(untitled(1), side))
    expect(compared.tabs.at(-1)).toMatchObject({ view: 'diff', diff: { left: untitled(1), right: side } })
    // A new text file that is not open cannot be a side.
    expect(reduce(ws, { type: 'open-diff', left: untitled(2), right: side })).toBe(ws)
    const two = reduce(ws, { type: 'open-untitled' })
    expect(reduce(two, { type: 'open-diff', left: untitled(1), right: untitled(2) }).tabs.at(-1)?.view).toBe('diff')
  })
  it('takes the comparisons that have it with it when it closes (its text is gone), and no others', () => {
    const side = { rootId: 'r1', path: 'a.txt' }
    let ws = run([{ type: 'root-opened', root: r1 }, file('r1', 'a.txt', true), file('r1', 'b.txt', true), { type: 'open-untitled' }])
    ws = reduce(reduce(ws, { type: 'open-diff', left: untitled(1), right: side }), { type: 'open-diff', left: side, right: { rootId: 'r1', path: 'b.txt' } })
    ws = reduce(ws, { type: 'close', key: 'u:1' })
    expect(keys(ws).filter((k) => k.startsWith('d:'))).toEqual([diffKey(side, { rootId: 'r1', path: 'b.txt' })])
    expect(keys(ws)).not.toContain('u:1')
  })
  it('is not touched by a folder that closes or a path that changes, and follows the dirty flag like any text', () => {
    let ws = reduce(base(), { type: 'open-untitled' })
    ws = reduce(ws, { type: 'dirty', key: 'u:1', dirty: true })
    ws = reduce(reduce(ws, { type: 'path-removed', rootId: 'r1', path: '' }), { type: 'root-closed', id: 'r1' })
    expect(keys(ws)).toEqual(['u:1'])
    expect(ws.dirty).toEqual({ 'u:1': true })
    expect(reduce(ws, { type: 'close', key: 'u:1' }).dirty).toEqual({})
  })
})

describe('a new text file saved: its tab becomes the file', () => {
  const r1 = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const u = (n: number) => ({ rootId: '@untitled', path: `u:${n}` })
  const saved = (key = 'u:1', path = 'new.txt'): Action => ({ type: 'untitled-saved', key, rootId: 'r1', path })
  const start = () => run([{ type: 'root-opened', root: r1 }, file('r1', 'a.txt', true), file('r1', 'b.txt', true), { type: 'open-untitled' }, file('r1', 'c.txt', true)])

  it('takes the place of the new text: same index, kept, not in italics, as the tree opens a file', () => {
    const ws = reduce(start(), saved())
    expect(keys(ws)).toEqual(['f:r1:a.txt', 'f:r1:b.txt', 'f:r1:new.txt', 'f:r1:c.txt'])
    expect(ws.tabs.find((t) => t.key === 'f:r1:new.txt')).toEqual({ key: 'f:r1:new.txt', snapshotId: 'r1', path: 'new.txt', preview: false, pinned: false })
    expect(ws.tabs.some((t) => t.key === 'u:1' || t.view === 'untitled')).toBe(false)
    expect(isSnapshotTab(ws.tabs[2])).toBe(false)
    expect(ws.active).toBe('f:r1:c.txt')
    expect(ws.selected).toBe('r1')
  })
  it('is the same tab the tree would open (the same key and fields as open-file)', () => {
    const fromTree = run([{ type: 'root-opened', root: r1 }, file('r1', 'new.txt', true)])
    const fromSave = run([{ type: 'root-opened', root: r1 }, { type: 'open-untitled' }, saved()])
    expect(fromSave.tabs).toEqual(fromTree.tabs)
    expect(fromSave.active).toBe(fromTree.active)
  })
  it('keeps the tab in front when it was the one in front, and moves it in recent', () => {
    let ws = reduce(start(), { type: 'activate', key: 'u:1' })
    expect(ws.recent[0]).toBe('u:1')
    ws = reduce(ws, saved())
    expect(ws.active).toBe('f:r1:new.txt')
    expect(ws.recent).toEqual(['f:r1:new.txt', 'f:r1:c.txt', 'f:r1:b.txt', 'f:r1:a.txt'])
    expect(ws.recent).not.toContain('u:1')
  })
  it('keeps the pin and the place among the pinned tabs', () => {
    let ws = reduce(start(), { type: 'pin', key: 'u:1', pinned: true })
    expect(keys(ws)[0]).toBe('u:1')
    ws = reduce(ws, saved())
    expect(keys(ws)[0]).toBe('f:r1:new.txt')
    expect(ws.tabs[0].pinned).toBe(true)
    expect(ws.tabs.slice(1).every((t) => !t.pinned)).toBe(true)
  })
  it('keeps the group of the tab and the focus, and the tab in front of each group', () => {
    let ws = run([{ type: 'root-opened', root: r1 }, file('r1', 'a.txt', true), file('r1', 'b.txt', true), { type: 'move-to-group', key: 'f:r1:b.txt', group: 1 }, { type: 'open-untitled' }, { type: 'open-untitled' }])
    expect(ws.tabs.filter((t) => t.view === 'untitled').map((t) => t.group)).toEqual([1, 1])
    ws = reduce(ws, { type: 'activate', key: 'f:r1:a.txt' })
    const before = { focus: ws.focus, active: ws.active, other: ws.other }
    expect(before).toEqual({ focus: 0, active: 'f:r1:a.txt', other: 'u:2' })
    const after = reduce(ws, saved('u:1'))
    expect(after.tabs.find((t) => t.key === 'f:r1:new.txt')?.group).toBe(1)
    expect({ focus: after.focus, active: after.active, other: after.other }).toEqual(before)
    // The one in front of its group is saved: the group shows the file.
    const front = reduce(ws, saved('u:2', 'two.txt'))
    expect(front.other).toBe('f:r1:two.txt')
    expect(front.focus).toBe(0)
    expect(isSplit(front)).toBe(true)
  })
  it('does not change the tabs in front when a tab that is not in front is saved', () => {
    const ws = reduce(start(), saved())
    expect(ws.active).toBe('f:r1:c.txt')
    expect(ws.other).toBeNull()
    expect(ws.focus).toBe(0)
  })
  it('moves the dirty flag with the tab', () => {
    const ws = reduce(reduce(start(), { type: 'dirty', key: 'u:1', dirty: true }), saved())
    expect(ws.dirty).toEqual({ 'f:r1:new.txt': true })
  })
  it('does nothing for a key that is not a new text that is open, or a root or path that is not one', () => {
    const ws = start()
    expect(reduce(ws, saved('u:7'))).toBe(ws)
    expect(reduce(ws, saved('f:r1:a.txt'))).toBe(ws)
    expect(reduce(ws, { type: 'untitled-saved', key: 'u:1', rootId: '', path: 'x.txt' })).toBe(ws)
    expect(reduce(ws, { type: 'untitled-saved', key: 'u:1', rootId: '@untitled', path: 'x.txt' })).toBe(ws)
    expect(reduce(ws, { type: 'untitled-saved', key: 'u:1', rootId: 'r1', path: '' })).toBe(ws)
  })
  it('joins the tab of the file when it is open: that one comes to the front and no two tabs show the file', () => {
    let ws = reduce(start(), { type: 'activate', key: 'u:1' })
    ws = reduce(ws, saved('u:1', 'a.txt'))
    expect(keys(ws)).toEqual(['f:r1:a.txt', 'f:r1:b.txt', 'f:r1:c.txt'])
    expect(ws.active).toBe('f:r1:a.txt')
    expect(ws.recent).toEqual(['f:r1:a.txt', 'f:r1:c.txt', 'f:r1:b.txt'])
    expect(ws.recent.some((k) => k === 'u:1')).toBe(false)
    expect(ws.dirty).toEqual({})
    expect(ws.selected).toBe('r1')
  })
  it('joins a tab of the file that is in the other group: its group gets the focus', () => {
    let ws = run([{ type: 'root-opened', root: r1 }, file('r1', 'a.txt', true), file('r1', 'b.txt', true), { type: 'move-to-group', key: 'f:r1:b.txt', group: 1 }, { type: 'activate', key: 'f:r1:a.txt' }, { type: 'open-untitled' }])
    expect(ws.focus).toBe(0)
    ws = reduce(ws, saved('u:1', 'b.txt'))
    expect(keys(ws)).toEqual(['f:r1:a.txt', 'f:r1:b.txt'])
    expect(ws.focus).toBe(1)
    expect(ws.active).toBe('f:r1:b.txt')
    expect(ws.other).toBe('f:r1:a.txt')
    expect(ws.dirty).toEqual({})
  })
  it('ends the second group when the new text was alone in it and joined a tab of the first', () => {
    let ws = run([{ type: 'root-opened', root: r1 }, file('r1', 'a.txt', true), { type: 'open-untitled' }, { type: 'move-to-group', key: 'u:1', group: 1 }])
    expect(isSplit(ws)).toBe(true)
    ws = reduce(ws, saved('u:1', 'a.txt'))
    expect(isSplit(ws)).toBe(false)
    expect(ws).toMatchObject({ focus: 0, active: 'f:r1:a.txt', other: null })
  })

  it('the comparisons that had the new text have the file, with the new key, in the same place', () => {
    const side = { rootId: 'r1', path: 'a.txt' }
    const file2 = { rootId: 'r1', path: 'new.txt' }
    let ws = reduce(start(), { type: 'open-diff', left: u(1), right: side })
    const old = diffKey(u(1), side)
    expect(ws.active).toBe(old)
    const index = keys(ws).indexOf(old)
    ws = reduce(ws, saved())
    const now = diffKey(file2, side)
    expect(keys(ws)[index]).toBe(now)
    expect(ws.tabs[index]).toMatchObject({ view: 'diff', snapshotId: 'r1', diff: { left: file2, right: side } })
    expect(ws.active).toBe(now)
    expect(ws.recent).toContain(now)
    expect(ws.recent).not.toContain(old)
    // As the right side too.
    const right = reduce(reduce(start(), { type: 'open-diff', left: side, right: u(1) }), saved())
    expect(right.tabs.find((t) => t.view === 'diff')?.diff).toEqual({ left: side, right: file2 })
    expect(JSON.stringify(ws)).not.toContain('u:1')
    expect(JSON.stringify(ws)).not.toContain('@untitled')
  })
  it('a comparison of two new texts keeps the other as its side', () => {
    let ws = reduce(reduce(start(), { type: 'open-untitled' }), { type: 'open-diff', left: u(1), right: u(2) })
    ws = reduce(ws, saved('u:1'))
    expect(ws.tabs.find((t) => t.view === 'diff')?.diff).toEqual({ left: { rootId: 'r1', path: 'new.txt' }, right: u(2) })
    expect(ws.tabs.find((t) => t.view === 'diff')?.snapshotId).toBe('r1')
  })
  it('a comparison that is left with the file on both sides, or that is open already, is not kept', () => {
    const side = { rootId: 'r1', path: 'a.txt' }
    const same = reduce(reduce(start(), { type: 'open-diff', left: u(1), right: side }), saved('u:1', 'a.txt'))
    expect(keys(same).filter((k) => k.startsWith('d:'))).toEqual([])
    expect(keys(same)).not.toContain('u:1')
    // The pair is open already (the file with a.txt): the new one goes and the old one stays.
    const twice = run([{ type: 'root-opened', root: r1 }, file('r1', 'a.txt', true), file('r1', 'new.txt', true), { type: 'open-diff', left: { rootId: 'r1', path: 'new.txt' }, right: side }, { type: 'open-untitled' }, { type: 'open-diff', left: u(1), right: side }])
    const ws = reduce(twice, saved('u:1', 'other.txt'))
    expect(keys(ws).filter((k) => k.startsWith('d:'))).toHaveLength(2)
    const merged = reduce(twice, saved('u:1', 'new.txt'))
    expect(keys(merged).filter((k) => k.startsWith('d:'))).toEqual([diffKey({ rootId: 'r1', path: 'new.txt' }, side)])
    expect(JSON.stringify(merged)).not.toContain('u:1')
    expect(merged.active).toBe('f:r1:new.txt')
  })
  it('the comparisons of other tabs do not change', () => {
    const a = { rootId: 'r1', path: 'a.txt' }
    const b = { rootId: 'r1', path: 'b.txt' }
    const ws = run([{ type: 'root-opened', root: r1 }, file('r1', 'a.txt', true), file('r1', 'b.txt', true), { type: 'open-diff', left: a, right: b }, { type: 'open-untitled' }])
    const after = reduce(ws, saved())
    expect(after.tabs.find((t) => t.key === diffKey(a, b))).toBe(ws.tabs.find((t) => t.key === diffKey(a, b)))
  })
  it('leaves no trace of the new text anywhere in the workspace', () => {
    const side = { rootId: 'r1', path: 'a.txt' }
    let ws = reduce(reduce(start(), { type: 'dirty', key: 'u:1', dirty: true }), { type: 'open-diff', left: u(1), right: side })
    ws = reduce(ws, saved())
    const text = JSON.stringify(ws)
    expect(text).not.toContain('u:1')
    expect(text).not.toContain('untitled')
  })
})

describe('what is kept by the key of a tab, after the tab got another key', () => {
  it('moveTabKeyed moves the value, keeps the rest, and gives back the same object when there is nothing to move', () => {
    const zooms = { 'u:1': 2, 'f:r1:a.txt': 1.5 }
    expect(moveTabKeyed(zooms, 'u:1', 'f:r1:new.txt')).toEqual({ 'f:r1:new.txt': 2, 'f:r1:a.txt': 1.5 })
    expect(zooms).toEqual({ 'u:1': 2, 'f:r1:a.txt': 1.5 })
    expect(moveTabKeyed(zooms, 'u:9', 'x')).toBe(zooms)
    expect(moveTabKeyed(zooms, 'u:1', 'u:1')).toBe(zooms)
    expect(moveTabKeyed(zooms, 'u:1', 'f:r1:a.txt')).toEqual({ 'f:r1:a.txt': 2 })
  })
  it('sideAfterSave turns the chosen new text into the file, and leaves any other side', () => {
    const chosen = { rootId: '@untitled', path: 'u:1' }
    expect(sideAfterSave(chosen, 'u:1', 'r1', 'new.txt')).toEqual({ rootId: 'r1', path: 'new.txt' })
    expect(sideAfterSave({ rootId: '@untitled', path: 'u:2' }, 'u:1', 'r1', 'new.txt')).toEqual({ rootId: '@untitled', path: 'u:2' })
    const file = { rootId: 'r1', path: 'u:1' }
    expect(sideAfterSave(file, 'u:1', 'r1', 'new.txt')).toBe(file)
  })
})
