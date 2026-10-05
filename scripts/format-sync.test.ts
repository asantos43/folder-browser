import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// format-sync.mjs keeps this repository's copy of the format description the same as wsnp-viewer's (the source of truth). Here two
// throw-away repositories stand for them.
const SCRIPT = path.resolve(import.meta.dirname, 'format-sync.mjs')
const HASHES = (docs: Record<string, string>) =>
  Object.keys(docs)
    .map((f) => `${crypto.createHash('sha256').update(docs[f]).digest('hex')}  ${f}`)
    .join('\n') + '\n'
let dir: string
let source: string
let copy: string

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), text)
}
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, [path.join(copy, 'scripts', 'format-sync.mjs'), ...args], { encoding: 'utf8' })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-sync-'))
  source = path.join(dir, 'wsnp-viewer')
  copy = path.join(dir, 'folder-browser')
  const docs = { 'docs/FORMAT.md': '# WSNP\nsection 1\n', 'docs/MANIFEST-SIGNING.md': '# Signing\n' }
  for (const repo of [source, copy]) {
    for (const [file, text] of Object.entries(docs)) write(repo, file, text)
    write(repo, 'docs/FORMAT.sha256', HASHES(docs))
  }
  write(copy, 'scripts/x', '')
  fs.copyFileSync(SCRIPT, path.join(copy, 'scripts/format-sync.mjs'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('format-sync', () => {
  it('says the copy is identical when it is', () => {
    const result = run(`--sibling=${source}`)
    expect(result.code).toBe(0)
    expect(result.out).toContain('identical to wsnp-viewer')
  })
  it('checks the recorded hashes alone when wsnp-viewer is not there (what CI does)', () => {
    const result = run(`--sibling=${path.join(dir, 'nowhere')}`)
    expect(result.code).toBe(0)
    expect(result.out).toContain('wsnp-viewer was not found')
    expect(run(`--sibling=${path.join(dir, 'nowhere')}`, '--require-sibling').code).toBe(1)
  })
  it('fails when the copied docs are edited here without the record', () => {
    write(copy, 'docs/FORMAT.md', '# WSNP\nsection 1 changed\n')
    const result = run(`--sibling=${path.join(dir, 'nowhere')}`)
    expect(result.code).toBe(1)
    expect(result.out).toContain('changed without docs/FORMAT.sha256')
  })
  it('names the line where the copy differs from wsnp-viewer', () => {
    write(source, 'docs/FORMAT.md', '# WSNP\nsection 1 newer\n')
    const result = run(`--sibling=${source}`)
    expect(result.code).toBe(1)
    expect(result.out).toContain('docs/FORMAT.md differs')
    expect(result.out).toContain('line 2')
  })
})
