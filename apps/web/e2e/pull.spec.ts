import { type Page, expect, test } from '@playwright/test'
import { allowlist, readDocument, resetEmulators, seedDocument } from './emulators'
import { mockGoogle } from './google-mocks'
import { openMenu, signInAllowlisted, signInAs } from './session'

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
  }, { intervals: [250], timeout: 15_000 }).toBe(expected)

test('events made in Google Calendar: taken in and shaped, left alone when put in by hand, strays removed', async ({ page }) => {
  const { google } = await mockGoogle(page)
  // All day, with its own reminders: both need clearing explicitly, or Google rejects the patch.
  google.create({
    end: { date: '2026-12-02' },
    id: 'madeingoogle1',
    reminders: { overrides: [{ method: 'popup', minutes: 10 }], useDefault: false },
    start: { date: '2026-12-01' },
    summary: '[Membership] Gym',
  })
  const birthday = google.create({ end: { date: '2026-12-11' }, id: 'birthday1', reminders: { useDefault: false }, start: { date: '2026-12-10' }, summary: 'Grandma' })
  google.create({ end: { date: '2020-05-02' }, id: 'series1', recurrence: ['RRULE:FREQ=YEARLY'], start: { date: '2020-05-01' }, summary: '[Coupon] Yearly' })
  const strayId = 'abcdefghijklmnopqrstuv0123d01234567'
  // As an older app version might have left it: an entry made from a date event.
  await seedDocument(`items/${strayId}`, { category: 'coupon', dueDate: '2099-11-30', status: 'open', sync: 'synced', title: 'Stray' })
  google.create({
    end: { dateTime: '2099-11-30T17:15:00', timeZone: 'Europe/Berlin' },
    extendedProperties: { private: { 'hb.category': 'coupon', 'hb.date': '01234567', 'hb.entry': 'abcdefghijklmnopqrstuv0123', 'hb.v': '1' } },
    id: strayId,
    start: { dateTime: '2099-11-30T17:00:00', timeZone: 'Europe/Berlin' },
    summary: '[Coupon] Something — Cancel by',
  })
  const uid = await signInAllowlisted(page, 'owner@household-brain.test')
  const gymEvent = () => google.live().find(event => event.id === 'madeingoogle1')

  await test.step('events made, changed and deleted in Google Calendar show up in the app', async () => {
    // This device has no Google access yet: the bar offers it, and connecting pulls.
    await expect(page.getByText('Not synced with Google Calendar on this device yet.')).toBeVisible()
    await page.getByRole('button', { name: 'Sync now' }).click()
    const gym = page.getByRole('region', { name: 'Membership' }).getByRole('link', { name: /Gym/u })
    await expect(gym).toContainText('2026-12-01')

    // The event was brought into shape: due 17:00, default reminders, category recorded.
    await expect.poll(() => gymEvent()).toMatchObject({
      extendedProperties: { private: { 'hb.category': 'membership' } },
      reminders: { overrides: [], useDefault: true },
      start: { dateTime: '2026-12-01T17:00:00', timeZone: 'Europe/Berlin' },
      summary: '[Membership] Gym',
    })
    expect(gymEvent()?.start).not.toHaveProperty('date')

    google.edit('madeingoogle1', { summary: '[Membership] Gym (renewed)' })
    await pullUntil(page, () => page.getByRole('link', { name: /Gym \(renewed\)/u }).count(), 1)

    google.delete('madeingoogle1')
    await pullUntil(page, () => page.getByRole('link', { name: /Gym/u }).count(), 0)
  })

  await test.step('events put in by hand show as uncategorised and are left alone; repeating events are ignored', async () => {
    await expect(page.getByRole('region', { name: 'Uncategorised' }).getByRole('link', { name: /Grandma/u })).toContainText('2026-12-10')
    await expect(page.getByRole('link', { name: /Yearly/u })).toHaveCount(0)
    expect(google.live().find(event => event.id === 'birthday1')).toEqual(birthday)

    // Moving it in the app turns it into a timed event on the new date, and still adds no category.
    await page.getByRole('link', { name: /Grandma/u }).click()
    await page.getByLabel('Due date (17:00)').fill('2026-12-12')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => google.live().find(event => event.id === 'birthday1')).toMatchObject({
      start: { dateTime: '2026-12-12T17:00:00', timeZone: 'Europe/Berlin' },
      summary: 'Grandma',
    })
    expect(google.live().find(event => event.id === 'birthday1')).not.toHaveProperty('extendedProperties')
  })

  await test.step("an extra date's event in Google never becomes an entry, and a stray one is removed", async () => {
    await expect.poll(() => readDocument(`items/${strayId}`)).toBeNull()
    await expect(page.getByRole('link', { name: /Something|Stray/u })).toHaveCount(0)
    // This app version says so, for the devices that will write date events.
    await expect.poll(async () => (await readDocument(`syncState/${uid}`))?.schema).toEqual({ integerValue: '2' })
  })
})

test('edits racing Google Calendar: a waiting edit, a conflict, an open form catching up, an entry deleted meanwhile', async ({ page }) => {
  const { google } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  await page.getByRole('button', { name: 'Sync now' }).click()
  const titled = (title: string) => google.live().find(event => event.summary === `[Coupon] ${title}`)
  const byId = (id: string) => google.live().find(event => event.id === id)

  await test.step('a local edit waiting to be sent keeps its fields, and takes the others from Google', async () => {
    await page.getByRole('link', { name: 'Add Coupon' }).click()
    await page.getByLabel('Title').fill('Cinema')
    await page.getByLabel('Due date (17:00)').fill('2026-12-24')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => google.live().filter(event => event.summary === '[Coupon] Cinema').length).toBe(1)
    await expect(page.getByText('not yet in Google Calendar')).toHaveCount(0)
    const id = String(titled('Cinema')?.id)

    // Google: someone moves the date. Here: the code is edited, which pulls first, then pushes.
    google.edit(id, { end: { dateTime: '2026-12-27T17:15:00', timeZone: 'Europe/Berlin' }, start: { dateTime: '2026-12-27T17:00:00', timeZone: 'Europe/Berlin' } })
    await page.getByRole('link', { name: /Cinema/u }).click()
    await page.getByLabel('Code').fill('POPCORN')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByRole('link', { name: /Cinema/u })).toContainText('2026-12-27')
    await expect.poll(() => byId(id)).toMatchObject({
      extendedProperties: { private: { 'hb.code': 'POPCORN' } },
      start: { dateTime: '2026-12-27T17:00:00' },
    })
  })

  await test.step('an edit made here keeps a field someone else changed in Google meanwhile', async () => {
    await page.getByRole('link', { name: 'Add Coupon' }).click()
    await page.getByLabel('Title').fill('Shoes')
    await page.getByLabel('Due date (17:00)').fill('2026-12-01')
    await page.getByLabel('Code').fill('OLD10')
    await page.getByLabel('Link').fill('shop.household-brain.test')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => google.live().filter(event => event.summary === '[Coupon] Shoes').length).toBe(1)
    const event = titled('Shoes')
    if (!event) {
      throw new Error('The entry never reached Google')
    }
    const { private: properties } = event.extendedProperties as { private: Record<string, string> }

    // Someone changes the link in Google; this device doesn't hear of it (its reads fail), so it edits
    // the code on an outdated copy, and Google answers the first try with a conflict.
    google.refuseListings(true)
    google.edit(String(event.id), { extendedProperties: { private: { ...properties, 'hb.url': 'https://elsewhere.household-brain.test' } } })
    await page.getByRole('region', { name: 'Coupon' }).getByRole('link', { name: /Shoes/u }).click()
    await page.getByLabel('Code').fill('NEW20')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => (byId(String(event.id))?.extendedProperties as { private: Record<string, string> } | undefined)?.private)
      .toMatchObject({ 'hb.code': 'NEW20', 'hb.url': 'https://elsewhere.household-brain.test' })
    google.refuseListings(false)
  })

  await test.step('an entry opened for editing catches up with Google, keeping what was typed here', async () => {
    await page.getByRole('link', { name: 'Add Coupon' }).click()
    await page.getByLabel('Title').fill('Bakery')
    await page.getByLabel('Due date (17:00)').fill('2026-12-01')
    await page.getByLabel('Code').fill('OLD10')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => google.live().filter(event => event.summary === '[Coupon] Bakery').length).toBe(1)
    const event = titled('Bakery')
    if (!event) {
      throw new Error('The entry never reached Google')
    }

    // Someone changes the code in Google; nothing tells this device until it pulls.
    const { private: properties } = event.extendedProperties as { private: Record<string, string> }
    google.edit(String(event.id), { extendedProperties: { private: { ...properties, 'hb.code': 'NEW20' } } })
    await page.getByRole('region', { name: 'Coupon' }).getByRole('link', { name: /Bakery/u }).click()
    await expect(page.getByLabel('Code')).toHaveValue('NEW20')

    // While the form is open: a field typed in here stays, a field not touched follows Google.
    await page.getByLabel('Title').fill('Bakery Müller')
    google.edit(String(event.id), { extendedProperties: { private: { ...properties, 'hb.code': 'NEWER30' } }, summary: '[Coupon] Bäckerei' })
    await expect.poll(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      return page.getByLabel('Code').inputValue()
    }, { intervals: [250], timeout: 15_000 }).toBe('NEWER30')
    await expect(page.getByLabel('Title')).toHaveValue('Bakery Müller')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => byId(String(event.id))?.summary).toBe('[Coupon] Bakery Müller')
    expect(byId(String(event.id))?.extendedProperties).toMatchObject({ private: { 'hb.code': 'NEWER30' } })
  })

  await test.step('an entry edited here while it was deleted in Google comes back with the edit', async () => {
    await page.getByRole('link', { name: 'Add Coupon' }).click()
    await page.getByLabel('Title').fill('Bagels')
    await page.getByLabel('Due date (17:00)').fill('2026-12-05')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => google.live().filter(event => event.summary === '[Coupon] Bagels').length).toBe(1)
    const id = String(titled('Bagels')?.id)

    // Without listings, no pull can see the deletion before the edit is saved (a pull in between would
    // rightly remove the then-unedited entry). The push itself still finds the event deleted.
    google.refuseListings(true)
    google.delete(id)
    await page.getByRole('link', { name: /Bagels/u }).click()
    await page.getByLabel('Code').fill('CROISSANT')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => byId(id)).toMatchObject({ extendedProperties: { private: { 'hb.code': 'CROISSANT' } }, id, status: 'confirmed' })
    google.refuseListings(false)
    await expect(page.getByRole('link', { name: /Bagels/u })).toHaveCount(1)
  })
})

test('after signing out, the next person sees none of the previous sync problems', async ({ page }) => {
  const { google } = await mockGoogle(page)
  google.refuseListings(true, 400)
  await signInAllowlisted(page, 'owner@household-brain.test')
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByText(/Couldn.t read changes from Google Calendar/u)).toBeVisible()

  // Same page, no reload: only the sign-out may clear what the outbox remembers.
  await openMenu(page)
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Sign out' }).click()
  await signInAs(page, 'spouse@household-brain.test')
  const uid = await page.getByTestId('uid').textContent()
  await allowlist(uid ?? '')
  await expect(page.getByText("You're on the allowlist.")).toBeVisible()
  await expect(page.getByText(/Couldn.t read changes from Google Calendar/u)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
})
