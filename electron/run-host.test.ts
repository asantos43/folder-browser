import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMain } from 'electron'
import { RootRegistry } from '../core/roots.ts'
import { writeZip } from '../core/archive/writer.ts'
import type { RunCommand } from '../core/run.ts'
import { commandHash, resolveProgram, RunHost, startInvocation } from './run-host.ts'
vi.mock('./ui-protocol.ts', () => ({ UI_ORIGIN: 'fb-ui://host' }))

let dir: string, root: string, roots: RootRegistry, script: string, output: string, command: RunCommand, host: RunHost
const confirm = vi.fn(async () => ({ execute: true, always: true }))
const win = {} as BrowserWindow
let copies: string[]
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-run-host-'))
  const folder = path.join(dir, 'root'); await fs.mkdir(folder)
  roots = new RootRegistry(); const opened = await roots.openPath(folder); if ('error' in opened) throw new Error(opened.error); root = opened.root.id
  await fs.writeFile(path.join(folder, '-ação $(x); &.txt'), 'data')
  script = path.join(dir, 'fake.cjs'); output = path.join(dir, 'argv.json')
  await fs.writeFile(script, 'const fs=require("node:fs");fs.writeFileSync(process.argv[2],JSON.stringify({args:process.argv.slice(3),cwd:process.cwd()}))')
  command = { id: 'fake', name: 'Fake', program: process.execPath, args: [script, output, '{file}', '$(x)', '`x`', '&', ';', '|', 'a b', 'a\nb', 'ação', '-rf', '--', '~', '"quotes"'], cwd: '{dir}' }
  confirm.mockReset(); confirm.mockResolvedValue({ execute: true, always: true }); copies = []
  host = new RunHost(dir, roots, () => [command], copy => copies.push(copy), confirm)
})
afterEach(async () => { for (const copy of copies) await fs.rm(copy, { recursive: true, force: true }); await roots.close(root); await fs.rm(dir, { recursive: true, force: true }) })
const request = () => ({ commandId: 'fake', root, path: '-ação $(x); &.txt' })
async function received(): Promise<{ args: string[]; cwd: string }> {
  let data!: { args: string[]; cwd: string }
  await vi.waitFor(async () => { data = JSON.parse(await fs.readFile(output, 'utf8')) })
  return data
}
describe('main process runner', () => {
  it('does no confirmation-file I/O at construction or while obtaining cached chooser commands', () => {
    const open = vi.spyOn(fs, 'open')
    const fresh = new RunHost(dir, roots, () => [command], () => {}, confirm)
    for (let i = 0; i < 100; i++) expect(fresh.commands()[0].id).toBe('fake')
    expect(open).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled(); open.mockRestore()
  })
  it('spawns a real program without a shell and delivers hostile argv/cwd intact', async () => {
    expect(await host.run(win, request())).toEqual({ opened: true, chooser: true })
    expect(await received()).toEqual({ args: [path.join(dir, 'root', request().path), ...command.args.slice(3)], cwd: path.join(dir, 'root') })
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('does not start without confirmation, or before the native answer arrives', async () => {
    let answer!: (value: { execute: boolean; always: boolean }) => void
    confirm.mockImplementationOnce(() => new Promise<{ execute: boolean; always: boolean }>(resolve => { answer = resolve }))
    const pending = host.run(win, request()); await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(await fs.stat(output).catch(() => null)).toBeNull()
    answer({ execute: false, always: true }); expect(await pending).toMatchObject({ reason: 'cancelled' })
    expect(await fs.stat(output).catch(() => null)).toBeNull()
    expect(await fs.stat(path.join(dir, 'run-confirmed.json')).catch(() => null)).toBeNull()
  })
  it('remembers only the exact hash, persists it, and asks again after an argument changes', async () => {
    await host.run(win, request()); await received(); await fs.rm(output)
    await host.run(win, request()); await received(); expect(confirm).toHaveBeenCalledTimes(1)
    const reopened = new RunHost(dir, roots, () => [command], () => {}, confirm)
    await reopened.run(win, request()); await received(); expect(confirm).toHaveBeenCalledTimes(1)
    command = { ...command, args: [...command.args, 'changed'] }; confirm.mockResolvedValueOnce({ execute: false, always: false })
    expect(await host.run(win, request())).toMatchObject({ reason: 'cancelled' }); expect(confirm).toHaveBeenCalledTimes(2)
    const stored = JSON.parse(await fs.readFile(path.join(dir, 'run-confirmed.json'), 'utf8'))
    expect(stored[0][1]).toMatch(/^[a-f0-9]{64}$/); expect(stored[0][1]).not.toBe(commandHash(command))
    expect(commandHash(command)).not.toBe(commandHash({ ...command, cwd: dir }))
    expect(commandHash(command)).not.toBe(commandHash({ ...command, program: '/different/program' }))
  })
  it('asks every time when Always is unchecked and refuses edits during confirmation', async () => {
    confirm.mockResolvedValue({ execute: true, always: false })
    await host.run(win, request()); await received(); await host.run(win, request()); await received(); expect(confirm).toHaveBeenCalledTimes(2)
    confirm.mockImplementationOnce(async () => { command = { ...command, args: ['changed'] }; return { execute: true, always: true } })
    expect(await host.run(win, request())).toMatchObject({ reason: 'error', message: 'Command changed; try again' })
  })
  it('refuses renderer executables, unknown ids, absolute paths, dot segments and escaping symlinks', async () => {
    await fs.writeFile(path.join(dir, 'outside.txt'), 'outside')
    await fs.symlink(path.join(dir, 'outside.txt'), path.join(dir, 'root', 'link.txt'))
    for (const bad of [{ ...request(), program: process.execPath, args: [] }, { ...request(), commandId: 'unknown' }, { ...request(), root: 'unknown' }, { ...request(), path: path.join(dir, 'outside.txt') }, { ...request(), path: '../outside.txt' }, { ...request(), path: 'sub/../outside.txt' }, { ...request(), path: 'link.txt' }]) expect(await host.run(win, bad)).toMatchObject({ opened: false })
    expect(confirm).not.toHaveBeenCalled(); expect(await fs.stat(output).catch(() => null)).toBeNull()
  })
  it('restricts fb:run-command to the real interface top frame and only one request', async () => {
    const frame = { url: 'fb-ui://host/index.html' }, sender = { mainFrame: frame }
    const window = { webContents: sender } as unknown as BrowserWindow
    let handler!: (...args: any[]) => any
    host.register({ handle: (_channel, cb) => { handler = cb } } as Pick<IpcMain, 'handle'>, () => window)
    for (const event of [{ sender, senderFrame: { url: frame.url } }, { sender: {}, senderFrame: frame }, { sender, senderFrame: { url: 'https://evil.example/' } }]) expect(await handler(event, request())).toMatchObject({ message: 'refused' })
    expect(await handler({ sender, senderFrame: frame }, request(), 'extra')).toMatchObject({ message: 'refused' })
    expect(confirm).not.toHaveBeenCalled()
    expect(await handler({ sender, senderFrame: frame }, request())).toMatchObject({ opened: true }); await received()
  })
  it('hands a ZIP entry to the actual child as a readonly copy and refuses executable entries', async () => {
    const zip = path.join(dir, 'root', 'pack.zip'); await writeZip(zip, [{ name: 'a file.txt', data: 'zip-data' }, { name: 'bad.sh', data: 'echo bad' }])
    expect(await host.run(win, { ...request(), path: 'pack.zip!/a file.txt' })).toMatchObject({ opened: true })
    const data = await received(); expect(await fs.readFile(data.args[0], 'utf8')).toBe('zip-data')
    expect((await fs.stat(data.args[0])).mode & 0o777).toBe(0o400); expect(copies).toHaveLength(1)
    expect(await host.run(win, { ...request(), path: 'pack.zip!/bad.sh' })).toMatchObject({ opened: false })
  })
  it('fails closed on oversized/corrupt confirmation files and launch errors', async () => {
    await fs.writeFile(path.join(dir, 'run-confirmed.json'), ' '.repeat(32 * 1024 + 1))
    confirm.mockResolvedValue({ execute: false, always: false })
    expect(await host.run(win, request())).toMatchObject({ reason: 'cancelled' })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(await startInvocation({ program: '/nonexistent/fb-program', args: [] })).toMatchObject({ opened: false, reason: 'error', message: expect.any(String) })
    expect(await startInvocation({ program: script, args: [] })).toMatchObject({ opened: false, reason: 'error' })
  })
  it('searches bare names only in absolute PATH directories, never cwd', async () => {
    await expect(resolveProgram('fake.cjs', { PATH: `.:${dir}` })).rejects.toThrow(/PATH/)
    if (process.platform !== 'win32') { await fs.symlink(process.execPath, path.join(dir, 'fake-node')); expect(await resolveProgram('fake-node', { PATH: `.:${dir}` })).toBe(path.join(dir, 'fake-node')) }
  })
  it.skipIf(process.platform === 'win32')('never resolves a bare name through a relative or empty PATH entry, even when an executable is there', async () => {
    await fs.symlink(process.execPath, path.join(dir, 'local-prog'))
    const relative = path.relative(process.cwd(), dir)
    await expect(resolveProgram('local-prog', { PATH: relative })).rejects.toThrow(/PATH/)
    await expect(resolveProgram('local-prog', { PATH: `:${relative}:` })).rejects.toThrow(/PATH/)
    expect(await resolveProgram('local-prog', { PATH: dir })).toBe(path.join(dir, 'local-prog'))
  })
  it('kills the direct child only when a timeout is declared', async () => {
    const slow = path.join(dir, 'slow.cjs')
    await fs.writeFile(slow, 'setTimeout(()=>require("node:fs").writeFileSync(process.argv[2],"done"),150)')
    expect(await startInvocation({ program: process.execPath, args: [slow, output] }, 20)).toMatchObject({ opened: true })
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(await fs.stat(output).catch(() => null)).toBeNull()
    expect(await startInvocation({ program: process.execPath, args: [slow, output] })).toMatchObject({ opened: true })
    await vi.waitFor(async () => expect(await fs.readFile(output, 'utf8')).toBe('done'))
  })
})
