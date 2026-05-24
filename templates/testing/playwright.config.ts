import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    ['json', { outputFile: '.agent/traces/test-results.json' }],
  ],

  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    // Auth setup — runs first, saves storageState
    {
      name: 'setup',
      testMatch: '**/setup/*.setup.ts',
    },

    // Critical paths — unauthenticated (route protection tests)
    {
      name: 'critical-unauthenticated',
      testMatch: '**/critical-paths/cp-003-*.e2e.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // Critical paths — authenticated
    {
      name: 'critical-authenticated',
      testMatch: '**/critical-paths/cp-00[1245678]-*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/fixtures/auth.json',
      },
      dependencies: ['setup'],
    },

    // Feature tests — authenticated
    {
      name: 'features',
      testMatch: '**/features/**/*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/fixtures/auth.json',
      },
      dependencies: ['setup'],
    },
  ],

  // Start dev server automatically if not already running
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
})
