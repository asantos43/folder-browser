import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeRichWsnp } from '../fixtures/build.ts'
import { extractSelection, type ExtractAsk } from './extract.ts'
import { SnapshotRegistry } from './snapshots.ts'

let dir: string
let registry: SnapshotRegistry
let id: string
const ZIP = 'assets/files/bundle.zip'

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-extract-'))
  const file = path.join(dir, 'rich.wsnp')
  await writeRichWsnp(file)
  registry = new SnapshotRegistry()
  const outcome = await registry.openPath(file)
  if (!outcome.ok) throw new Error('did not open')
  id = outcome.snapshot.id
})
afterAll(async () => {
  await registry.closeAll()
  fs.rmSync(dir, { recursive: true, force: true })
})

const asking = (to: { file?: string; folder?: string }): ExtractAsk & { asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    file: async (name) => (asked.push(`file:${name}`), to.file),
    folder: async () => (asked.push('folder'), to.folder),
  }
}

describe('extractSelection', () => {
  it('one file asks for a file name, suggests the entry’s own, and writes it there', async () => {
    const ask = asking({ file: path.join(dir, 'out-readme.txt') })
    const result = await extractSelection(registry, id, ZIP, ['docs/readme.txt'], ask)
    expect(result).toEqual({ extracted: 1, path: path.join(dir, 'out-readme.txt'), skipped: 0 })
    expect(ask.asked).toEqual(['file:readme.txt'])
    expect(fs.readFileSync(path.join(dir, 'out-readme.txt'), 'utf8')).toContain('ferry leaves at noon')
  })

  it('several files, or a folder, ask for a folder and keep the ZIP’s own folders inside it', async () => {
    const out = path.join(dir, 'many')
    fs.mkdirSync(out)
    const ask = asking({ folder: out })
    const result = await extractSelection(registry, id, ZIP, ['docs/', 'top.txt'], ask)
    expect(result).toMatchObject({ extracted: 3, folder: out, skipped: 0 })
    expect(ask.asked).toEqual(['folder'])
    expect(fs.readdirSync(out).sort()).toEqual(['docs', 'top.txt'])
    expect(fs.readdirSync(path.join(out, 'docs')).sort()).toEqual(['data.json', 'readme.txt'])
  })

  it('a ZIP inside the ZIP is extracted as the file it is, and a file of the inner ZIP by its own path', async () => {
    const out = path.join(dir, 'nested-out.zip')
    expect(await extractSelection(registry, id, ZIP, ['nested.zip'], asking({ file: out }))).toMatchObject({ extracted: 1 })
    expect(fs.statSync(out).size).toBeGreaterThan(20)
    const deep = path.join(dir, 'deep.txt')
    expect(await extractSelection(registry, id, `${ZIP}!/nested.zip`, ['deep.txt'], asking({ file: deep }))).toMatchObject({ extracted: 1 })
    expect(fs.readFileSync(deep, 'utf8')).toBe('a file in a ZIP in a ZIP')
  })

  it('does nothing when the user cancels the dialog', async () => {
    expect(await extractSelection(registry, id, ZIP, ['top.txt'], asking({}))).toEqual({ cancelled: true })
    expect(await extractSelection(registry, id, ZIP, ['docs/'], asking({}))).toEqual({ cancelled: true })
  })

  it('says what went wrong for a name that is not there, a file that is not a ZIP, or a snapshot that is closed', async () => {
    expect(await extractSelection(registry, id, ZIP, ['nope.txt'], asking({ file: path.join(dir, 'x') }))).toEqual({ error: 'no-file' })
    expect(await extractSelection(registry, id, 'assets/files/data.json', ['a'], asking({}))).toEqual({ error: 'not-zip' })
    expect(await extractSelection(registry, 'sdeadbeef', ZIP, ['top.txt'], asking({}))).toEqual({ error: 'no-snapshot' })
  })
})
