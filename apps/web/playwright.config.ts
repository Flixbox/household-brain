import { defineConfig, devices } from '@playwright/test'
import { hasText } from '@household-brain/core/lib/read'

// Runs against a production-like build that talks only to the local Firebase emulators, served by
// the Hosting emulator with production's headers and rewrites (#150). Start it through
// `bun run test:emulated`, which builds it and boots the emulators first.
// Safari can't run the app (#179), so the iPhone only checks that it shows the notice instead.
const SAFARI_ONLY = /safari\.spec\.ts$/u
const DEVICES = [
  { name: 'desktop-chrome', testIgnore: SAFARI_ONLY, use: { ...devices['Desktop Chrome'] } },
  { name: 'android-pixel-9', testIgnore: SAFARI_ONLY, use: { ...devices['Pixel 9'] } },
  { name: 'iphone-17', testMatch: SAFARI_ONLY, use: { ...devices['iPhone 17'] } },
]

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  globalTimeout: 8 * 60_000,
  // Desktop and the phone the app is used on (Android Chrome), plus the iPhone for the Safari notice.
  // CI runs one device per job: `E2E_PROJECT` picks it, and is an Nx input, so a cached result is
  // only ever replayed for the same device.
  projects: DEVICES.filter(device => !hasText(process.env.E2E_PROJECT) || device.name === process.env.E2E_PROJECT),
  // `list` streams progress in CI too, so a hang shows where it is.
  reporter: hasText(process.env.CI) ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  retries: hasText(process.env.CI) ? 1 : 0,
  testDir: 'e2e',
  // Tests are user journeys of several steps (#44), so they get more than the default 30 s each.
  timeout: 120_000,
  use: {
    // A missing element fails its step quickly instead of using up a journey's whole timeout.
    actionTimeout: 15_000,
    // The Hosting emulator (firebase.json) listens on 127.0.0.1, not on every name for localhost.
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    // Every test is filmed in CI, so a pull request can show the screens it changed as a GIF
    // (`packages/tooling/src/pr-gif.ts`). Demo data only: the tests never see real entries.
    video: hasText(process.env.CI) ? 'on' : 'off',
  },
  workers: 1,
})
