import { describe, expect, it } from 'vitest'
import { translator } from '@/i18n/index.ts'
import { snapshotInfo } from '@/test/fixtures.ts'
import { empty, reduce, type Action, type Workspace } from '@/state/workspace.ts'
import { describeTabs, snapshotTitle, sourceTitle } from './tabInfo.ts'

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
