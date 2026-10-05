import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { writeBigWsnp } from '../fixtures/build.ts'

// Performance budgets (docs/ARCHITECTURE.md, "Testing"): a large .wsnp opens at once and shows its first page within a time, the memory stays
// under a ceiling while every file is read, and the interface stays responsive while that goes on. The budgets are generous: they are there to
// catch a change that makes opening depend on the size of the file, not to rank machines (CI runners are small and their disks slow).
const BIG_MB = Number(process.env.WSNP_BIG_MB ?? 512)
const BUDGET = { firstPageMs: 15_000, memoryMb: 1800, integrityMs: 180_000, mainLagMs: 750, frameGapMs: 750 }
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
const cache = path.resolve('.cache')
let app: ElectronApplication | undefined
let profile: string

test.beforeEach(() => void (profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-perf-'))))
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test.setTimeout(400_000)

test(`a ${BIG_MB} MB snapshot shows its page at once, stays within the memory ceiling, and does not freeze the interface while every file is checked`, async () => {
  fs.mkdirSync(cache, { recursive: true })
  const file = path.join(cache, `e2e-big-${BIG_MB}.wsnp`)
  if (!fs.existsSync(file)) await writeBigWsnp(file, BIG_MB)
  const megabytes = fs.statSync(file).size / 2 ** 20
  expect(megabytes).toBeGreaterThan(BIG_MB)

  const started = Date.now()
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`, ...noSandbox, file] })
  const page = await app.firstWindow()
  await expect(page.frameLocator('iframe[title^="Snapshot:"]').locator('#p')).toHaveText('A page next to a very big file.', { timeout: BUDGET.firstPageMs })
  const firstPageMs = Date.now() - started
  test.info().annotations.push({ type: 'first page', description: `${firstPageMs} ms for ${Math.round(megabytes)} MB` })
  expect(firstPageMs).toBeLessThan(BUDGET.firstPageMs)

  // While the integrity pass reads the whole file: how long the main process takes to answer, how steady the frames of the interface are,
  // and how much memory every process of the application uses, sampled the whole time.
  await page.evaluate(() => {
    const w = window as unknown as { __gap: number; __last: number; __stop: boolean }
    w.__gap = 0
    w.__last = performance.now()
    w.__stop = false
    const tick = (now: number) => {
      w.__gap = Math.max(w.__gap, now - w.__last)
      w.__last = now
      if (!w.__stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  let peakMb = 0
  let worstLag = 0
  let samples = 0
  const checking = Date.now()
  const done = page.getByRole('contentinfo').getByRole('button', { name: /Intact|problem/ })
  while (!(await done.isVisible()) && Date.now() - checking < BUDGET.integrityMs) {
    const t0 = Date.now()
    const mb = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().reduce((sum, p) => sum + p.memory.workingSetSize, 0) / 1024)
    worstLag = Math.max(worstLag, Date.now() - t0)
    peakMb = Math.max(peakMb, mb)
    samples++
    await page.waitForTimeout(100)
  }
  const gap = await page.evaluate(() => {
    const w = window as unknown as { __gap: number; __stop: boolean }
    w.__stop = true
    return w.__gap
  })
  await expect(done).toContainText('Intact')
  const integrityMs = Date.now() - checking
  test.info().annotations.push({ type: 'integrity', description: `${integrityMs} ms, peak ${Math.round(peakMb)} MB of memory, worst main-process lag ${worstLag} ms, worst frame gap ${Math.round(gap)} ms (${samples} samples)` })
  expect(peakMb).toBeLessThan(BUDGET.memoryMb)
  expect(worstLag).toBeLessThan(BUDGET.mainLagMs)
  expect(gap).toBeLessThan(BUDGET.frameGapMs)
  expect(integrityMs).toBeLessThan(BUDGET.integrityMs)
})
