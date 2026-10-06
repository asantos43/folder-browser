import { describe, expect, it } from 'vitest'
import { nameProblem } from './names.ts'

describe('nameProblem', () => {
  it('lets an ordinary name through, with spaces, dots, accents and many scripts', () => {
    for (const name of ['report.txt', 'My notes (final).md', '.env', 'archive.tar.gz', 'maçã.txt', '日本語.txt', 'a'.repeat(255), 'trailing.dot.', 'a:b']) expect(nameProblem(name, 'linux'), name).toBeNull()
  })
  it('refuses what is not a name, anywhere', () => {
    expect(nameProblem('', 'linux')).toBe('empty')
    expect(nameProblem('   ', 'linux')).toBe('empty')
    expect(nameProblem('.', 'linux')).toBe('dots')
    expect(nameProblem('..', 'linux')).toBe('dots')
    expect(nameProblem('a/b', 'linux')).toBe('separator')
    expect(nameProblem('a\\b', 'linux')).toBe('separator')
    expect(nameProblem('a\0b', 'linux')).toBe('control')
    expect(nameProblem('a\nb', 'linux')).toBe('control')
    expect(nameProblem('a'.repeat(256), 'linux')).toBe('too-long')
  })
  it('counts the limit in bytes, not in characters', () => {
    expect(nameProblem('é'.repeat(127), 'linux')).toBeNull()
    expect(nameProblem('é'.repeat(128), 'linux')).toBe('too-long')
  })
  it('on Windows also refuses its characters, its device names and a trailing space or dot', () => {
    expect(nameProblem('a:b', 'win32')).toBe('characters')
    expect(nameProblem('what?', 'win32')).toBe('characters')
    for (const name of ['CON', 'nul.txt', 'COM1', 'lpt9.log', 'Aux']) expect(nameProblem(name, 'win32'), name).toBe('reserved')
    expect(nameProblem('console', 'win32')).toBeNull()
    expect(nameProblem('name ', 'win32')).toBe('trailing')
    expect(nameProblem('name.', 'win32')).toBe('trailing')
  })
})
