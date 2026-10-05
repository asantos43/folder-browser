import { describe, expect, it } from 'vitest'
import { canFormat, FORMAT_LIMIT, formatSource } from './format.ts'

describe('formatSource: lays a file out for reading, and only lays it out', () => {
  it('puts JSON one member to a line, indented, and does not parse it: a number too big for a double stays as it is', async () => {
    const out = await formatSource('{"name":"harbor","big":12345678901234567890,"items":[{"id":1,"tags":["a","b"]},{"id":2,"tags":[]}]}', 'json')
    expect(out.split('\n').length).toBeGreaterThan(8)
    expect(out).toContain('  "name": "harbor",')
    expect(out).toContain('12345678901234567890')
    expect(JSON.parse(out)).toEqual(JSON.parse('{"name":"harbor","big":12345678901234567890,"items":[{"id":1,"tags":["a","b"]},{"id":2,"tags":[]}]}'))
  })
  it('lays out minified HTML, with its script and style, an element to a line', async () => {
    const out = await formatSource('<!doctype html><html><head><title>t</title><style>p{color:red}</style></head><body><div><p>one</p><ul><li>a</li><li>b</li></ul></div><script>var x=1;function f(){return x}</script></body></html>', 'html')
    expect(out.split('\n').length).toBeGreaterThan(15)
    expect(out).toMatch(/\n {2}<head>/)
    expect(out).toContain('color: red')
    expect(out).toMatch(/function f\(\) \{\n\s+return x\n\s+\}/)
  })
  it('lays out CSS a declaration to a line, and JavaScript a statement to a line', async () => {
    const css = await formatSource('body{margin:0;font:14px/1.4 sans-serif}.card>h2{color:#0a7}@media (min-width:600px){.card{gap:16px}}', 'css')
    expect(css).toContain('body {\n  margin: 0;\n  font: 14px/1.4 sans-serif\n}')
    expect(css).toContain('.card>h2 {')
    const js = await formatSource('function add(a,b){return a+b}const items=[1,2,3].map(function(x){return add(x,1)});if(items.length>2){console.log("ok")}', 'javascript')
    expect(js).toContain('function add(a, b) {\n  return a + b\n}')
    expect(js.split('\n').length).toBeGreaterThan(8)
  })
  it('lays out XML and SVG', async () => {
    const out = await formatSource('<svg xmlns="http://www.w3.org/2000/svg" width="40"><g><circle cx="20" cy="20" r="18"/><path d="M0 0"/></g></svg>', 'xml')
    expect(out.split('\n').length).toBeGreaterThan(4)
    expect(out).toContain('<circle cx="20" cy="20" r="18" />')
  })
  it('gives back what it cannot lay out, and text that is not a language it knows, unchanged', async () => {
    expect(await formatSource('just some text, not code', 'plain')).toBe('just some text, not code')
    expect(await formatSource('# Title\n* one', 'markdown')).toBe('# Title\n* one')
    expect(await formatSource('a: 1', 'yaml')).toBe('a: 1')
  })
  it('is tolerant: half a page is still laid out, and broken JSON does not throw', async () => {
    expect((await formatSource('<div><p>open', 'html')).length).toBeGreaterThan(5)
    expect((await formatSource('{"a": ', 'json')).length).toBeGreaterThan(0)
  })
  it('keeps what is inside <pre> as it was written', async () => {
    const out = await formatSource('<div><pre>line 1\n   line 2\n</pre></div>', 'html')
    expect(out).toContain('<pre>line 1\n   line 2\n</pre>')
  })
})

describe('canFormat', () => {
  it('is true for the languages a formatter knows, up to the limit', () => {
    for (const language of ['json', 'html', 'css', 'javascript', 'xml'] as const) expect(canFormat(language, 1000), language).toBe(true)
    for (const language of ['plain', 'markdown', 'yaml', 'typescript'] as const) expect(canFormat(language, 1000), language).toBe(false)
    expect(canFormat('json', FORMAT_LIMIT)).toBe(true)
    expect(canFormat('json', FORMAT_LIMIT + 1)).toBe(false)
  })
})
