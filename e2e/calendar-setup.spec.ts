import { expect, test } from '@playwright/test'
import { resetEmulators, seedDocument } from './emulators'
import { mockGoogle } from './google-mocks'
import { signInAllowlisted } from './session'

const TWO_REMINDERS = { defaultReminders: [{ method: 'popup', minutes: 2880 }, { method: 'popup', minutes: 1440 }] }

test.beforeEach(async () => {
  await resetEmulators()
})

test('the owner creates the household calendar and shares it', async ({ page }) => {
  const requests = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')

  await expect(page.getByText("The household calendar isn't set up yet.")).toBeVisible()
  await page.getByRole('link', { name: 'Set it up in Settings' }).click()
  await page.getByRole('button', { name: 'Create the household calendar' }).click()
  await expect(page.getByRole('status')).toContainText('The Household Brain calendar is ready')

  expect(requests).toContainEqual({
    body: expect.objectContaining({ summary: 'Household Brain', timeZone: 'Europe/Berlin' }),
    method: 'POST',
    path: '/calendars',
  })
  expect(requests).toContainEqual({ body: TWO_REMINDERS, method: 'PATCH', path: '/users/me/calendarList/household@group.calendar.google.test' })

  await page.getByRole('textbox', { name: 'Google account email' }).fill('partner@household-brain.test')
  await page.getByRole('button', { name: 'Share' }).click()
  await expect(page.getByRole('status').last()).toContainText('Shared with partner@household-brain.test')
  expect(requests).toContainEqual({
    body: { role: 'writer', scope: { type: 'user', value: 'partner@household-brain.test' } },
    method: 'POST',
    path: '/calendars/household@group.calendar.google.test/acl',
  })

  await page.getByRole('link', { name: 'Back' }).click()
  await expect(page.getByText("The household calendar isn't set up yet.")).toHaveCount(0)
})

test('a second person connects the shared calendar and gets their own reminders', async ({ page }) => {
  await seedDocument('meta/config', { calendarId: 'shared@group.calendar.google.test', ownerUid: 'someone-else', timeZone: 'Europe/Berlin' })
  const requests = await mockGoogle(page)
  await signInAllowlisted(page, 'partner@household-brain.test')

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Share with' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Connect my Google Calendar' }).click()
  await expect(page.getByRole('status')).toContainText('Connected')

  expect(requests.map(request => `${request.method} ${request.path}`)).toEqual([
    'GET /users/me/calendarList/shared@group.calendar.google.test',
    'POST /users/me/calendarList',
    'PATCH /users/me/calendarList/shared@group.calendar.google.test',
  ])
  expect(requests[2].body).toEqual(TWO_REMINDERS)
})
