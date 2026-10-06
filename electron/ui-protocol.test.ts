import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveUiFile, serveUi, UI_CSP } from './ui-protocol.ts'

let root: string
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-ui-'))
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>x</title>')
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1)')
  fs.writeFileSync(path.join(os.tmpdir(), 'fb-ui-secret.txt'), 'secret')
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('the interface protocol', () => {
  it('maps a request path to a file of the build, and / to index.html', () => {
    expect(resolveUiFile(root, '/')).toBe(path.join(root, 'index.html'))
    expect(resolveUiFile(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'))
  })
  it('never leaves the folder', () => {
    expect(resolveUiFile(root, '/../fb-ui-secret.txt')).toBeNull()
    expect(resolveUiFile(root, '/%2e%2e/fb-ui-secret.txt')).toBeNull()
    expect(resolveUiFile(root, '/assets/../../fb-ui-secret.txt')).toBeNull()
    expect(resolveUiFile(root, '/%zz')).toBeNull()
  })
  it('serves the page with the interface policy and the scripts with their type', async () => {
    const page = await serveUi(root, 'fb-ui://host/index.html')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('content-security-policy')).toBe(UI_CSP)
    const script = await serveUi(root, 'fb-ui://host/assets/app.js')
    expect(script.headers.get('content-type')).toContain('text/javascript')
    expect(script.headers.get('content-security-policy')).toBeNull()
  })
  it('answers 404 for a missing file and 403 for another host or an escape', async () => {
    expect((await serveUi(root, 'fb-ui://host/missing.js')).status).toBe(404)
    expect((await serveUi(root, 'fb-ui://other/index.html')).status).toBe(403)
    // The URL parser already folds `%2e%2e` into the path, so the file is simply not there; either answer keeps the secret in.
    expect([403, 404]).toContain((await serveUi(root, 'fb-ui://host/%2e%2e/fb-ui-secret.txt')).status)
    expect([403, 404]).toContain((await serveUi(root, 'fb-ui://host/..%2f..%2ffb-ui-secret.txt')).status)
  })
  it('lets the interface embed only snapshots, documents and web frames, and run only its own scripts', () => {
    expect(UI_CSP).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(UI_CSP).toContain("worker-src 'self'")
    expect(UI_CSP).toContain("default-src 'none'")
    expect(UI_CSP).toContain('frame-src wsnp: fb-doc: https: http:')
    // WebAssembly may be compiled (pdf.js's decoders), but no code is ever built from a string.
    expect(UI_CSP).not.toMatch(/'unsafe-eval'/)
  })
})
