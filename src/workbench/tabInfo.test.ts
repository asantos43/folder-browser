import { describe, expect, it } from 'vitest'
import { translator } from '@/i18n/index.ts'
import { snapshotInfo } from '@/test/fixtures.ts'
import { empty, reduce, type Action, type Workspace } from '@/state/workspace.ts'
import { describeTabs, isEditable, kindOf, snapshotTitle, sourceTitle } from './tabInfo.ts'

const t = translator('en')
const run = (...actions: Action[]): Workspace => actions.reduce(reduce, empty)
/** Two files that say the same (the same page, saved twice) but are two files. */
const same = (id: string, path: string) => snapshotInfo(id, 'Harbor Times — Local news', { path, manifest: { ...snapshotInfo(id).manifest, title: 'Harbor Times — Local news', source: { url: 'https://harbortimes.example/', canonical: '', language: 'en' } } })

describe('the title of a snapshot in the tabs', () => {
  it('is the name of its file, not the title of its page nor its address', () => {
    const ws = run({ type: 'snapshot-opened', snapshot: same('a', '/home/me/news/harbor-2026-03-01.wsnp') })
    expect(snapshotTitle(ws, 'a')).toBe('harbor-2026-03-01.wsnp')
    expect(sourceTitle(ws, 'a')).toBe('harbor-2026-03-01.wsnp')
    expect(describeTabs(ws, t).get('s:a')?.label).toBe('harbor-2026-03-01.wsnp')
  })
  it('tells two files of the same page and the same address apart, by their names', () => {
    const ws = run({ type: 'snapshot-opened', snapshot: same('a', '/home/me/news/harbor-2026-03-01.wsnp') }, { type: 'snapshot-opened', snapshot: same('b', '/home/me/news/harbor-2026-04-01.wsnp') })
    const views = describeTabs(ws, t)
    expect(views.get('s:a')?.label).toBe('harbor-2026-03-01.wsnp')
    expect(views.get('s:b')?.label).toBe('harbor-2026-04-01.wsnp')
    expect(views.get('s:a')?.description).toBe('')
  })
  it('says the folder when two files of the same name are open (in two folders)', () => {
    const ws = run({ type: 'snapshot-opened', snapshot: same('a', '/home/me/2026/page.wsnp') }, { type: 'snapshot-opened', snapshot: same('b', '/home/me/2027/page.wsnp') })
    const views = describeTabs(ws, t)
    expect(views.get('s:a')?.description).toBe('/home/me/2026')
    expect(views.get('s:b')?.description).toBe('/home/me/2027')
  })
  it('has, in the tooltip of a page, where the file is and the address the page was saved from', () => {
    const ws = run({ type: 'snapshot-opened', snapshot: same('a', '/home/me/news/harbor.wsnp') })
    expect(describeTabs(ws, t).get('s:a')?.tooltip).toBe('/home/me/news/harbor.wsnp\nhttps://harbortimes.example/')
  })
  it('names the metadata tab and the files of a snapshot by the file too', () => {
    const ws = run({ type: 'snapshot-opened', snapshot: same('a', '/home/me/news/harbor.wsnp') }, { type: 'open-metadata', snapshotId: 'a' }, { type: 'open-file', snapshotId: 'a', path: 'index.html', keep: true })
    const views = describeTabs(ws, t)
    expect(views.get('m:a')?.label).toBe('Metadata: harbor.wsnp')
    expect(views.get('f:a:index.html')?.tooltip).toBe('harbor.wsnp › index.html')
  })
})

describe('a file shown as its bytes', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const ws = run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path: 'docs/a.docx', keep: true, size: 900 }, { type: 'open-file', snapshotId: 'r1', path: 'docs/a.docx', keep: true, size: 900, as: 'hex' })
  it('is called Hex, with the name, and has the icon of bytes; the file in its own kind keeps its name', () => {
    const views = describeTabs(ws, t)
    expect(views.get('f:r1:docs/a.docx')).toMatchObject({ label: 'a.docx', icon: 'file-text' })
    expect(views.get('x:r1:docs/a.docx')).toMatchObject({ label: 'Hex: a.docx', icon: 'file-binary' })
  })
  it('is of kind hex whatever the file is, and the same file in the other tab is a document', () => {
    expect(kindOf(ws, ws.tabs.find((tab) => tab.key === 'x:r1:docs/a.docx')!).kind).toBe('hex')
    expect(kindOf(ws, ws.tabs.find((tab) => tab.key === 'f:r1:docs/a.docx')!).kind).toBe('document')
  })
})

describe('isEditable', () => {
  const folder = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const tabOf = (ws: Workspace, key: string) => ws.tabs.find((tab) => tab.key === key)!
  it('is true for a file of a folder that was opened and for the tab of its bytes, and false for an entry of a ZIP, a ZIP or the trash as the root, and a snapshot', () => {
    const ws = run(
      { type: 'root-opened', root: folder },
      { type: 'root-opened', root: { id: 'r2', kind: 'zip', path: '/p.zip', name: 'p.zip' } },
      { type: 'root-opened', root: { id: 'r3', kind: 'folder', path: '/trash', name: 'Trash', trash: true } },
      { type: 'open-file', snapshotId: 'r1', path: 'a.txt', keep: true },
      { type: 'open-file', snapshotId: 'r1', path: 'a.txt', keep: true, as: 'hex' },
      { type: 'open-file', snapshotId: 'r1', path: 'pack.zip!/in.txt', keep: true },
      { type: 'open-file', snapshotId: 'r2', path: 'top.txt', keep: true },
      { type: 'open-file', snapshotId: 'r3', path: 'old.txt', keep: true },
      { type: 'snapshot-opened', snapshot: snapshotInfo('s1', 'S') },
      { type: 'open-metadata', snapshotId: 's1' },
    )
    expect(isEditable(ws, tabOf(ws, 'f:r1:a.txt'))).toBe(true)
    expect(isEditable(ws, tabOf(ws, 'x:r1:a.txt'))).toBe(true)
    expect(isEditable(ws, tabOf(ws, 'f:r1:pack.zip!/in.txt'))).toBe(false)
    expect(isEditable(ws, tabOf(ws, 'f:r2:top.txt'))).toBe(false)
    expect(isEditable(ws, tabOf(ws, 'f:r3:old.txt'))).toBe(false)
    expect(isEditable(ws, tabOf(ws, 's:s1'))).toBe(false)
    expect(isEditable(ws, tabOf(ws, 'm:s1'))).toBe(false)
  })
})

describe('two files compared', () => {
  const work = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const backup = { id: 'r2', kind: 'zip' as const, path: '/home/me/backup.zip', name: 'backup.zip' }
  const compare = (left: string, right: string) => run({ type: 'root-opened', root: work }, { type: 'root-opened', root: backup }, { type: 'open-diff', left: { rootId: 'r1', path: left }, right: { rootId: 'r2', path: right } })
  it('is named after both files, with the diff icon, and says in the tooltip where each one is', () => {
    const ws = compare('a.txt', 'docs/a.txt')
    expect(describeTabs(ws, t).get(ws.active!)).toMatchObject({ label: 'a.txt ↔ a.txt', icon: 'diff', tooltip: 'work › a.txt\nbackup.zip › docs/a.txt', description: '' })
  })
  it('tells two comparisons of the same names apart by the folders of the sides', () => {
    const ws = reduce(compare('a.txt', 'docs/a.txt'), { type: 'open-diff', left: { rootId: 'r1', path: 'x/a.txt' }, right: { rootId: 'r2', path: 'a.txt' } })
    const views = [...describeTabs(ws, t).values()]
    expect(views.map((v) => v.description).sort()).toEqual(['work ↔ backup.zip/docs', 'work/x ↔ backup.zip'].sort())
  })
  it('is not a file of a folder, so it is not edited', () => {
    const ws = compare('a.txt', 'a.txt')
    expect(isEditable(ws, ws.tabs[0])).toBe(false)
  })
})
