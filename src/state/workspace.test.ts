import type { SnapshotInfo } from '@core/snapshots.ts'
import { describe, expect, it } from 'vitest'
import { empty, fileKey, invalidProblems, isHeldBack, isSnapshotTab, isUnder, metadataKey, reduce, released, remapPath, snapshotKey, type Action, type Workspace } from './workspace.ts'

const snap = (id: string, signature: SnapshotInfo['signature'] = { state: 'unsigned' }): SnapshotInfo => ({ id, path: `/${id}.wsnp`, manifest: { title: id } as SnapshotInfo['manifest'], files: [], signature })
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
