import { describe, expect, it } from 'vitest'
import { DETECT_THRESHOLD, detectLanguage } from './detectLanguage.ts'

const lang = (text: string) => detectLanguage(text)?.language ?? null

describe('detectLanguage', () => {
  it('knows a whole HTML page and a fragment without <html>', () => {
    expect(lang('<!DOCTYPE html>\n<html><head><title>x</title></head><body><p>hi</p></body></html>')).toBe('html')
    expect(lang('<div class="a">\n  <ul><li>one</li><li>two</li></ul>\n  <p>text</p>\n</div>')).toBe('html')
    expect(detectLanguage('<div><p>a</p><span>b</span></div>')!.confidence).toBeGreaterThanOrEqual(DETECT_THRESHOLD)
  })

  it('a lone tag or an unknown tag is not HTML', () => {
    expect(lang('<p>one tag</p>')).toBeNull()
    expect(lang('<foo><bar>x</bar><baz/></foo>')).toBeNull()
  })

  it('knows XML and SVG by their start', () => {
    expect(lang('<?xml version="1.0"?>\n<root><a/></root>')).toBe('xml')
    expect(lang('  <svg xmlns="http://www.w3.org/2000/svg" width="10"></svg>')).toBe('xml')
  })

  it('knows JSON: an object, an array, and JSON lines', () => {
    expect(lang('{"a": 1, "b": [1, 2, 3]}')).toBe('json')
    expect(lang('[\n  {"a": 1},\n  {"a": 2}\n]')).toBe('json')
    expect(lang('{"a":1}\n{"a":2}\n{"a":3}\n')).toBe('json')
  })

  it('a JavaScript object literal and a broken JSON are not JSON', () => {
    expect(lang('{ a: 1 }')).toBeNull()
    expect(lang('{"a": 1,')).toBeNull()
    expect(lang('[1, 2,')).toBeNull()
  })

  it('knows a script by its shebang', () => {
    expect(lang('#!/usr/bin/env bash\necho hi\n')).toBe('shell')
    expect(lang('#!/bin/sh\nls\n')).toBe('shell')
    expect(lang('#!/usr/bin/python3\nprint(1)\n')).toBe('python')
    expect(lang('#!/usr/bin/env node\nconsole.log(1)\n')).toBe('javascript')
    expect(lang('#!/usr/bin/perl\nprint 1;\n')).toBeNull()
  })

  it('knows a Dockerfile by its FROM', () => {
    expect(lang('# build\nFROM node:22\nRUN npm ci\n')).toBe('dockerfile')
    expect(lang('from the beginning, the story was long')).toBeNull()
  })

  it('knows Markdown, and not a text with a few #', () => {
    expect(lang('# Title\n\nSome text.\n\n- one\n- two\n\n```js\nx\n```\n')).toBe('markdown')
    expect(lang('# not really\nbut then plain words\n# again\nand more words\n')).toBeNull()
  })

  it('knows YAML, and not prose with colons', () => {
    expect(lang('name: app\nversion: 1\nitems:\n  - a\n  - b\n')).toBe('yaml')
    expect(lang('---\nfoo: 1\nbar: 2\n')).toBe('yaml')
    expect(lang('apiVersion: v1\nkind: Pod\nmetadata:\n  name: x\n')).toBe('yaml')
    expect(lang('Note: this is only a sentence.\nAnother: sentence that ends here.\n')).toBeNull()
  })

  it('plain prose, an empty text and only spaces say nothing', () => {
    expect(lang('Just some words that a person pasted here.\nSecond line, still prose.')).toBeNull()
    expect(lang('')).toBeNull()
    expect(lang('   \n\t\n  ')).toBeNull()
  })

  it('reads only the start: 50 MiB are analysed in a few milliseconds', () => {
    const prose = 'a'.repeat(50 * 2 ** 20)
    const jsonLines = '{"a":1}\n'.repeat(6 * 2 ** 20)
    for (const text of [prose, jsonLines, '<div><p>a</p><span>b</span></div>' + 'x'.repeat(50 * 2 ** 20)]) {
      const start = performance.now()
      detectLanguage(text)
      expect(performance.now() - start).toBeLessThan(50)
    }
  })

  it('a long JSON cut at the limit is still JSON, and a long list of words is not', () => {
    const big = '{\n' + '  "key": "value",\n'.repeat(10000) + '  "last": 1\n}\n'
    expect(big.length).toBeGreaterThan(65536)
    expect(lang(big)).toBe('json')
    expect(lang('word '.repeat(40000))).toBeNull()
  })
})
