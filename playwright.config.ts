import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
  },
})
