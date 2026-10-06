import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  // The runners of the CI (Windows above all) are slow: an assertion waits longer there than on a developer's machine.
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  workers: 1,
  // A few specs that depend on the pointer or on which window has the focus fail now and then on a desktop that is busy and pass when run again (CLAUDE.md): one more try,
  // and Playwright reports it as flaky, not as passed. A spec that is really broken fails twice.
  retries: 1,
  reporter: [['list']],
})
