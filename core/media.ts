import crypto from 'node:crypto'
import fs from 'node:fs'
import type { Readable } from 'node:stream'
import { parseRange } from './serve.ts'

/** A file that is being played: where it is on the disk (a file of a folder, or a copy made of an entry of a ZIP), its type and size. */
export interface MediaFile {
  file: string
  mime: string
  size: number
  /** A folder to remove when the file is let go (the copy made of an entry of a ZIP). */
  scratch?: string
}

/**
 * The files the interface is playing, by an unguessable token: `fb-media://<token>/` is the address of one, and nothing else is served. The interface never
 * names a path of the disk, and a token lives as long as the tab that asked for it.
 */
export class MediaFiles {
  private readonly open = new Map<string, MediaFile>()

  add(media: MediaFile): string {
    const token = `m${crypto.randomBytes(12).toString('hex')}`
    this.open.set(token, media)
    return token
  }
  get(token: string): MediaFile | undefined {
    return this.open.get(token)
  }
  has(token: string): boolean {
    return this.open.has(token)
  }
  /** Lets one go; what was made for it (`scratch`) is returned for the caller to remove. */
  release(token: string): MediaFile | undefined {
    const media = this.open.get(token)
    this.open.delete(token)
    return media
  }
  /** Lets all go (at quit). */
  releaseAll(): MediaFile[] {
    const all = [...this.open.values()]
    this.open.clear()
    return all
  }
}

export interface ServedFile {
  status: number
  headers: Record<string, string>
  body: Readable | null
}

/**
 * The answer to a request for a file, as a media element makes it: the whole file, or the range it asks for (`206`), with `accept-ranges` so that it can seek, and `416` for a
 * range that is not in the file. Nothing is read before the body is.
 */
export function serveFile(media: Pick<MediaFile, 'file' | 'mime' | 'size'>, range: string | null | undefined, method = 'GET'): ServedFile {
  const base = { 'content-type': media.mime, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  const wanted = range ? parseRange(range, media.size) : 'ignore'
  if (wanted === null) return { status: 416, headers: { ...base, 'content-range': `bytes */${media.size}` }, body: null }
  if (wanted === 'ignore') return { status: 200, headers: { ...base, 'content-length': String(media.size) }, body: method === 'HEAD' || media.size === 0 ? null : fs.createReadStream(media.file) }
  return {
    status: 206,
    headers: { ...base, 'content-length': String(wanted.end - wanted.start), 'content-range': `bytes ${wanted.start}-${wanted.end - 1}/${media.size}` },
    body: method === 'HEAD' ? null : fs.createReadStream(media.file, { start: wanted.start, end: wanted.end - 1 }),
  }
}
