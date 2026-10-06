import { describe, expect, it } from 'vitest'
import { comparable, decodeSide, lineEndingOf } from './diff.ts'
import { TEXT_LIMIT } from './filekind.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('comparable', () => {
  it('is a text, or a file of no known type, up to the limit', () => {
    expect(comparable('notes.txt', 100)).toBe(true)
    expect(comparable('main.ts', 100)).toBe(true)
    expect(comparable('data.csv', 100)).toBe(true)
    expect(comparable('Makefile.unknownext', 100)).toBe(true)
    expect(comparable('notes.txt', TEXT_LIMIT)).toBe(true)
    expect(comparable('notes.txt', TEXT_LIMIT + 1)).toBe(false)
  })
  it('is not a picture, a PDF, a program, a sound or a ZIP', () => {
    for (const name of ['a.png', 'a.pdf', 'a.exe', 'a.mp3', 'a.zip', 'a.docx']) expect(comparable(name, 10)).toBe(false)
  })
  it('is not a log over the limit (a tab opens one up to 32 MiB; a diff does not)', () => {
    expect(comparable('server.log', TEXT_LIMIT + 1)).toBe(false)
  })
})

describe('lineEndingOf', () => {
  it('is the first ending the text has', () => {
    expect(lineEndingOf('a\nb\r\n')).toBe('lf')
    expect(lineEndingOf('a\r\nb\n')).toBe('crlf')
    expect(lineEndingOf('a\rb')).toBe('cr')
    expect(lineEndingOf('no ending')).toBe('lf')
    expect(lineEndingOf('')).toBe('lf')
  })
})

describe('decodeSide', () => {
  it('reads UTF-8 and puts \\n for every line ending, saying which one the file has', () => {
    expect(decodeSide(bytes('a\r\nb\r\nc'))).toEqual({ ok: true, text: 'a\nb\nc', eol: 'crlf' })
    expect(decodeSide(bytes('a\rb'))).toEqual({ ok: true, text: 'a\nb', eol: 'cr' })
    expect(decodeSide(bytes('café\n'))).toEqual({ ok: true, text: 'café\n', eol: 'lf' })
  })
  it('drops a byte order mark', () => {
    expect(decodeSide(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('hi')]))).toEqual({ ok: true, text: 'hi', eol: 'lf' })
  })
  it('refuses bytes (a NUL), other encodings and what is too big, and says why', () => {
    expect(decodeSide(new Uint8Array([104, 0, 105]))).toEqual({ ok: false, error: 'not-text' })
    expect(decodeSide(new Uint8Array([0x68, 0xe9, 0x6c]))).toEqual({ ok: false, error: 'not-utf8' })
    expect(decodeSide(new Uint8Array(TEXT_LIMIT + 1).fill(97))).toEqual({ ok: false, error: 'too-large' })
  })
})
