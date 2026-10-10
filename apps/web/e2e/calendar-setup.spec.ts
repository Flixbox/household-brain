import { expect, test } from '@playwright/test'
import { resetEmulators } from './emulators'
import { mockGoogle } from './google-mocks'
import { openMenu, signInAllowlisted, signOutWith } from './session'

const TWO_REMINDERS = [{ method: 'popup', minutes: 2880 }, { method: 'popup', minutes: 1440 }]
const CALENDAR = 'household@group.calendar.google.test'
interface Request { method: string, path: string, body: unknown }
/** Calendar-list and calendar calls only; the app also lists events (pulls) as soon as a calendar exists. */
const setupOnly = (requests: Request[]) => requests.filter(request => !request.path.includes('/events'))
const call = (request: Request) => `${request.method} ${request.path}`

test.beforeEach(async () => {
  await resetEmulators()
})

test('setting up: the owner creates the household calendar, then a second person connects it', async ({ page }) => {
  const { requests } = await mockGoogle(page, CALENDAR)

  await test.step('the owner creates the household calendar and is told how to share it', async () => {
    await signInAllowlisted(page, 'owner@household-brain.test')
    await expect(page.getByText("The household calendar isn't set up yet.")).toBeVisible()
    await page.getByRole('link', { name: 'Set it up in Settings' }).click()
    await page.getByRole('button', { name: 'Create the household calendar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'The Household Brain calendar is ready' })).toBeVisible()

    const setup = setupOnly(requests)
    expect(setup.map(call)).toEqual([
      'GET /users/me/calendarList',
      'POST /calendars',
      `GET /users/me/calendarList/${CALENDAR}`,
      'POST /users/me/calendarList',
    ])
    expect(setup[1]?.body).toMatchObject({ summary: 'Household Brain', timeZone: 'Europe/Berlin' })
    expect(setup[3]?.body).toEqual({ defaultReminders: TWO_REMINDERS, id: CALENDAR })

    await expect(page.getByRole('heading', { name: 'Share with your household' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Google Calendar settings' })).toHaveAttribute('href', 'https://calendar.google.com/calendar/r/settings')
    await page.getByRole('link', { name: 'Back' }).click()
    await expect(page.getByText("The household calendar isn't set up yet.")).toHaveCount(0)
    await openMenu(page)
    await signOutWith(page, page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Sign out' }))
  })

  await test.step('a second person connects the shared calendar and gets their own reminders', async () => {
    // Their own Google account: a fresh fake (the newest route handles the calls).
    const partner = await mockGoogle(page, CALENDAR)
    await signInAllowlisted(page, 'partner@household-brain.test')
    await openMenu(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden()
    // Only the owner is shown how to share the calendar.
    await expect(page.getByRole('heading', { name: 'Share with your household' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Connect my Google Calendar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible()

    const setup = setupOnly(partner.requests)
    expect(setup.map(call)).toEqual([`GET /users/me/calendarList/${CALENDAR}`, 'POST /users/me/calendarList'])
    expect(setup[1]?.body).toEqual({ defaultReminders: TWO_REMINDERS, id: CALENDAR })

    await page.getByRole('button', { name: 'Connect my Google Calendar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Already connected' })).toBeVisible()
    expect(setupOnly(partner.requests)).toHaveLength(3)
  })
})
