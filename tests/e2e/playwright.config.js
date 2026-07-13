import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  testMatch: ['**/*.spec.js'],
  timeout: 120_000,
  expect: {
    timeout: 5_000
  },
  reporter: [['list']],
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4100',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'cd ../.. && npm --prefix heresy-server run start',
    url: 'http://127.0.0.1:4100/api/health',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'test',
      PORT: '4100',
      SERVER_PORT: '4100',
      GAME_DB_PATH: './data/heresy-rising-e2e.db',
      ALLOWED_ORIGINS: '*',
      RATE_LIMIT_MAX: '1000',
      ADMIN_PASSWORD: 'heresy-rising-e2e-only'
    }
  }
});
