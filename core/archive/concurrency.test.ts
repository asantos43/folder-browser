import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PNG_1X1, writePageKeepZip, writeSampleWsnp } from '../../fixtures/build.ts'
import { openArchive, type Archive } from './reader.ts'
import { writeZip } from './writer.ts'

let dir: string
let archive: Archive
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-concurrent-'))
  await writeSampleWsnp(path.join(dir, 'a.wsnp'))
  archive = await openArchive(path.join(dir, 'a.wsnp'))
})
afterAll(async () => {
  await archive.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const bytesOf = async (stream: AsyncIterable<Buffer>) => Buffer.concat(await Array.fromAsync(stream))

it('serves the same small stored entry to many readers at once, all complete', async () => {
  const streams = await Promise.all(Array.from({ length: 300 }, () => archive.stream('assets/images/logo.png')))
  const results = await Promise.all(streams.map(bytesOf))
  expect(results.filter((b) => Buffer.compare(b, PNG_1X1) !== 0)).toHaveLength(0)
})

it('serves many different entries at once, each exact', async () => {
  const names = archive.entries.map((e) => e.name)
  const expected = new Map(await Promise.all(names.map(async (n) => [n, await archive.read(n)] as const)))
  const runs = Array.from({ length: 200 }, (_, i) => names[i % names.length])
  const got = await Promise.all(runs.map(async (n) => [n, await bytesOf(await archive.stream(n))] as const))
  expect(got.filter(([n, b]) => Buffer.compare(b, expected.get(n)!) !== 0).map(([n]) => n)).toEqual([])
})

it('reads a PageKeep-style zip the same way', async () => {
  await writePageKeepZip(path.join(dir, 'p.zip'))
  const zip = await openArchive(path.join(dir, 'p.zip'))
  const streams = await Promise.all(Array.from({ length: 300 }, () => zip.stream('assets/logo-1qg48nw.png')))
  expect((await Promise.all(streams.map(bytesOf))).filter((b) => Buffer.compare(b, PNG_1X1) !== 0)).toHaveLength(0)
  await zip.close()
})

// A browser cancels requests it no longer needs (an <audio> or <video> reading its header, then
// seeking): the entry's stream is destroyed in the middle of a read, while other entries read
// through the same file. yauzl must never be left with a queued read on a stream it has already
// cleaned up (it crashed the main process: "Cannot read properties of null (reading 'fd')").
it('survives streams cancelled in the middle of a read, as a browser cancels media requests', async () => {
  const big = (seed: number) => Buffer.from(Array.from({ length: 3_000_000 }, (_, i) => (i * seed) & 0xff))
  const file = path.join(dir, 'media.zip')
  await writeZip(file, [
    { name: 'a.wav', data: big(7) },
    { name: 'b.wav', data: big(13) },
    { name: 'c.css', data: 'body{color:red}'.repeat(20_000), compress: true },
  ])
  const zip = await openArchive(file)
  const uncaught: unknown[] = []
  const onUncaught = (err: unknown) => uncaught.push(err)
  process.on('uncaughtException', onUncaught)
  try {
    for (let round = 0; round < 20; round++) {
      const streams = await Promise.all([
        zip.stream('a.wav'), zip.stream('b.wav'), zip.stream('c.css'),
        zip.stream('a.wav', { start: 1000, end: 2_000_000 }), zip.stream('b.wav', { start: 0, end: 3_000_000 }),
      ])
      // Each read a little, then cancelled the way the protocol handler's web stream is.
      await Promise.all(streams.map(async (s, k) => {
        const web = Readable.toWeb(s) as ReadableStream<Uint8Array>
        const reader = web.getReader()
        await reader.read()
        if (k % 2) await reader.read()
        await reader.cancel()
      }))
    }
    await new Promise((resolve) => setTimeout(resolve, 300)) // the reads still queued run now
    expect(uncaught).toEqual([])
    // And the archive still reads whole entries afterwards.
    expect(Buffer.compare(await bytesOf(await zip.stream('a.wav')), big(7))).toBe(0)
  } finally {
    process.off('uncaughtException', onUncaught)
    await zip.close()
  }
})
