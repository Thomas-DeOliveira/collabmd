import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node scripts/start-test-server.mjs',
    env: {
      NODE_ENV: 'test',
      TEST_SERVER_HOST: '127.0.0.1',
      TEST_SERVER_PERSISTENCE_DIR: '.tmp/playwright-data',
      TEST_SERVER_PORT: '4173',
      TEST_SERVER_ROOM_NAMESPACE: 'collabmd-playwright',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    url: 'http://127.0.0.1:4173/health',
  },
  workers: 1,
});
