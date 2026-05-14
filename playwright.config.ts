import { defineConfig, devices } from '@playwright/test';

// In CI, let Playwright use the downloaded browser.
// Locally, use the pre-installed chromium at /opt/pw-browsers if it exists.
const localChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.CI
  ? undefined
  : (process.env.CHROMIUM_PATH ?? localChromium);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
