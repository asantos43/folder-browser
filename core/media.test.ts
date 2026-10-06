import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mediaKind } from './filekind.ts'
import { MediaFiles, serveFile } from './media.ts'

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-media-'))
  file = path.join(dir, 'sound.wav')
  fs.writeFileSync(file, '0123456789')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
const media = () => ({ file, mime: 'audio/wav', size: 10 })
/** The answer, with its body let go unread (a stream nobody reads would open its file after the test removed it). */
const unread = (r: ReturnType<typeof serveFile>) => (r.body?.on('error', () => undefined), r.body?.destroy(), r)
const text = async (r: ReturnType<typeof serveFile>) => {
  if (!r.body) return ''
  const chunks: Buffer[] = []
  for await (const c of r.body) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

describe('mediaKind', () => {
  it('tells a video from a sound by its name or its type, and nothing else', () => {
    for (const name of ['a.mp4', 'a.WEBM', 'a.mkv', 'a.mov', 'a.m4v', 'a.ogv']) expect(mediaKind(undefined, name), name).toBe('video')
    for (const name of ['a.mp3', 'a.flac', 'a.WAV', 'a.m4a', 'a.opus', 'a.oga', 'a.aac']) expect(mediaKind(undefined, name), name).toBe('audio')
    expect(mediaKind('video/mp4', 'noextension')).toBe('video')
    expect(mediaKind('audio/ogg', 'x')).toBe('audio')
    for (const name of ['a.txt', 'a.png', 'a.zip', 'a.pdf', 'a', 'a.mp3.txt']) expect(mediaKind(undefined, name), name).toBeNull()
    expect(mediaKind('application/octet-stream', 'a.bin')).toBeNull()
  })
})

describe('serveFile', () => {
  it('answers the whole file, saying that it can be read by ranges', async () => {
    const r = serveFile(media(), null)
    expect(r.status).toBe(200)
    expect(r.headers).toMatchObject({ 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': '10' })
    expect(await text(r)).toBe('0123456789')
  })
  it('answers a range with 206, its place in the file and only its bytes: from, to the end, and the last ones', async () => {
    const r = serveFile(media(), 'bytes=2-4')
    expect(r.status).toBe(206)
    expect(r.headers).toMatchObject({ 'content-range': 'bytes 2-4/10', 'content-length': '3' })
    expect(await text(r)).toBe('234')
    expect(await text(serveFile(media(), 'bytes=7-'))).toBe('789')
    expect(await text(serveFile(media(), 'bytes=-2'))).toBe('89')
    expect(await text(serveFile(media(), 'bytes=8-99'))).toBe('89')
  })
  it('refuses a range that is not in the file, and takes what is not a range for no range', async () => {
    const r = serveFile(media(), 'bytes=10-')
    expect(r.status).toBe(416)
    expect(r.headers['content-range']).toBe('bytes */10')
    expect(r.body).toBeNull()
    expect(unread(serveFile(media(), 'bytes=0-1,4-5')).status).toBe(200)
    expect(unread(serveFile(media(), 'items=0-1')).status).toBe(200)
  })
  it('sends no body to a HEAD, and none for an empty file', () => {
    expect(serveFile(media(), null, 'HEAD').body).toBeNull()
    expect(serveFile(media(), 'bytes=1-2', 'HEAD')).toMatchObject({ status: 206, body: null })
    expect(serveFile({ ...media(), size: 0 }, null).body).toBeNull()
  })
})

describe('MediaFiles', () => {
  it('gives a token for a file, serves only what it gave, and lets go', () => {
    const files = new MediaFiles()
    const token = files.add({ ...media(), scratch: '/tmp/x' })
    expect(token).toMatch(/^m[0-9a-f]{24}$/)
    expect(files.add(media())).not.toBe(token)
    expect(files.has(token)).toBe(true)
    expect(files.get(token)?.file).toBe(file)
    expect(files.has('mabc')).toBe(false)
    expect(files.release(token)?.scratch).toBe('/tmp/x')
    expect(files.has(token)).toBe(false)
    expect(files.release(token)).toBeUndefined()
    expect(files.releaseAll()).toHaveLength(1)
    expect(files.releaseAll()).toEqual([])
  })
})
