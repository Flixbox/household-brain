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

test('an entry is added, edited and deleted, and each change reaches Google Calendar', async ({ page }) => {
  const { events, requests } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  const coupons = page.getByRole('region', { name: 'Coupon' })
  const synced = () => expect(page.getByText('not yet in Google Calendar')).toHaveCount(0)

  // Add, from the category's own "+" so the category is preselected.
  await page.getByRole('link', { name: 'Add Coupon' }).click()
  await page.getByLabel('Title').fill('Amazon')
  await page.getByLabel('Due date (17:00)').fill('2026-11-03')
  await page.getByLabel('Code').fill('SUMMER25')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(coupons.getByRole('link', { name: /Amazon/u })).toContainText('2026-11-03')
  await synced()
  expect([...events.values()]).toEqual([expect.objectContaining({
    end: { dateTime: '2026-11-03T17:15:00', timeZone: 'Europe/Berlin' },
    extendedProperties: { private: expect.objectContaining({ 'hb.category': 'coupon', 'hb.code': 'SUMMER25' }) },
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
  expect(Object.keys(patches[0].body as object).toSorted()).toEqual(['end', 'start'])
  expect([...events.values()][0]).toMatchObject({ start: { dateTime: '2026-11-05T17:00:00' }, summary: '[Coupon] Amazon' })

  // Delete.
  await coupons.getByRole('link', { name: /Amazon/u }).click()
  await page.getByRole('button', { name: 'Delete entry' }).click()
  await expect(coupons.getByRole('link', { name: /Amazon/u })).toHaveCount(0)
  await expect.poll(() => events.size).toBe(0)
})

test('without Google access an entry waits, and "Sync now" sends it', async ({ page }) => {
  const { events } = await mockGoogle(page)
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
  expect(events.size).toBe(0)

  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByText('not yet in Google Calendar')).toHaveCount(0)
  expect([...events.values()]).toEqual([expect.objectContaining({ summary: '[Coupon] Gym' })])
})

test('a double-tapped Save creates one entry, and deleting it while it syncs removes the event too', async ({ page }) => {
  const { events, requests } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')

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
  expect(events.size, requests.map(request => `${request.method} ${request.path}`).join(' | ')).toBe(0)
  // At most one insert: the delete may even win before the entry was ever sent.
  expect(requests.filter(request => request.method === 'POST' && request.path.endsWith('/events')).length).toBeLessThanOrEqual(1)
})
