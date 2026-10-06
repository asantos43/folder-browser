import { describe, expect, it } from 'vitest'
import { canProbe, DOCUMENT_LIMIT, effectiveType, FORMATTABLE, isSvg, languageOf, looksLikeText, LOG_LIMIT, TEXT_LIMIT, viewKind, ZIP_LIMIT } from './filekind.ts'

describe('viewKind: which files a tab can show', () => {
  it('shows source, pictures, PDFs and fonts', () => {
    expect(viewKind('application/pdf', 'a.pdf', 100)).toBe('pdf')
    expect(viewKind('application/octet-stream', 'A.PDF', 100)).toBe('pdf')
    expect(viewKind('text/html', 'index.html', 100)).toBe('text')
    expect(viewKind('text/css', 'a.css', 100)).toBe('text')
    expect(viewKind('text/javascript', 'a.js', 100)).toBe('text')
    expect(viewKind('application/json', 'manifest.json', 100)).toBe('text')
    expect(viewKind('application/ld+json', 'a', 100)).toBe('text')
    expect(viewKind('image/svg+xml', 'a.svg', 100)).toBe('text')
    expect(viewKind('image/png', 'a.png', 100)).toBe('image')
    expect(viewKind('image/webp', 'a.webp', 100)).toBe('image')
    expect(viewKind('font/woff2', 'a.woff2', 100)).toBe('font')
  })
  it('offers to save audio, video and unknown types, and a PDF too large to read into the interface', () => {
    expect(viewKind('application/pdf', 'big.pdf', 64 * 2 ** 20 + 1)).toBe('other')
    for (const [type, name] of [['audio/mpeg', 'a.mp3'], ['video/mp4', 'a.mp4'], ['application/x-unknown', 'a.bin']] as const) {
      expect(viewKind(type, name, 100), name).toBe('other')
    }
  })
  it('opens a log as text up to a larger size than other text (logs are big), and no larger', () => {
    expect(viewKind(undefined, 'server.log', TEXT_LIMIT + 1)).toBe('text')
    expect(viewKind('text/plain', 'app.LOG', LOG_LIMIT)).toBe('text')
    expect(viewKind(undefined, 'server.log', LOG_LIMIT + 1)).toBe('other')
    expect(viewKind(undefined, 'notes.txt', TEXT_LIMIT + 1)).toBe('other')
  })
  it('draws office documents, by their type or their extension, unless they are too big to read into a page', () => {
    for (const name of ['a.docx', 'b.PPTX', 'c.odt', 'd.ods', 'e.xlsx', 'f.xls', 'g.doc', 'h.ppt', 'i.odp']) expect(viewKind('application/octet-stream', name, 100), name).toBe('document')
    expect(viewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'blob', 100)).toBe('document')
    expect(viewKind(undefined, 'a.docx', DOCUMENT_LIMIT)).toBe('document')
    expect(viewKind(undefined, 'a.docx', DOCUMENT_LIMIT + 1)).toBe('other')
    // Not because of a name alone: a file called `doc` is looked at.
    expect(viewKind(undefined, 'doc', 100)).toBe('other')
    expect(canProbe(undefined, 'doc', 100)).toBe(true)
  })
  it('shows programs, libraries and the like in hexadecimal, by their extension, whatever the size', () => {
    for (const name of ['setup.exe', 'lib.DLL', 'libc.so', 'a.out.o', 'Main.class', 'disk.iso', 'x.bin', 'data.dat', 'app.wasm', 'a.sqlite']) {
      expect(viewKind('application/octet-stream', name, 100), name).toBe('hex')
      expect(viewKind(undefined, name, 10 * 2 ** 30), name).toBe('hex')
    }
  })
  it('does not take a file for a binary because of a name alone: only after a dot (a script called `bin`, a file called `a`)', () => {
    for (const name of ['bin', 'a', 'o', 'lib', 'dat', 'db']) {
      expect(viewKind(undefined, name, 100), name).toBe('other')
      expect(canProbe(undefined, name, 100), name).toBe(true)
    }
  })
  it('lists a ZIP in a tab, by its type or its extension, unless it is too big to hold in memory', () => {
    expect(viewKind('application/zip', 'a.zip', 100)).toBe('zip')
    expect(viewKind('application/x-zip-compressed', 'a.zip', 100)).toBe('zip')
    expect(viewKind('application/octet-stream', 'bundle.ZIP', 100)).toBe('zip')
    expect(viewKind('application/zip', 'a.zip', ZIP_LIMIT + 1)).toBe('other')
  })
  it('knows an SVG by its type or, when the type says nothing, its extension: it is source and a picture', () => {
    expect(isSvg('image/svg+xml', 'a.svg')).toBe(true)
    expect(isSvg('application/octet-stream', 'logo.SVG')).toBe(true)
    expect(isSvg(undefined, 'a.svg')).toBe(true)
    expect(isSvg('image/png', 'a.svg')).toBe(false)
    expect(isSvg('text/xml', 'a.xml')).toBe(false)
    expect(viewKind('image/svg+xml', 'a.svg', 100)).toBe('text')
  })
  it('uses the extension when the type says nothing', () => {
    expect(viewKind('application/octet-stream', 'photo.JPG', 100)).toBe('image')
    expect(viewKind(undefined, 'style.css', 100)).toBe('text')
    expect(viewKind('', 'file.pdf', 100)).toBe('pdf')
    expect(effectiveType('text/html; charset=utf-8', 'x')).toBe('text/html')
  })
  it('does not open a text file over the limit: it is saved instead', () => {
    expect(viewKind('text/plain', 'big.txt', TEXT_LIMIT)).toBe('text')
    expect(viewKind('text/plain', 'big.txt', TEXT_LIMIT + 1)).toBe('other')
  })
  it('picks the language for the colours', () => {
    expect(languageOf('text/html', 'a')).toBe('html')
    expect(languageOf('text/css', 'a')).toBe('css')
    expect(languageOf('text/javascript', 'a')).toBe('javascript')
    expect(languageOf('application/json', 'a')).toBe('json')
    expect(languageOf('image/svg+xml', 'a')).toBe('xml')
    expect(languageOf('text/plain', 'a')).toBe('plain')
  })
  it('knows more languages by the name when the type says nothing: Markdown, YAML, TypeScript, JSX, source maps, manifests', () => {
    expect(languageOf('text/plain', 'README.md')).toBe('markdown')
    expect(languageOf('application/octet-stream', 'config.yml')).toBe('yaml')
    expect(languageOf(undefined, 'app.yaml')).toBe('yaml')
    expect(languageOf('text/plain', 'app.ts')).toBe('typescript')
    expect(languageOf('text/plain', 'App.tsx')).toBe('tsx')
    expect(languageOf('text/plain', 'App.jsx')).toBe('jsx')
    expect(languageOf('application/octet-stream', 'app.js.map')).toBe('json')
    expect(languageOf('text/plain', 'site.webmanifest')).toBe('json')
    expect(languageOf('text/plain', 'notes.txt')).toBe('plain')
    expect(languageOf('text/plain', 'feed.rss')).toBe('xml')
  })
  it('trusts a declared type that says something over the name', () => {
    expect(languageOf('text/css', 'style.txt')).toBe('css')
    expect(languageOf('application/json', 'data.md')).toBe('json')
    expect(effectiveType('text/plain', 'a.unknownext')).toBe('text/plain')
  })
  it('says which languages a formatter can lay out again', () => {
    expect([...FORMATTABLE].sort()).toEqual(['css', 'html', 'javascript', 'json', 'xml'])
  })
})

describe('text files of kinds the table does not name', () => {
  it('shows source and configuration files, and files known by their name, as text', () => {
    for (const name of ['tool.py', 'run.sh', 'pyproject.toml', 'app.ini', '.env', '.gitignore', 'Main.java', 'lib.rs', 'query.SQL', 'LICENSE', 'Makefile', 'docs/README', 'Dockerfile']) {
      expect(viewKind('application/octet-stream', name, 100), name).toBe('text')
      expect(viewKind(undefined, name, 100), name).toBe('text')
    }
  })
  it('does not take a name like a property of an object for a type', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'a.constructor']) expect(viewKind(undefined, name, 100), name).toBe('other')
  })
  it('keeps a declared type that says something over the name', () => {
    expect(viewKind('image/png', 'LICENSE', 100)).toBe('image')
  })
  it('probes only a small file of no known type', () => {
    expect(canProbe(undefined, 'data.xyz', 100)).toBe(true)
    expect(canProbe('application/octet-stream', 'blob', 100)).toBe(true)
    expect(canProbe(undefined, 'data.xyz', TEXT_LIMIT + 1)).toBe(false)
    expect(canProbe('video/mp4', 'a.mp4', 100)).toBe(false)
    expect(canProbe(undefined, 'run.sh', 100)).toBe(false)
  })
  it('tells text from binary by its bytes', () => {
    expect(looksLikeText(new TextEncoder().encode('héllo wörld\n日本語'))).toBe(true)
    expect(looksLikeText(new Uint8Array())).toBe(true)
    expect(looksLikeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(false)
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0xfd, 0x80]))).toBe(false)
    // A character cut by the end of the sample is not an error: 8191 letters, then half of "é".
    const cut = new Uint8Array(20000).fill(97)
    cut[8191] = 0xc3
    expect(looksLikeText(cut)).toBe(true)
  })
  it('tells the language of a source file by its extension or its name, and by the other types it goes by', () => {
    const cases: [string, string | undefined, string][] = [
      ['run.sh', undefined, 'shell'], ['tool.py', 'application/octet-stream', 'python'], ['main.c', undefined, 'c'], ['lib.h', undefined, 'c'], ['a.cpp', undefined, 'cpp'],
      ['q.SQL', undefined, 'sql'], ['Main.java', undefined, 'java'], ['lib.rs', undefined, 'rust'], ['x.go', undefined, 'go'], ['x.php', undefined, 'php'],
      ['Gemfile', undefined, 'ruby'], ['Dockerfile', undefined, 'dockerfile'], ['pyproject.toml', undefined, 'toml'], ['app.ini', undefined, 'properties'], ['.env', undefined, 'properties'],
      ['unit.pas', undefined, 'pascal'], ['defs.inc', undefined, 'pascal'], ['x.dpr', undefined, 'pascal'], ['a.scss', undefined, 'scss'], ['a.less', undefined, 'less'],
      ['install', 'application/x-sh', 'shell'], ['q', 'application/sql', 'sql'], ['m.py', 'text/x-python-script', 'python'],
    ]
    for (const [name, type, language] of cases) {
      expect(languageOf(type, name), name).toBe(language)
      expect(viewKind(type, name, 100), name).toBe('text')
    }
    expect(languageOf(undefined, 'LICENSE')).toBe('plain')
  })
})
