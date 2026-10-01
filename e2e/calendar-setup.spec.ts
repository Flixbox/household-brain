import { expect, test } from '@playwright/test'
import { resetEmulators, seedDocument } from './emulators'
import { mockGoogle } from './google-mocks'
import { signInAllowlisted } from './session'

const TWO_REMINDERS = [{ method: 'popup', minutes: 2880 }, { method: 'popup', minutes: 1440 }]
const call = (request: { method: string, path: string }) => `${request.method} ${request.path}`

test.beforeEach(async () => {
  await resetEmulators()
})

test('the owner creates the household calendar and is told how to share it', async ({ page }) => {
  const { requests } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')

  await expect(page.getByText("The household calendar isn't set up yet.")).toBeVisible()
  await page.getByRole('link', { name: 'Set it up in Settings' }).click()
  await page.getByRole('button', { name: 'Create the household calendar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'The Household Brain calendar is ready' })).toBeVisible()

  expect(requests.map(call)).toEqual([
    'GET /users/me/calendarList',
    'POST /calendars',
    'GET /users/me/calendarList/household@group.calendar.google.test',
    'POST /users/me/calendarList',
  ])
  expect(requests[1].body).toMatchObject({ summary: 'Household Brain', timeZone: 'Europe/Berlin' })
  expect(requests[3].body).toEqual({ defaultReminders: TWO_REMINDERS, id: 'household@group.calendar.google.test' })

  await expect(page.getByRole('heading', { name: 'Share with your household' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Google Calendar settings' })).toHaveAttribute('href', 'https://calendar.google.com/calendar/r/settings')

  await page.getByRole('link', { name: 'Back' }).click()
  await expect(page.getByText("The household calendar isn't set up yet.")).toHaveCount(0)
})

test('a second person connects the shared calendar and gets their own reminders', async ({ page }) => {
  await seedDocument('meta/config', { calendarId: 'shared@group.calendar.google.test', ownerUid: 'someone-else', timeZone: 'Europe/Berlin' })
  const { requests } = await mockGoogle(page)
  await signInAllowlisted(page, 'partner@household-brain.test')

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Share with your household' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Connect my Google Calendar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible()

  expect(requests.map(call)).toEqual([
    'GET /users/me/calendarList/shared@group.calendar.google.test',
    'POST /users/me/calendarList',
  ])
  expect(requests[1].body).toEqual({ defaultReminders: TWO_REMINDERS, id: 'shared@group.calendar.google.test' })

  await page.getByRole('button', { name: 'Connect my Google Calendar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Already connected' })).toBeVisible()
  expect(requests).toHaveLength(3)
})
