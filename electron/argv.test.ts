import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pathsToOpen, userArgs } from './argv.ts'

describe('pathsToOpen', () => {
  const cwd = path.resolve('/work')
  const nothing = () => false
  it('takes the .wsnp and .zip files of a command line, in any case, and makes them absolute', () => {
    expect(pathsToOpen(['a.wsnp', path.resolve('/x/B.WSNP'), '--no-sandbox', '--user-data-dir=/tmp/p.wsnp', 'notes.txt', 'c.wsnpx', 'old/page.zip'], cwd, nothing)).toEqual([path.resolve('/work/a.wsnp'), path.resolve('/x/B.WSNP'), path.resolve('/work/old/page.zip')])
  })
  it('takes any other path that is there: a folder, or a file of one', () => {
    const there = new Set([path.resolve('/work/docs'), path.resolve('/work/notes.txt')])
    expect(pathsToOpen(['docs', 'notes.txt', 'missing.txt'], cwd, (f) => there.has(f))).toEqual([path.resolve('/work/docs'), path.resolve('/work/notes.txt')])
  })
  it('is empty when nothing is named', () => expect(pathsToOpen([], '/work', nothing)).toEqual([]))
})

describe('userArgs', () => {
  it('skips the program, and the app\'s folder when the app is not packaged', () => {
    expect(userArgs(['/usr/bin/folder-browser', '/home/me/docs'], true)).toEqual(['/home/me/docs'])
    expect(userArgs(['electron', '.', '/home/me/docs'], false)).toEqual(['/home/me/docs'])
  })
})
