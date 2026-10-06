import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FavoriteFolders } from './favorites.ts'
import { knownPlaces, placeOf, volumesOf } from './places.ts'

describe('knownPlaces', () => {
  it('lists the places in the order of a file manager, and leaves out what is not there or repeats another', async () => {
    const there = new Set(['/home/me', '/home/me/Documents', '/home/me/Downloads', '/home/me/.local/share/Trash/files', '/'])
    const places = await knownPlaces(
      { home: '/home/me', desktop: '/home/me', documents: '/home/me/Documents', downloads: '/home/me/Downloads', music: '/home/me/Music', trash: '/home/me/.local/share/Trash/files', computer: '/' },
      async (f) => there.has(f),
    )
    expect(places.map((p) => [p.kind, p.path])).toEqual([['home', '/home/me'], ['documents', '/home/me/Documents'], ['downloads', '/home/me/Downloads'], ['trash', '/home/me/.local/share/Trash/files'], ['computer', '/']])
    expect(places[0]).toMatchObject({ id: 'home:/home/me', name: 'home' })
  })
  it('is empty when nothing is known', async () => expect(await knownPlaces({}, async () => true)).toEqual([]))
})

describe('volumesOf', () => {
  const tree: Record<string, string[]> = { '/run/media/me': ['USB STICK', 'Backup', '.hidden'], '/media': ['me', 'cdrom'], '/mnt': ['data'], '/Volumes': ['Macintosh HD', 'Photos'] }
  const list = async (f: string) => tree[f] ?? Promise.reject(new Error('ENOENT'))
  const exists = async () => true
  it('finds what Linux mounts for the user, in /media and in /mnt, and skips /media/<user> itself and hidden names', async () => {
    const volumes = await volumesOf('linux', 'me', list, exists)
    expect(volumes.map((v) => v.path)).toEqual(['/run/media/me/Backup', '/run/media/me/USB STICK', '/media/cdrom', '/mnt/data'])
    expect(volumes[1]).toMatchObject({ kind: 'volume', name: 'USB STICK' })
  })
  it('finds what macOS mounts, but not the disk the system is on', async () => {
    expect((await volumesOf('darwin', 'me', list, exists)).map((v) => v.name)).toEqual(['Photos'])
  })
  it('finds the drives of Windows that answer', async () => {
    const volumes = await volumesOf('win32', 'me', list, async (f) => f === 'C:\\' || f === 'E:\\')
    expect(volumes.map((v) => v.path)).toEqual(['C:\\', 'E:\\'])
    expect(volumes[0].name).toBe('C:')
  })
  it('is empty when there is nowhere to look', async () => expect(await volumesOf('linux', 'me', async () => Promise.reject(new Error('x')), exists)).toEqual([]))
})

describe('placeOf', () => {
  it('names a folder by its own name, or by its path when it has none', () => {
    expect(placeOf('favorite', '/home/me/work')).toMatchObject({ name: 'work', id: 'favorite:/home/me/work' })
    expect(placeOf('favorite', '/').name).toBe('/')
  })
})

describe('FavoriteFolders', () => {
  let dir: string
  beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-fav-'))))
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = () => path.join(dir, 'p', 'favorites.json')

  it('pins in order, once, and keeps them for the next time', () => {
    const f = new FavoriteFolders(file())
    expect(f.add('/a')).toBe(true)
    f.add('/b')
    f.add('/a')
    expect(f.list()).toEqual(['/a', '/b'])
    expect(new FavoriteFolders(file()).list()).toEqual(['/a', '/b'])
    expect(f.has('/b')).toBe(true)
  })
  it('removes, moves, and stops at the most it keeps', () => {
    const f = new FavoriteFolders(file(), 3)
    for (const p of ['/a', '/b', '/c']) f.add(p)
    expect(f.add('/d')).toBe(false)
    f.move('/c', 0)
    expect(f.list()).toEqual(['/c', '/a', '/b'])
    f.move('/c', 99)
    expect(f.list()).toEqual(['/a', '/b', '/c'])
    f.remove('/b')
    expect(new FavoriteFolders(file()).list()).toEqual(['/a', '/c'])
    f.move('/none', 0)
  })
  it('starts empty from a file that is missing or is not a list, and drops what is not a path', () => {
    expect(new FavoriteFolders(file()).list()).toEqual([])
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), '{"a":1}')
    expect(new FavoriteFolders(file()).list()).toEqual([])
    fs.writeFileSync(file(), JSON.stringify(['/ok', 3, null, '/also']))
    expect(new FavoriteFolders(file()).list()).toEqual(['/ok', '/also'])
  })
})
