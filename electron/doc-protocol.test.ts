import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocFiles } from '../core/docs.ts'
import { serveDoc } from './doc-protocol.ts'

let scripts: string
const docs = new DocFiles()
let token: string
beforeEach(() => {
  scripts = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-doc-'))
  fs.writeFileSync(path.join(scripts, 'docx.js'), 'console.log("docx")')
  fs.writeFileSync(path.join(scripts, 'pptx.js'), 'console.log("pptx")')
  token = docs.add({ bytes: new Uint8Array([80, 75, 3, 4]), name: 'a.docx', flavour: 'docx' })
})
afterEach(() => {
  docs.releaseAll()
  fs.rmSync(scripts, { recursive: true, force: true })
})
const get = (p: string, host = token) => serveDoc(docs, scripts, `fb-doc://${host}${p}`)

describe('serveDoc', () => {
  it('serves the page of the document with the policy that cuts it off', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
    expect(await res.text()).toContain('/_v/docx.js')
  })
  it('serves the file, readable by the opaque origin of the page', async () => {
    const res = await get('/_file')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([80, 75, 3, 4])
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
  it('serves the script of its own library and no other', async () => {
    expect(await (await get('/_v/docx.js')).text()).toBe('console.log("docx")')
    expect((await get('/_v/pptx.js')).status).toBe(404)
    expect((await get('/_v/../docx.js')).status).toBe(404)
    expect((await get('/_v/secret.js')).status).toBe(404)
  })
  it('does not know a token it did not give, or one that was let go', async () => {
    expect((await get('/', 'dffff')).status).toBe(404)
    docs.release(token)
    expect((await get('/')).status).toBe(404)
  })
  it('serves nothing else', async () => {
    expect((await get('/etc/passwd')).status).toBe(404)
    expect((await get('/_file/../x')).status).toBe(404)
  })
})
