import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  // The runners of the CI (Windows above all) are slow: an assertion waits longer there than on a developer's machine.
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  workers: 1,
  reporter: [['list']],
})
