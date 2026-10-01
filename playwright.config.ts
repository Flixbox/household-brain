import { defineConfig, devices } from '@playwright/test'

// Runs against a production-like build that talks only to the local Firebase emulators.
// Start it through `pnpm test:emulated`, which boots the emulators first.
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  // Desktop plus the two phones the app is actually used on: Android Chrome and iPhone Safari (WebKit).
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-pixel-9', use: { ...devices['Pixel 9'] } },
    { name: 'iphone-17', use: { ...devices['iPhone 17'] } },
  ],
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  retries: process.env.CI ? 1 : 0,
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build:e2e && pnpm preview --port 4173 --strictPort',
    // Never attach to some other server on 4173, e.g. a production `pnpm preview`.
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://localhost:4173',
  },
  workers: 1,
})
