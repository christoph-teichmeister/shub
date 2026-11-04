import { defineConfig, devices } from '@playwright/test';

// Smoke test of the built web app (run `npm run build` first). /api is mocked in the test.
export default defineConfig({
  testDir: 'test',
  testMatch: 'smoke.spec.ts',
  reporter: 'list',
  // One retry on CI absorbs a rare flake; locally a flaky test fails so it gets fixed.
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:4791', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npx vite preview --config web/vite.config.ts --host 127.0.0.1 --port 4791 --strictPort',
    url: 'http://127.0.0.1:4791',
    reuseExistingServer: !process.env.CI,
  },
});
