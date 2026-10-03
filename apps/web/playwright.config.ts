import { defineConfig, devices } from '@playwright/test'

// Runs against a production-like build that talks only to the local Firebase emulators.
// Start it through `pnpm test:emulated`, which boots the emulators first.
const DEVICES = [
  { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  { name: 'android-pixel-9', use: { ...devices['Pixel 9'] } },
  { name: 'iphone-17', use: { ...devices['iPhone 17'] } },
]

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  globalTimeout: 8 * 60_000,
  // Desktop plus the two phones the app is actually used on: Android Chrome and iPhone Safari (WebKit).
  // CI runs one device per job: `E2E_PROJECT` picks it, and is an Nx input, so a cached result is
  // only ever replayed for the same device.
  projects: DEVICES.filter(device => !process.env.E2E_PROJECT || device.name === process.env.E2E_PROJECT),
  // `list` streams progress in CI too, so a hang shows where it is.
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  retries: process.env.CI ? 1 : 0,
  testDir: 'e2e',
  // Tests are user journeys of several steps (#44), so they get more than the default 30 s each.
  timeout: 120_000,
  use: {
    // A missing element fails its step quickly instead of using up a journey's whole timeout.
    actionTimeout: 15_000,
    baseURL: 'http://localhost:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    // Every test is filmed in CI, so a pull request can show the screens it changed as a GIF
    // (`scripts/pr-gif.sh`). Demo data only: the tests never see real entries.
    video: process.env.CI ? 'on' : 'off',
  },
  // `pnpm test:e2e` builds first. The server command must be `vite preview` itself, not a pnpm
  // script or an `&&` chain: those wrappers swallow the stop signal and Playwright then waits for the
  // server to exit forever.
  webServer: {
    command: 'vite preview --outDir dist-e2e --port 4173 --strictPort',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    // Never attach to some other server on 4173, e.g. a production `pnpm preview`.
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://localhost:4173',
  },
  workers: 1,
})
