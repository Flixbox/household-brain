import { expect, test } from '@playwright/test'

// The installable, offline app (#148, #159). Service workers are blocked in every other test, so
// the Google mocks see each request; this one needs the real worker.
test.use({ serviceWorkers: 'allow' })

test('the app can be installed and opens offline', async ({ context, page }) => {
  // Chrome's install check goes through its DevTools protocol; one Chrome is enough, the phones
  // run the same build.
  test.skip(test.info().project.name !== 'desktop-chrome', "Chrome's install check runs on desktop Chrome only")
  await page.goto('/')

  await test.step('Chrome finds nothing that stops an install', async () => {
    const devtools = await context.newCDPSession(page)
    const { errors } = await devtools.send('Page.getAppManifest')
    expect(errors).toEqual([])
    await expect.poll(async () => (await devtools.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([])
  })

  await test.step('a page address opens from the stored app while offline', async () => {
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated')
    // The worker takes over pages opened after it is installed.
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await context.setOffline(true)
    await page.goto('/events')
    await expect(page.getByRole('heading', { name: 'Household Brain' })).toBeVisible()
    await context.setOffline(false)
  })
})
