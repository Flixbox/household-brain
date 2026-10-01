import { type Page, expect, test } from '@playwright/test'
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

/** The app pulls when it comes back to the foreground; this simulates that until `check` passes. */
const pullUntil = (page: Page, check: () => Promise<number>, expected: number) =>
  expect.poll(async () => {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    return check()
  }, { intervals: [1000], timeout: 15_000 }).toBe(expected)

test('events made, changed and deleted in Google Calendar show up in the app', async ({ page }) => {
  const { google } = await mockGoogle(page)
  // All day, with its own reminders: both need clearing explicitly, or Google rejects the patch.
  google.create({
    end: { date: '2026-12-02' },
    id: 'madeingoogle1',
    reminders: { overrides: [{ method: 'popup', minutes: 10 }], useDefault: false },
    start: { date: '2026-12-01' },
    summary: '[Membership] Gym',
  })
  await signInAllowlisted(page, 'owner@household-brain.test')

  // This device has no Google access yet: the bar offers it, and connecting pulls.
  await expect(page.getByText('Not synced with Google Calendar on this device yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Sync now' }).click()
  const gym = page.getByRole('region', { name: 'Membership' }).getByRole('link', { name: /Gym/u })
  await expect(gym).toContainText('2026-12-01')

  // The event was brought into shape: due 17:00, default reminders, category recorded.
  await expect.poll(() => google.live()[0]).toMatchObject({
    extendedProperties: { private: { 'hb.category': 'membership' } },
    reminders: { overrides: [], useDefault: true },
    start: { dateTime: '2026-12-01T17:00:00', timeZone: 'Europe/Berlin' },
    summary: '[Membership] Gym',
  })
  expect(google.live()[0].start).not.toHaveProperty('date')

  google.edit('madeingoogle1', { summary: '[Membership] Gym (renewed)' })
  await pullUntil(page, () => page.getByRole('link', { name: /Gym \(renewed\)/u }).count(), 1)

  google.delete('madeingoogle1')
  await pullUntil(page, () => page.getByRole('link', { name: /Gym/u }).count(), 0)
})

test('a local edit waiting to be sent keeps its fields, and takes the others from Google', async ({ page }) => {
  const { google } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  await page.getByRole('button', { name: 'Sync now' }).click()

  await page.getByRole('link', { name: 'Add Coupon' }).click()
  await page.getByLabel('Title').fill('Cinema')
  await page.getByLabel('Due date (17:00)').fill('2026-12-24')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => google.live().length).toBe(1)
  const [{ id }] = google.live() as [{ id: string }]

  // Google: someone moves the date. Here: the code is edited, which pulls first, then pushes.
  google.edit(id, { end: { dateTime: '2026-12-27T17:15:00', timeZone: 'Europe/Berlin' }, start: { dateTime: '2026-12-27T17:00:00', timeZone: 'Europe/Berlin' } })
  await page.getByRole('link', { name: /Cinema/u }).click()
  await page.getByLabel('Code').fill('POPCORN')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('link', { name: /Cinema/u })).toContainText('2026-12-27')
  await expect.poll(() => google.live()[0]).toMatchObject({
    extendedProperties: { private: { 'hb.code': 'POPCORN' } },
    start: { dateTime: '2026-12-27T17:00:00' },
  })
})

test('events put in by hand show as uncategorised and are left alone; repeating events are ignored', async ({ page }) => {
  const { google } = await mockGoogle(page)
  const birthday = google.create({ end: { date: '2026-12-11' }, id: 'birthday1', reminders: { useDefault: false }, start: { date: '2026-12-10' }, summary: 'Grandma' })
  google.create({ end: { date: '2020-05-02' }, id: 'series1', recurrence: ['RRULE:FREQ=YEARLY'], start: { date: '2020-05-01' }, summary: '[Coupon] Yearly' })
  await signInAllowlisted(page, 'owner@household-brain.test')
  await page.getByRole('button', { name: 'Sync now' }).click()

  await expect(page.getByRole('region', { name: 'Uncategorised' }).getByRole('link', { name: /Grandma/u })).toContainText('2026-12-10')
  await expect(page.getByRole('link', { name: /Yearly/u })).toHaveCount(0)
  expect(google.live().find(event => event.id === 'birthday1')).toEqual(birthday)
})

test('an entry edited here while it was deleted in Google comes back with the edit', async ({ page }) => {
  const { google } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  await page.getByRole('button', { name: 'Sync now' }).click()
  await page.getByRole('link', { name: 'Add Coupon' }).click()
  await page.getByLabel('Title').fill('Bakery')
  await page.getByLabel('Due date (17:00)').fill('2026-12-05')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => google.live().length).toBe(1)
  const [{ id }] = google.live() as [{ id: string }]

  google.delete(id)
  await page.getByRole('link', { name: /Bakery/u }).click()
  await page.getByLabel('Code').fill('CROISSANT')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect.poll(() => google.live()[0]).toMatchObject({ extendedProperties: { private: { 'hb.code': 'CROISSANT' } }, id, status: 'confirmed' })
  await expect(page.getByRole('link', { name: /Bakery/u })).toHaveCount(1)
})
