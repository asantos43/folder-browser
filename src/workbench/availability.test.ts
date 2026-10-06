// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { svgView } from '@/state/setting.ts'
import { snapshotInfo } from '@/test/fixtures.ts'
import { empty, reduce, type Action, type Workspace } from '@/state/workspace.ts'
import { canFind, canPrint, printRequestOf, zoomTargetOf } from './availability.ts'

const run = (...actions: Action[]): Workspace => actions.reduce(reduce, empty)
const info = snapshotInfo('a', 'Alpha')
info.files.push({ path: 'assets/images/mark.svg', size: 120, mediaType: 'image/svg+xml' })
const on = (path: string) => run({ type: 'snapshot-opened', snapshot: info }, { type: 'open-file', snapshotId: 'a', path, keep: true })
const page = run({ type: 'snapshot-opened', snapshot: info })

beforeEach(() => {
  localStorage.clear()
  svgView.reload()
})
afterEach(() => localStorage.clear())

describe('zoomTargetOf: what the zoom keys act on', () => {
  it('is the tab’s own zoom for a page and a text, the view’s own for a picture and a PDF, and nothing for the rest', () => {
    expect(zoomTargetOf(page)).toBe('page')
    expect(zoomTargetOf(on('assets/styles/site.css'))).toBe('text')
    expect(zoomTargetOf(on('assets/images/logo.png'))).toBe('view')
    expect(zoomTargetOf(on('assets/files/report.pdf'))).toBe('view')
    expect(zoomTargetOf(on('assets/files/bundle.zip'))).toBeNull()
    expect(zoomTargetOf(run({ type: 'snapshot-opened', snapshot: info }, { type: 'open-metadata', snapshotId: 'a' }))).toBeNull()
    expect(zoomTargetOf(run({ type: 'open-settings' }))).toBeNull()
    expect(zoomTargetOf(empty)).toBeNull()
  })
  it('follows the way an SVG is shown: a picture keeps its own zoom, source has the tab’s', () => {
    const ws = on('assets/images/mark.svg')
    expect(zoomTargetOf(ws)).toBe('view')
    svgView.set('code')
    expect(zoomTargetOf(ws)).toBe('text')
  })
})

describe('an SVG shown as a picture', () => {
  const ws = on('assets/images/mark.svg')
  it('has no text to search and is printed as a picture; as source it is searched and printed as text', () => {
    expect(canFind(ws)).toBe(false)
    expect(canPrint(ws)).toBe(true)
    expect(printRequestOf(ws, () => 'source')).toEqual({ kind: 'image', id: 'a', path: 'assets/images/mark.svg' })
    svgView.set('code')
    expect(canFind(ws)).toBe(true)
    expect(printRequestOf(ws, () => 'source')).toMatchObject({ kind: 'text', text: 'source', name: 'mark.svg' })
  })
})

describe('office documents and the bytes of a file', () => {
  const root = { id: 'r1', kind: 'folder' as const, path: '/home/me/work', name: 'work' }
  const open = (path: string, as?: 'hex') => run({ type: 'root-opened', root }, { type: 'open-file', snapshotId: 'r1', path, keep: true, size: 900, ...(as ? { as } : {}) })
  it('a document is a page with the zoom of its tab, is searched in its frame and is printed whole', () => {
    const ws = open('docs/report.docx')
    expect(zoomTargetOf(ws)).toBe('page')
    expect(canFind(ws)).toBe(true)
    expect(canPrint(ws)).toBe(true)
    expect(printRequestOf(ws, () => null)).toEqual({ kind: 'document', id: 'r1', path: 'docs/report.docx' })
    for (const name of ['a.pptx', 'a.odt', 'a.ods', 'a.xlsx', 'a.xls']) expect(printRequestOf(open(name), () => null), name).toEqual({ kind: 'document', id: 'r1', path: name })
  })
  it('the bytes of a file have the zoom of their tab and a search of their own, and are not printed', () => {
    const ws = open('docs/report.docx', 'hex')
    expect(zoomTargetOf(ws)).toBe('text')
    expect(canFind(ws)).toBe(true)
    expect(canPrint(ws)).toBe(false)
    expect(printRequestOf(ws, () => null)).toBeNull()
  })
})
