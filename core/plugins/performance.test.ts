import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { completeManifest, minimalManifest } from '../../fixtures/plugins.ts'
import { MANIFEST_TEXT_LIMIT, parseManifest } from './manifest.ts'

// Opt-in audit output survives runners that suppress successful tests' stdout.
const recordBudget = (kind: string, ms: number) => {
  if (process.env.FB_MANIFEST_BUDGET_REPORT === '1') appendFileSync('.delegate/reprova-budget-metrics.jsonl', JSON.stringify({ kind, ms }) + '\n')
}

it('validates 100 complete manifests in under 50 ms, median of 20 rounds', () => {
  const input = completeManifest(), samples: number[] = []
  for (let round = 0; round < 20; round++) {
    const start = performance.now()
    for (let i = 0; i < 100; i++) { const result = parseManifest(input); if (!result.ok) throw new Error(JSON.stringify(result.errors)) }
    samples.push(performance.now() - start)
  }
  const sorted = samples.toSorted((a, b) => a - b), median = (sorted[9] + sorted[10]) / 2
  process.stdout.write(`Manifest budget: 100 complete=${median.toFixed(3)} ms; median/20\n`)
  recordBudget('100-complete-median20', median)
  expect(median).toBeLessThan(50)
})
it('rejects exactly 256 KB of hostile JSON in under 20 ms', () => {
  const json = JSON.stringify({ ...minimalManifest(), evil: Array(900).fill('x'.repeat(280)) })
  const input = json + ' '.repeat(MANIFEST_TEXT_LIMIT - Buffer.byteLength(json))
  expect(Buffer.byteLength(input)).toBe(MANIFEST_TEXT_LIMIT)
  const start = performance.now(), result = parseManifest(input), elapsed = performance.now() - start
  expect(result.ok).toBe(false)
  process.stdout.write(`Manifest budget: hostile 256 KB=${elapsed.toFixed(3)} ms\n`)
  recordBudget('hostile-256KB', elapsed)
  expect(elapsed).toBeLessThan(20)
})
it('keeps the plugin host out of every production startup module, including dynamic imports', () => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    return entry.isDirectory() ? walk(path) : /\.(?:ts|tsx)$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : []
  })
  for (const path of ['src', 'electron', 'core'].flatMap(walk).filter(path => !path.startsWith('core/plugins/'))) {
    const source = readFileSync(path, 'utf8')
    const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1])
    expect(imports.filter(specifier => /(?:^|\/)plugins(?:\/|$)/.test(specifier)), path).toEqual([])
  }
})
