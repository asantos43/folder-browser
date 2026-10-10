import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildInvocation, normalizeCommands, parseCommandTemplate } from './run.ts'

const hostile = ['"quotes"', "'quotes'", '$(x)', '`x`', '&', ';', '|', 'a b', 'a\nb', 'ação', '-rf', '--', '/a path/~name', '~']
const context = { file: '/tmp/-a file ação.txt', dir: '/tmp', name: '-a file ação.txt' }
const command = { id: 'test', name: 'Test', program: 'node', args: hostile }
describe('literal command templates', () => {
  it('delivers each hostile value and expanded file as one exact argv value to a real program', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-run-core-'))
    try {
      const script = path.join(dir, 'record.cjs'), output = path.join(dir, 'out.json')
      await fs.writeFile(script, 'require("node:fs").writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))')
      const invocation = buildInvocation(parseCommandTemplate({ ...command, program: process.execPath, args: [script, output, ...hostile, '{file}', '--file={file}', '{name}'] }), context)
      await new Promise<void>((resolve, reject) => { const child = spawn(invocation.program, invocation.args, { shell: false, stdio: 'ignore' }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`))) })
      expect(JSON.parse(await fs.readFile(output, 'utf8'))).toEqual([...hostile, context.file, `--file=${context.file}`, context.name])
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
  it('expands once, preserving empty arguments and literal leading options; requires absolute file paths', () => {
    expect(buildInvocation({ ...command, args: ['', '{file}', '{dir}', '{name}', '-rf', '--'] }, { ...context, name: '{file}' }).args).toEqual(['', context.file, '/tmp', '{file}', '-rf', '--'])
    expect(() => buildInvocation(command, { ...context, file: '-rf' })).toThrow(/absolute/)
  })
  it('rejects relative executable paths, malformed commands and every size boundary', () => {
    for (const program of ['', '\0', './node', '../node', 'folder/node', 'folder\\node', '~node', '.', '..', 'C:node']) expect(() => parseCommandTemplate({ ...command, program })).toThrow()
    for (const program of ['node', '/opt/my node', 'C:\\Tools\\node.exe', 'sh', 'cmd']) expect(parseCommandTemplate({ ...command, program }).program).toBe(program)
    for (const args of ['one two', Array(65).fill('a'), ['a'.repeat(4097)], ['é'.repeat(2049)], ['\0']]) expect(() => parseCommandTemplate({ ...command, args })).toThrow()
    expect(parseCommandTemplate({ ...command, args: Array(64).fill('a'.repeat(4096)) }).args).toHaveLength(64)
    for (const timeoutMs of [0, -1, 1.5, Infinity, 2_147_483_648]) expect(() => parseCommandTemplate({ ...command, timeoutMs })).toThrow()
    expect(() => parseCommandTemplate({ ...command, cwd: '.' })).toThrow()
    expect(() => buildInvocation({ ...command, args: ['{name}{name}'] }, { ...context, name: 'a'.repeat(2049) })).toThrow(/4 KB/)
    expect(() => buildInvocation({ ...command, args: ['{name}'] }, { ...context, name: '\0' })).toThrow()
    const commands = Array.from({ length: 101 }, (_, i) => ({ ...command, id: `c-${i}` }))
    expect(normalizeCommands(commands).value).toHaveLength(100)
    expect(normalizeCommands(commands).warning).toBeTruthy()
    expect(normalizeCommands([command, command, { ...command, program: './bad' }])).toMatchObject({ value: [command], warning: expect.any(String) })
  })
  it('expands 100 commands × 64 arguments in a median below 10 ms (20 samples)', () => {
    const commands = Array.from({ length: 100 }, (_, i) => parseCommandTemplate({ ...command, id: `c-${i}`, args: Array(64).fill('--file={file}') }))
    const samples: number[] = []
    for (let i = 0; i < 20; i++) { const start = performance.now(); for (const command of commands) buildInvocation(command, context); samples.push(performance.now() - start) }
    samples.sort((a, b) => a - b)
    const median = (samples[9] + samples[10]) / 2
    console.log(`run expansion median: ${median.toFixed(3)} ms`)
    expect(median).toBeLessThan(10)
  })
})
