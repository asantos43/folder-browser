import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeRichWsnp } from '../fixtures/build.ts'
import { SnapshotRegistry } from './snapshots.ts'
import { isRiskyName, plainName, removeStaged, removeStagedSync, STAGE_PREFIX, stageFile, sweepStaged } from './stage.ts'

let dir: string
let registry: SnapshotRegistry
let id: string
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-stage-'))
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

describe('plainName and isRiskyName', () => {
  it('keeps the last part of a path and nothing that could leave the folder or confuse a system', () => {
    expect(plainName('assets/files/report.pdf')).toBe('report.pdf')
    expect(plainName('a.zip!/docs/readme.txt')).toBe('readme.txt')
    expect(plainName('..\\..\\evil.txt')).toBe('evil.txt')
    expect(plainName('.hidden')).toBe('_hidden')
    expect(plainName('what?.txt')).toBe('what_.txt')
    expect(plainName('name. ')).toBe('name')
    expect(plainName('')).toBe('file')
    expect(plainName('a/')).toBe('a')
  })
  it('knows the files that could run as a program, in any case', () => {
    for (const name of ['setup.exe', 'RUN.BAT', 'a.sh', 'x.desktop', 'y.lnk', 'z.jar', 'Tool.AppImage', 'a.ps1', 'lib.dll']) expect(isRiskyName(name), name).toBe(true)
    for (const name of ['report.pdf', 'notes.txt', 'photo.png', 'data.json', 'shell.html', 'bash.md', 'exe']) expect(isRiskyName(name), name).toBe(false)
  })
})

describe('stageFile', () => {
  it('writes a read-only copy of a file of the snapshot in a folder of its own, under its own name', async () => {
    const staged = await stageFile(registry, id, 'assets/files/report.pdf', dir)
    if ('error' in staged) throw new Error(staged.error)
    expect(path.basename(staged.file)).toBe('report.pdf')
    expect(path.basename(staged.dir).startsWith(STAGE_PREFIX)).toBe(true)
    expect(fs.readFileSync(staged.file).subarray(0, 5).toString()).toBe('%PDF-')
    if (process.platform !== 'win32') expect(fs.statSync(staged.file).mode & 0o777).toBe(0o400)
    fs.rmSync(staged.dir, { recursive: true, force: true })
  })

  it('stages an entry of a ZIP in the snapshot, by its own name', async () => {
    const staged = await stageFile(registry, id, 'assets/files/bundle.zip!/docs/readme.txt', dir)
    if ('error' in staged) throw new Error(staged.error)
    expect(path.basename(staged.file)).toBe('readme.txt')
    expect(fs.readFileSync(staged.file, 'utf8')).toContain('ferry leaves at noon')
    fs.rmSync(staged.dir, { recursive: true, force: true })
  })

  it('refuses a file that could run as a program, and one that is not there, and writes nothing', async () => {
    const before = fs.readdirSync(dir).filter((n) => n.startsWith(STAGE_PREFIX))
    expect(await stageFile(registry, id, 'assets/files/setup.exe', dir)).toEqual({ error: 'risky' })
    expect(await stageFile(registry, id, 'assets/files/missing.pdf', dir)).toEqual({ error: 'no-file' })
    expect(await stageFile(registry, 'snobody', 'assets/files/report.pdf', dir)).toEqual({ error: 'no-file' })
    expect(fs.readdirSync(dir).filter((n) => n.startsWith(STAGE_PREFIX))).toEqual(before)
  })
})

describe('removeStaged', () => {
  it('removes the folder of a copy although the copy is read-only (Windows will not delete such a file otherwise), in both forms', async () => {
    for (const remove of [removeStaged, async (d: string) => removeStagedSync(d)]) {
      const staged = await stageFile(registry, id, 'assets/files/report.pdf', dir)
      if ('error' in staged) throw new Error(staged.error)
      await remove(staged.dir)
      expect(fs.existsSync(staged.dir)).toBe(false)
    }
    // A folder that is not there is not a failure.
    await removeStaged(path.join(dir, 'nowhere'))
    removeStagedSync(path.join(dir, 'nowhere'))
  })
})

describe('sweepStaged', () => {
  it('removes the old folders of staged files, and only those', async () => {
    const root = fs.mkdtempSync(path.join(dir, 'sweep-'))
    const old = path.join(root, `${STAGE_PREFIX}old`)
    const fresh = path.join(root, `${STAGE_PREFIX}fresh`)
    const other = path.join(root, 'something-else')
    for (const d of [old, fresh, other]) fs.mkdirSync(d)
    fs.writeFileSync(path.join(old, 'a.txt'), 'a')
    const removed = await sweepStaged(root, 60_000, Date.now() + 3_600_000 - 10)
    // An hour on, everything older than a minute goes: the two staged folders, not the other.
    expect(removed).toBe(2)
    expect(fs.readdirSync(root)).toEqual(['something-else'])
  })
  it('leaves a folder that is young, and does not mind a folder that is not there', async () => {
    const root = fs.mkdtempSync(path.join(dir, 'sweep-'))
    fs.mkdirSync(path.join(root, `${STAGE_PREFIX}young`))
    expect(await sweepStaged(root, 3_600_000)).toBe(0)
    expect(await sweepStaged(path.join(root, 'nope'), 1)).toBe(0)
  })
})
