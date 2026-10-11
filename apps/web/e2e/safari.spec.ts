import { expect, test } from '@playwright/test'

// Safari has no Temporal, so it gets a notice instead of the app (#179). Playwright's WebKit build
// already has Temporal, so the test takes it away before the page loads, as stable Safari lacks it.
test('Safari shows the notice instead of the app', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, 'Temporal')
  })
  await page.goto('/')
  await expect(page.getByText("Safari doesn't support modern web standards as of 2026-10-11. Until temporal-polyfill is supported, this site is inaccessible.")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0)
})
