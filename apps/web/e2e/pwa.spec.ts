import { expect, test } from '@playwright/test'

// The installable, offline app (#148, #159). Service workers are blocked in every other test, so
// the Google mocks see each request; this one needs the real worker.
test.use({ serviceWorkers: 'allow' })

/** Installing and storing the whole build can take longer than an assertion's default wait. */
const INSTALL_WAIT = { timeout: 30_000 }

test('the app can be installed and opens offline', async ({ context, page }) => {
  // Chrome's install check goes through its DevTools protocol; one Chrome is enough, the phones
  // run the same build.
  test.skip(test.info().project.name !== 'desktop-chrome', "Chrome's install check runs on desktop Chrome only")
  await page.goto('/')

  await test.step('Chrome finds nothing that stops an install', async () => {
    const devtools = await context.newCDPSession(page)
    const { errors, url } = await devtools.send('Page.getAppManifest')
    expect(errors).toEqual([])
    expect(url).toMatch(/\/manifest\.webmanifest$/u)
    await expect.poll(async () => (await devtools.send('Page.getInstallabilityErrors')).installabilityErrors, INSTALL_WAIT).toEqual([])
  })

  await test.step('the manifest describes the app, with the icons an install needs', async () => {
    const manifest: unknown = await (await page.request.get('/manifest.webmanifest')).json()
    expect(manifest).toMatchObject({
      display: 'standalone',
      icons: expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192' }),
        expect.objectContaining({ sizes: '512x512' }),
        expect.objectContaining({ purpose: 'maskable' }),
      ]),
      id: '/',
      name: 'Household Brain',
      screenshots: [expect.anything(), expect.anything()],
      start_url: '/',
    })
  })

  await test.step('a page address opens from the stored app while offline', async () => {
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state), INSTALL_WAIT).toBe('activated')
    // The worker takes over pages opened after it is installed.
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await context.setOffline(true)
    await page.goto('/events')
    // The page itself holds only an empty root element: the sign-in screen at this address means the
    // stored page and its scripts ran without the network.
    await expect(page).toHaveURL(/\/events$/u)
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
    await context.setOffline(false)
  })
})
