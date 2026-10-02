import { expect, test } from '@playwright/test'
import { resetEmulators, seedDocument } from './emulators'
import { mockGoogle } from './google-mocks'
import { openMenu, signInAllowlisted, signInAs } from './session'

const CALENDAR = 'household@group.calendar.google.test'

test.beforeEach(async () => {
  await resetEmulators()
  await seedDocument('meta/config', { calendarId: CALENDAR, ownerUid: 'owner', timeZone: 'Europe/Berlin' })
  await seedDocument('categories/coupon', { colorId: '6', label: 'Coupon', slug: 'coupon', sortOrder: 1 })
  await seedDocument('categories/membership', { colorId: '3', label: 'Membership', slug: 'membership', sortOrder: 2 })
})

test('an older household gets new default categories and no longer sees unused retired ones; the form stars only required fields', async ({ page }) => {
  await seedDocument('categories/document', { colorId: '8', label: 'Document expiry', slug: 'document', sortOrder: 7 })
  await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  await expect(page.getByRole('region', { name: 'Paperwork' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Document expiry' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Add Paperwork' }).click()
  const stars = page.locator('form label > span').filter({ hasText: '*' })
  await expect(stars).toHaveText(['Title*', 'Category*', 'Due date (17:00)*'])
})

test('an entry is added, edited and deleted, and each change reaches Google Calendar', async ({ page }) => {
  const { google, requests } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  const coupons = page.getByRole('region', { name: 'Coupon' })
  const synced = () => expect(page.getByText('not yet in Google Calendar')).toHaveCount(0)

  // Add, from the category's own "+" so the category is preselected.
  await page.getByRole('link', { name: 'Add Coupon' }).click()
  await page.getByLabel('Title').fill('Amazon')
  await page.getByLabel('Due date (17:00)').fill('2026-11-03')
  await page.getByLabel('Code').fill('SUMMER25')
  // A bare domain is fine; it is stored as a full address.
  await page.getByLabel('Link').fill('shop.household-brain.test')
  await page.getByRole('button', { name: 'Save' }).click()
  // The code shows in the list, under the title.
  await expect(coupons.getByRole('link', { name: /Amazon/u })).toContainText('SUMMER25')
  await expect(coupons.getByRole('link', { name: /Amazon/u })).toContainText('2026-11-03')
  await synced()
  expect(google.live()).toEqual([expect.objectContaining({
    end: { dateTime: '2026-11-03T17:15:00', timeZone: 'Europe/Berlin' },
    extendedProperties: { private: expect.objectContaining({ 'hb.category': 'coupon', 'hb.code': 'SUMMER25', 'hb.url': 'https://shop.household-brain.test' }) },
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
  expect(google.live()[0]).toMatchObject({ start: { dateTime: '2026-11-05T17:00:00' }, summary: '[Coupon] Amazon' })

  // Delete.
  await coupons.getByRole('link', { name: /Amazon/u }).click()
  await page.getByRole('button', { name: 'Delete entry' }).click()
  await expect(coupons.getByRole('link', { name: /Amazon/u })).toHaveCount(0)
  await expect.poll(() => google.live().length).toBe(0)
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

test('a double-tapped Save creates one entry, and deleting it while it syncs removes the event too', async ({ page }) => {
  const { google, requests } = await mockGoogle(page)
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
  expect(google.live().length, requests.map(request => `${request.method} ${request.path}`).join(' | ')).toBe(0)
  // At most one insert: the delete may even win before the entry was ever sent.
  expect(requests.filter(request => request.method === 'POST' && request.path.endsWith('/events')).length).toBeLessThanOrEqual(1)
})

test('a category collapses, shows its open count, and stays collapsed after a reload', async ({ page }) => {
  await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  await page.getByRole('link', { name: 'Add Coupon' }).click()
  await page.getByLabel('Title').fill('Cinema')
  await page.getByLabel('Due date (17:00)').fill('2026-12-01')
  await page.getByRole('button', { name: 'Save' }).click()

  const coupons = page.getByRole('region', { name: 'Coupon' })
  const header = coupons.getByRole('button', { name: /Coupon/u })
  await expect(coupons.getByRole('heading', { name: /Coupon/u })).toBeVisible()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await expect(header).toContainText('1 open')
  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(coupons.getByRole('link', { name: /Cinema/u })).toBeHidden()

  await page.reload()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: 'Membership' }).getByRole('button', { name: /Membership/u })).toHaveAttribute('aria-expanded', 'true')
  await header.click()
  await expect(coupons.getByRole('link', { name: /Cinema/u })).toBeVisible()
})

test('entries say when they are due, and overdue ones stand out', async ({ page }) => {
  await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  const add = async (title: string, dueDate: string) => {
    await page.getByRole('link', { name: 'Add Coupon' }).click()
    await page.getByLabel('Title').fill(title)
    await page.getByLabel('Due date (17:00)').fill(dueDate)
    await page.getByRole('button', { name: 'Save' }).click()
  }
  await add('Old voucher', '2020-01-01')
  await add('Far voucher', '2099-01-01')

  const coupons = page.getByRole('region', { name: 'Coupon' })
  const old = coupons.getByRole('link', { name: /Old voucher/u })
  await expect(old).toContainText(/overdue by \d+ days/u)
  await expect(old).toContainText('2020-01-01')
  await expect(old.getByText(/overdue by/u)).toHaveClass(/text-red/u)
  const far = coupons.getByRole('link', { name: /Far voucher/u })
  await expect(far).toContainText(/in \d+ days/u)
  await expect(far.getByText(/in \d+ days/u)).not.toHaveClass(/text-red|text-amber/u)
})

test('an entry marked done leaves the board until "Show completed", and Google gets the status', async ({ page }) => {
  const { google } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  await page.getByRole('link', { name: 'Add Coupon' }).click()
  await page.getByLabel('Title').fill('Pizza')
  await page.getByLabel('Due date (17:00)').fill('2026-12-01')
  // Adding an entry has no status: a new entry is always open.
  await expect(page.getByLabel('Status')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save' }).click()

  const coupons = page.getByRole('region', { name: 'Coupon' })
  await coupons.getByRole('link', { name: /Pizza/u }).click()
  await page.getByLabel('Status').selectOption('done')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(coupons.getByRole('link', { name: /Pizza/u })).toBeHidden()
  await expect.poll(() => google.live()[0]?.extendedProperties).toMatchObject({ private: { 'hb.status': 'done' } })

  const toggle = page.getByRole('button', { name: 'Show completed (1)' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(coupons.getByRole('link', { name: /Pizza/u })).toContainText('done')
  await toggle.click()
  await expect(coupons.getByRole('link', { name: /Pizza/u })).toBeHidden()
})

test('searching shows only matching entries, in their categories, even folded ones', async ({ page }) => {
  await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  const add = async (category: string, title: string, code: string) => {
    await page.getByRole('link', { name: `Add ${category}` }).click()
    await page.getByLabel('Title').fill(title)
    await page.getByLabel('Due date (17:00)').fill('2026-12-01')
    await page.getByLabel('Code').fill(code)
    await page.getByRole('button', { name: 'Save' }).click()
  }
  await add('Coupon', 'Café Müller', 'COFFEE5')
  await add('Membership', 'Gym', 'FIT2026')

  const coupons = page.getByRole('region', { name: 'Coupon' })
  await coupons.getByRole('button', { name: /Coupon/u }).click()
  const search = page.getByRole('searchbox', { name: 'Search entries' })
  await search.fill('muller')
  await expect(coupons.getByRole('link', { name: /Café Müller/u })).toBeVisible()
  // While searching a category can't be folded, so a tap can't change it unseen.
  await expect(coupons.getByRole('button', { name: /Coupon/u })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Membership' })).toHaveCount(0)

  await search.fill('fit2026')
  await expect(page.getByRole('region', { name: 'Membership' }).getByRole('link', { name: /Gym/u })).toBeVisible()
  await expect(coupons).toHaveCount(0)

  await search.fill('sushi')
  await expect(page.getByText('No entries match “sushi”.')).toBeVisible()

  await search.fill('')
  await expect(page.getByRole('region', { name: 'Membership' })).toBeVisible()
  await expect(coupons.getByRole('link', { name: /Café Müller/u })).toBeHidden()

  // The next person on this device doesn't open a board filtered by someone else's search.
  await search.fill('gym')
  await openMenu(page)
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Sign out' }).click()
  await signInAs(page, 'owner@household-brain.test')
  await expect(page.getByRole('searchbox', { name: 'Search entries' })).toHaveValue('')
})

test('"All by date" lists every entry in one list by due date, labelled with its category', async ({ page }) => {
  await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  const add = async (category: string, title: string, dueDate: string) => {
    await page.getByRole('link', { name: `Add ${category}` }).click()
    await page.getByLabel('Title').fill(title)
    await page.getByLabel('Due date (17:00)').fill(dueDate)
    await page.getByRole('button', { name: 'Save' }).click()
  }
  await add('Coupon', 'Late coupon', '2026-12-20')
  await add('Membership', 'Early gym', '2026-11-05')

  const toggle = page.getByRole('button', { name: 'All by date' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const list = page.getByRole('region', { name: 'All entries by date' })
  await expect(list.getByRole('link')).toHaveText([/Early gym.*Membership/u, /Late coupon.*Coupon/u])
  await expect(page.getByRole('region', { name: 'Coupon' })).toHaveCount(0)

  // Adding works in this view too: its "+" opens the form without a category.
  await list.getByRole('link', { name: 'Add entry' }).click()
  await expect(page.getByLabel('Category')).toHaveValue('')
  await page.getByRole('link', { name: 'Cancel' }).click()

  // Remembered on this device.
  await page.reload()
  await expect(page.getByRole('region', { name: 'All entries by date' })).toBeVisible()
  await page.getByRole('button', { name: 'All by date' }).click()
  await expect(page.getByRole('region', { name: 'Coupon' })).toBeVisible()
})
