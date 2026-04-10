import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import * as dotenv from 'dotenv';

// Load .env.local for test user credentials and firebase config
dotenv.config({ path: path.resolve(__dirname, '.env.local') });
process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR = 'true';

export default defineConfig({
  globalSetup: require.resolve('./tests/e2e/global-setup.ts'),
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx cross-env NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      ...process.env,
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
    },
  },
});
