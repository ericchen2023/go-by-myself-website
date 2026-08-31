import { defineConfig, devices } from '@playwright/test';
import { vercelProtectionHeaders } from './scripts/vercel-protection.mjs';

const remoteBaseURL = process.env.E2E_BASE_URL?.trim();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 4,
  timeout: 45_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: remoteBaseURL || 'http://127.0.0.1:4173',
    extraHTTPHeaders: remoteBaseURL ? vercelProtectionHeaders() : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    reducedMotion: 'reduce'
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 5'] } }
  ],
  webServer: remoteBaseURL ? undefined : {
    command: 'npm run demo',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
