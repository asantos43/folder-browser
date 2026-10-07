import { describe, expect, it } from 'vitest'
import { locationOf, treeMenuFor } from './treeMenu.ts'

const actions = (kind: 'dir' | 'file' | 'zip' | 'wsnp') => treeMenuFor({ kind }).filter((i) => i !== 'separator')

describe('treeMenuFor', () => {
  it('has Open With…, the default application, Save As, Show in Folder and Copy Path for every file, and not for a folder', () => {
    for (const kind of ['file', 'zip', 'wsnp'] as const) expect(actions(kind), kind).toEqual(expect.arrayContaining(['openWith', 'openDefault', 'save', 'reveal', 'copyPath', 'copyName', 'properties']))
    expect(actions('dir')).toEqual(['toggle', 'refresh', 'reveal', 'copyPath', 'copyName', 'properties'])
    expect(actions('dir')).not.toContain('openWith')
  })
  it('opens a file in a tab, a ZIP as a folder or a list, a .wsnp as a snapshot or a ZIP', () => {
    expect(actions('file')[0]).toBe('open')
    expect(actions('zip').slice(0, 2)).toEqual(['toggle', 'openAsList'])
    expect(actions('wsnp').slice(0, 2)).toEqual(['openSnapshot', 'openAsZip'])
    expect(actions('file')).not.toContain('openSnapshot')
    expect(actions('zip')).not.toContain('openSnapshot')
  })
  it('offers Open as Hex on every file, a ZIP and a .wsnp included, and not on a folder', () => {
    for (const kind of ['file', 'zip', 'wsnp'] as const) expect(actions(kind), kind).toContain('openAsHex')
    expect(actions('dir')).not.toContain('openAsHex')
  })
  it('keeps the groups apart with separators, never first, last or twice in a row', () => {
    for (const kind of ['dir', 'file', 'zip', 'wsnp'] as const) {
      const items = treeMenuFor({ kind })
      expect(items[0]).not.toBe('separator')
      expect(items.at(-1)).not.toBe('separator')
      items.forEach((item, i) => item === 'separator' && expect(items[i + 1]).not.toBe('separator'))
    }
  })
})

describe('treeMenuFor: changing the disk', () => {
  const edit = ['rename', 'moveTo', 'delete']
  it('offers Rename, Move to… and Delete for what is on the disk of a folder that was opened, and New File and New Folder in a folder', () => {
    for (const kind of ['file', 'zip', 'wsnp', 'dir'] as const) expect(treeMenuFor({ kind }, { writable: true }), kind).toEqual(expect.arrayContaining(edit))
    expect(treeMenuFor({ kind: 'dir' }, { writable: true })).toEqual(expect.arrayContaining(['newFile', 'newFolder']))
    // A ZIP file is a place to put things in too; a file and a snapshot are not.
    expect(treeMenuFor({ kind: 'zip' }, { writable: true })).toEqual(expect.arrayContaining(['newFile', 'newFolder']))
    for (const kind of ['file', 'wsnp'] as const) expect(treeMenuFor({ kind }, { writable: true }), kind).not.toContain('newFile')
  })
  it('offers none of it for what cannot be changed (in the trash)', () => {
    for (const kind of ['file', 'zip', 'wsnp', 'dir'] as const) {
      const items = treeMenuFor({ kind })
      for (const action of [...edit, 'newFile', 'newFolder']) expect(items, `${kind} ${action}`).not.toContain(action)
    }
  })
  it('keeps the groups apart with separators', () => {
    for (const kind of ['dir', 'file', 'zip', 'wsnp'] as const) {
      const items = treeMenuFor({ kind }, { writable: true, canPin: kind === 'dir', media: kind === 'file' })
      expect(items[0]).not.toBe('separator')
      expect(items.at(-1)).not.toBe('separator')
      items.forEach((item, i) => item === 'separator' && expect(items[i + 1]).not.toBe('separator'))
    }
  })
})

describe('treeMenuFor with a context', () => {
  it('offers to pin a folder of the disk, and only a folder', () => {
    expect(treeMenuFor({ kind: 'dir' }, { canPin: true })).toContain('addFavorite')
    expect(treeMenuFor({ kind: 'dir' })).not.toContain('addFavorite')
    expect(treeMenuFor({ kind: 'file' }, { canPin: true })).not.toContain('addFavorite')
  })
  it('puts Restore first, for any row of the trash', () => {
    for (const kind of ['dir', 'file', 'zip', 'wsnp'] as const) {
      const items = treeMenuFor({ kind }, { trashItem: true })
      expect(items.slice(0, 2), kind).toEqual(['restore', 'separator'])
    }
    expect(treeMenuFor({ kind: 'file' })).not.toContain('restore')
  })
})

describe('treeMenuFor for a video or a sound', () => {
  it('plays it instead of opening it, and keeps the rest', () => {
    const items = treeMenuFor({ kind: 'file' }, { media: true })
    expect(items[0]).toBe('play')
    expect(items).not.toContain('open')
    expect(items).toEqual(expect.arrayContaining(['openWith', 'openDefault', 'save']))
    expect(treeMenuFor({ kind: 'dir' }, { media: true })).not.toContain('play')
  })
})

describe('locationOf', () => {
  it('writes the path of a folder root, of a file in a ZIP, and of an entry of a ZIP root', () => {
    expect(locationOf({ kind: 'folder', path: '/home/me/work' }, 'docs/a.txt', '/')).toBe('/home/me/work/docs/a.txt')
    expect(locationOf({ kind: 'folder', path: '/home/me/work/' }, 'p.zip!/src/m.c', '/')).toBe('/home/me/work/p.zip!/src/m.c')
    expect(locationOf({ kind: 'folder', path: 'C:\\work' }, 'docs/a.txt', '\\')).toBe('C:\\work\\docs\\a.txt')
    expect(locationOf({ kind: 'zip', path: '/home/me/p.zip' }, 'src/m.c', '/')).toBe('/home/me/p.zip!/src/m.c')
  })
})

describe('treeMenuFor: comparing', () => {
  it('offers Select for Compare on a text file that can be compared, and Compare with Selected only once another is chosen', () => {
    expect(treeMenuFor({ kind: 'file' }, { comparable: true })).toContain('selectForCompare')
    expect(treeMenuFor({ kind: 'file' }, { comparable: true })).not.toContain('compareWithSelected')
    expect(treeMenuFor({ kind: 'file' }, { comparable: true, compareWithSelected: true })).toEqual(expect.arrayContaining(['selectForCompare', 'compareWithSelected']))
  })
  it('offers neither on a file that cannot be compared, nor on a folder, a ZIP or a .wsnp', () => {
    for (const kind of ['file', 'dir', 'zip', 'wsnp'] as const) {
      const items = treeMenuFor({ kind }, { compareWithSelected: true })
      expect(items, kind).not.toContain('selectForCompare')
      expect(items, kind).not.toContain('compareWithSelected')
    }
    for (const kind of ['dir', 'zip', 'wsnp'] as const) expect(treeMenuFor({ kind }, { comparable: true }), kind).not.toContain('selectForCompare')
  })
  it('keeps the groups apart with separators', () => {
    const items = treeMenuFor({ kind: 'file' }, { comparable: true, compareWithSelected: true, writable: true })
    expect(items.slice(0, 5)).toEqual(['open', 'separator', 'selectForCompare', 'compareWithSelected', 'separator'])
    items.forEach((item, i) => item === 'separator' && expect(items[i + 1]).not.toBe('separator'))
  })
})

describe('treeMenuFor: open as the root of the Files', () => {
  it('offers it for a folder and a ZIP file of the disk, after Expand and Refresh (Open as List), and for nothing else', () => {
    expect(treeMenuFor({ kind: 'dir' }, { canRoot: true }).slice(0, 3)).toEqual(['toggle', 'refresh', 'openAsRoot'])
    expect(treeMenuFor({ kind: 'zip' }, { canRoot: true })).toContain('openAsRoot')
    for (const kind of ['file', 'wsnp'] as const) expect(treeMenuFor({ kind }, { canRoot: true }), kind).not.toContain('openAsRoot')
    for (const kind of ['dir', 'zip'] as const) expect(treeMenuFor({ kind }), kind).not.toContain('openAsRoot')
  })
})
