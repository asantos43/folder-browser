import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error a plain .mjs script with no types
import { classify, collectFiles, selectTests, main } from './test-changed.mjs'

const temporary: string[] = []
afterEach(() => temporary.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))

function repository() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'fb-test-changed-'))
  temporary.push(cwd)
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const write = (file: string, text = '') => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
    writeFileSync(path.join(cwd, file), text)
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Synthetic tests')
  git('config', 'user.email', 'tests@example.invalid')
  write('core/value.ts', 'export const value = 1')
  write('core/value.test.ts', "import { value } from './value'; import {it,expect} from 'vitest'; it('value',()=>expect(value).toBe(1))")
  git('add', '.')
  git('commit', '-qm', 'synthetic baseline')
  return { cwd, git, write }
}

describe('classify', () => {
  it.each(['package.json', 'package-lock.json', 'vitest.config.ts', 'tsconfig.json',
    'tsconfig.node.json', 'tsconfig-app.json', 'src/test/setup.ts', '.oxlintrc.json', 'oxlint.config.ts'])(
    '%s forces the complete suite', file => expect(classify([file]).modo).toBe('completa'))
  it('ignores documentation, fixtures, e2e and build files', () => {
    expect(classify(['docs/a.ts', 'src/a.md', 'fixtures/a.ts', 'e2e/a.ts', 'build/a.js']).modo).toBe('nada')
    expect(classify([]).modo).toBe('nada')
  })
  it('deduplicates code and test files, within a 1 s budget for 10,000 paths', () => {
    const start = performance.now()
    const result = classify(Array.from({ length: 10_000 }, (_, i) => `core/a${i % 100}.ts`))
    expect(result.modo).toBe('relacionados')
    expect(result.arquivos).toHaveLength(100)
    expect(performance.now() - start).toBeLessThan(1000)
  })
})

describe('synthetic git repository', () => {
  it('selects related tests and falls back for code with no importers', async () => {
    const { cwd, write } = repository()
    write('core/value.ts', 'export const value = 2')
    const options = { root: cwd, config: false }
    expect(await selectTests(collectFiles(cwd), options)).toMatchObject({ modo: 'relacionados' })
    write('core/orphan.ts', 'export const orphan = 1')
    expect(await selectTests(collectFiles(cwd), options)).toMatchObject({
      modo: 'completa', motivo: 'lacuna de cobertura: core/orphan.ts',
    })
  })
  it('passes through the Vitest exit code and prints at most 15 lines', async () => {
    const { cwd } = repository()
    const lines: string[] = []
    let args: string[] = []
    const code = await main({ cwd, files: ['package.json'], log: (line: string) => lines.push(line),
      run: (_command: string, parameters: string[]) => {
        args = parameters
        return { status: 7, stdout: JSON.stringify({ numTotalTests: 2, numPassedTests: 1, numFailedTests: 1 }), stderr: 'failure\n'.repeat(30) }
      } })
    expect(code).toBe(7)
    expect(args).toContain('run')
    expect(lines.join('\n').split('\n').length).toBeLessThanOrEqual(15)
  })
  it('collects branch, staged, unstaged and untracked paths, with main fallback', () => {
    const { cwd, git, write } = repository()
    git('checkout', '-qb', 'work')
    write('core/committed.ts')
    git('add', '.')
    git('commit', '-qm', 'synthetic change')
    write('core/staged.ts')
    git('add', '.')
    write('core/value.ts', 'export const value = 2')
    write('core/space and\nnewline.ts')
    expect(collectFiles(cwd)).toEqual(['core/committed.ts', 'core/space and\nnewline.ts', 'core/staged.ts', 'core/value.ts'])
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    expect(collectFiles(cwd)).not.toContain('core/committed.ts')
  })
  it('selects nothing for a clean repository or only documentation', async () => {
    const { cwd, write } = repository()
    expect(await selectTests(collectFiles(cwd))).toMatchObject({ modo: 'nada' })
    write('docs/guide.md')
    expect(await selectTests(collectFiles(cwd))).toMatchObject({ modo: 'nada' })
    write('tsconfig.app.json', '{}')
    expect(await selectTests(collectFiles(cwd))).toMatchObject({ modo: 'completa', motivo: expect.stringContaining('tsconfig') })
  })
})
