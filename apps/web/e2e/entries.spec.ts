import { expect, test } from '@playwright/test'
import { resetEmulators, seedDocument } from './emulators'
import { mockGoogle } from './google-mocks'
import { signInAllowlisted } from './session'

const CALENDAR = 'household@group.calendar.google.test'

test.beforeEach(async () => {
  await resetEmulators()
  await seedDocument('meta/config', { calendarId: CALENDAR, ownerUid: 'owner', timeZone: 'Europe/Berlin' })
  await seedDocument('categories/coupon', { colorId: '6', label: 'Coupon', slug: 'coupon', sortOrder: 1 })
  await seedDocument('categories/membership', { colorId: '3', label: 'Membership', slug: 'membership', sortOrder: 2 })
})

test('entries: categories and the form, added, edited, deleted, and a double-tapped Save', async ({ page }) => {
  // An older household: a retired default category, and new defaults it doesn't have yet.
  await seedDocument('categories/document', { colorId: '8', label: 'Document expiry', slug: 'document', sortOrder: 7 })
  const { google, requests } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')

  await test.step('an older household gets new default categories and no longer sees unused retired ones; the form stars only required fields', async () => {
    await expect(page.getByRole('region', { name: 'Paperwork' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Document expiry' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Add Paperwork' }).click()
    const stars = page.locator('form label > span').filter({ hasText: '*' })
    await expect(stars).toHaveText(['Title*', 'Category*', 'Due date (17:00)*'])
    await page.getByRole('link', { name: 'Cancel' }).click()
  })

  await test.step('an entry is added, edited and deleted, and each change reaches Google Calendar', async () => {
    const coupons = page.getByRole('region', { name: 'Coupon' })
    const synced = () => expect(page.getByText('not yet in Google Calendar')).toHaveCount(0)

    // Add, from the category's own "+" so the category is preselected.
    await page.getByRole('link', { name: 'Add Coupon' }).click()
    // An untouched form lets a new app version load when the app leaves the screen; an edited one doesn't.
    await expect(page.locator('[data-hold-updates]')).toHaveCount(0)
    await page.getByLabel('Title').fill('Amazon')
    await expect(page.locator('form[data-hold-updates]')).toHaveCount(1)
    await page.getByLabel('Due date (17:00)').fill('2026-11-03')
    await page.getByLabel('Code').fill('SUMMER25')
    await page.getByLabel('Amount').fill('10')
    // How often it is due shows after the price in the list (#86).
    await page.getByLabel('Every').selectOption('monthly')
    // A bare domain is fine; it is stored as a full address.
    const linkField = page.getByRole('textbox', { exact: true, name: 'Link' })
    const openLink = page.getByRole('link', { name: 'Open the link in a new tab' })
    await linkField.fill('just words')
    await expect(openLink).toHaveCount(0)
    await linkField.fill('shop.household-brain.test')
    await expect(openLink).toHaveAttribute('href', 'https://shop.household-brain.test')
    await expect(openLink).toHaveAttribute('target', '_blank')
    await expect(openLink).toHaveAttribute('rel', 'noopener noreferrer')
    await page.getByRole('button', { name: 'Save' }).click()
    // The price with its interval, and the code show in the list, in that order under the title.
    await expect(coupons.getByRole('link', { name: /Amazon/u })).toContainText(/Amazon\s*10,00\s€ \/ month\s*SUMMER25/u)
    await expect(coupons.getByRole('link', { name: /Amazon/u })).toContainText('2026-11-03')
    await synced()
    expect(google.live()).toEqual([expect.objectContaining({
      end: { dateTime: '2026-11-03T17:15:00', timeZone: 'Europe/Berlin' },
      extendedProperties: { private: expect.objectContaining({ 'hb.amount': '10', 'hb.category': 'coupon', 'hb.code': 'SUMMER25', 'hb.interval': 'monthly', 'hb.url': 'https://shop.household-brain.test' }) },
      reminders: { useDefault: true },
      start: { dateTime: '2026-11-03T17:00:00', timeZone: 'Europe/Berlin' },
      summary: '[Coupon] Amazon',
    })])

    // Edit: only the date changes, so only start and end are sent, guarded by the etag.
    await coupons.getByRole('link', { name: /Amazon/u }).click()
    await page.getByLabel('Due date (17:00)').fill('2026-11-05')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(coupons.getByRole('link', { name: /Amazon/u })).toContainText('2026-11-05')
    await synced()
    const patches = requests.filter(request => request.method === 'PATCH' && request.path.includes('/events/'))
    expect(patches).toHaveLength(1)
    expect(Object.keys(patches[0]?.body as object).toSorted()).toEqual(['end', 'start'])
    expect(google.live().find(event => event.summary === '[Coupon] Amazon')).toMatchObject({ start: { dateTime: '2026-11-05T17:00:00' }, summary: '[Coupon] Amazon' })

    // Its own reminders: a week ahead and the day before, instead of the default two days and one day.
    await coupons.getByRole('link', { name: /Amazon/u }).click()
    await expect(page.getByRole('button', { name: '2 days' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '1 week' }).click()
    await page.getByRole('button', { name: '2 days' }).click()
    await expect(page.getByRole('button', { name: '1 week' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '2 days' })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Save' }).click()
    await synced()
    await expect.poll(() => google.live().find(event => event.summary === '[Coupon] Amazon')).toMatchObject({
      extendedProperties: { private: expect.objectContaining({ 'hb.reminders': '10080,1440' }) },
      reminders: { overrides: [{ method: 'popup', minutes: 10080 }, { method: 'popup', minutes: 1440 }], useDefault: false },
    })

    // Delete.
    await coupons.getByRole('link', { name: /Amazon/u }).click()
    await page.getByRole('button', { name: 'Delete entry' }).click()
    await expect(coupons.getByRole('link', { name: /Amazon/u })).toHaveCount(0)
    await expect.poll(() => google.live().length).toBe(0)
  })

  await test.step('a double-tapped Save creates one entry, and deleting it while it syncs removes the event too', async () => {
    const before = requests.length
    await page.getByRole('link', { name: 'Add Coupon' }).click()
    await page.getByLabel('Title').fill('Cinema')
    await page.getByLabel('Due date (17:00)').fill('2026-12-24')
    await page.getByRole('button', { name: 'Save' }).dblclick()
    const row = page.getByRole('region', { name: 'Coupon' }).getByRole('link', { name: /Cinema/u })
    await expect(row).toHaveCount(1)

    await row.click()
    await page.getByRole('button', { name: 'Delete entry' }).click()
    await expect(row).toHaveCount(0)
    await expect(page.getByText('not yet in Google Calendar')).toHaveCount(0)
    expect(google.live().length, requests.slice(before).map(request => `${request.method} ${request.path}`).join(' | ')).toBe(0)
    // At most one insert: the delete may even win before the entry was ever sent.
    expect(requests.slice(before).filter(request => request.method === 'POST' && request.path.endsWith('/events')).length).toBeLessThanOrEqual(1)
  })

  // Last: its row would otherwise sit where the double-tapped Save's second tap lands on a phone.
  await test.step('a balance without a date stays in the app, and gets an event only while it has a date', async () => {
    // Balance is a newer default: this older household gets it through the top-up. On a desktop the
    // double-tapped Save's second click lands on its header (the last on the board) and folds it, which
    // the device remembers: unfold it first.
    const balanceHeader = page.getByRole('region', { name: 'Balance' }).getByRole('button', { name: /Balance/u })
    if (await balanceHeader.getAttribute('aria-expanded') === 'false') {
      await balanceHeader.click()
    }
    // The due date is optional now that every app that synced (just this one) handles entries without one.
    await page.getByRole('link', { name: 'Add Balance' }).click()
    await expect(page.locator('form label > span').filter({ hasText: '*' })).toHaveText(['Title*', 'Category*'])
    await page.getByLabel('Title').fill('Gift card credit')
    await page.getByLabel('Amount').fill('25')
    await page.getByRole('button', { name: 'Save' }).click()
    const credit = page.getByRole('region', { name: 'Balance' }).getByRole('link', { name: /Gift card credit/u })
    await expect(credit).toContainText(/25,00\s€/u)
    await expect(credit).toContainText('no expiry')
    // Its price sits right under the title, as every entry's does, not on the right (#87).
    await credit.scrollIntoViewIfNeeded()
    await expect(credit.getByText('Gift card credit', { exact: true }).locator('xpath=following-sibling::span[1]')).toHaveText(/25,00\s€/u)
    await expect(page.getByText('not yet in Google Calendar')).toHaveCount(0)
    const creditEvent = () => google.live().find(event => String(event.summary).includes('Gift card credit'))
    expect(creditEvent()).toBeUndefined()

    // Given a date, it is an ordinary entry with an event; without it again, the event goes.
    await credit.click()
    await page.getByLabel('Due date (17:00)').fill('2026-12-31')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(credit).toContainText('2026-12-31')
    await expect.poll(() => creditEvent()?.summary).toBe('[Balance] Gift card credit')
    await credit.click()
    await page.getByLabel('Due date (17:00)').fill('')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(credit).toContainText('no expiry')
    await expect.poll(() => creditEvent()).toBeUndefined()

    // The pull that sees the event deleted keeps the entry: wait for one after a reload, then for
    // the app to go quiet, before looking.
    const before = requests.length
    await page.reload()
    await expect.poll(() => requests.slice(before).some(request => request.method === 'GET' && request.path.endsWith('/events'))).toBe(true)
    await expect.poll(async () => {
      const seen = requests.length
      await new Promise(resolve => {
        setTimeout(resolve, 1000)
      })
      return requests.length === seen
    }, { timeout: 15_000 }).toBe(true)
    await expect(credit).toContainText('no expiry')

    // Given a date again, the deleted event comes back.
    await credit.click()
    await page.getByLabel('Due date (17:00)').fill('2027-01-31')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => creditEvent()?.start).toMatchObject({ dateTime: '2027-01-31T17:00:00' })

    // In another currency it shows in that one, with its euro value at the day's rate.
    await page.route('https://api.frankfurter.dev/**', route => route.fulfill({ json: [{ base: 'EUR', date: '2027-01-01', quote: 'USD', rate: 1.25 }] }))
    await credit.click()
    await page.getByLabel('Currency').selectOption('USD')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(credit).toContainText(/25,00\s\$\s≈\s20,00\s€/u)
    await expect.poll(() => creditEvent()).toMatchObject({ extendedProperties: { private: expect.objectContaining({ 'hb.currency': 'USD' }) } })
  })
})

test('without Google access an entry waits, "Sync now" sends it, and a reload keeps the access', async ({ page }) => {
  const { google, requests } = await mockGoogle(page)
  await page.addInitScript(() => {
    // The first token request fails, as when Google's window is closed; later ones succeed.
    const original = (window as unknown as { google: { accounts: { oauth2: { initTokenClient: (config: object) => unknown } } } }).google.accounts.oauth2
    const realInit = original.initTokenClient
    let refused = false
    original.initTokenClient = config => (refused
      ? realInit(config)
      : { requestAccessToken: () => {
        refused = true
        setTimeout(() => (config as { error_callback: (error: object) => void }).error_callback({ type: 'popup_closed' }), 0)
      } })
  })
  await signInAllowlisted(page, 'owner@household-brain.test')

  await page.getByRole('link', { name: 'Add Coupon' }).click()
  await page.getByLabel('Title').fill('Gym')
  await page.getByLabel('Due date (17:00)').fill('2026-12-01')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('1 change not yet in Google Calendar.')).toBeVisible()
  expect(google.live().length).toBe(0)

  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByText('not yet in Google Calendar')).toHaveCount(0)
  expect(google.live()).toEqual([expect.objectContaining({ summary: '[Coupon] Gym' })])

  // The token is kept across a reload: the reloaded app reads Google Calendar straight away, which it
  // only does with a token, and offers no "Sync now". (This test's first token request is refused,
  // so a reload that asked Google again would show the button.)
  // Leave the app first, so a late request from the old page can't count as the new page's.
  const appUrl = page.url()
  await page.goto('about:blank')
  const before = requests.length
  await page.goto(appUrl)
  await expect.poll(() => requests.length).toBeGreaterThan(before)
  await expect(page.getByRole('button', { name: 'Sync now' })).toHaveCount(0)
})
