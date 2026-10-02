import { expect, test } from '@playwright/test'
import { readDocument, resetEmulators, seedDocument } from './emulators'
import { mockGoogle } from './google-mocks'
import { signInAllowlisted } from './session'

const CALENDAR = 'household@group.calendar.google.test'

test.beforeEach(async () => {
  await resetEmulators()
  await seedDocument('meta/config', { calendarId: CALENDAR, ownerUid: 'owner', timeZone: 'Europe/Berlin' })
  await seedDocument('categories/membership', { colorId: '3', label: 'Membership', slug: 'membership', sortOrder: 2 })
})

test('an entry can have more dates; the list shows the next one with "+ more"', async ({ page }) => {
  const { google } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  await page.getByRole('link', { name: 'Add Membership' }).click()
  await page.getByLabel('Title').fill('Streaming')
  await page.getByLabel('Due date (17:00)').fill('2099-12-14')
  await page.getByRole('button', { name: '+ Add date' }).click()
  await page.getByLabel('Label of date 1').fill('Cancel by')
  await page.getByLabel('Date 1', { exact: true }).fill('2099-11-30')
  await page.getByRole('button', { name: 'Save' }).click()

  const row = page.getByRole('region', { name: 'Membership' }).getByRole('link', { name: /Streaming/u })
  await expect(row).toContainText('2099-11-30 + more')
  await expect(row).toContainText(/in \d+ days \+ more/u)
  // The extra date gets its own Google Calendar event, once this app has marked itself as one that
  // recognises them (on its first pull).
  const summaries = () => google.live().map(event => event.summary).toSorted()
  await expect.poll(summaries).toEqual(['[Membership] Streaming', '[Membership] Streaming · Cancel by'])

  // Kept across a reload, and editable: removing it leaves just the due date.
  await page.reload()
  await row.click()
  await expect(page.getByLabel('Label of date 1')).toHaveValue('Cancel by')
  await page.getByRole('button', { name: 'Remove date 1' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(row).toContainText('2099-12-14')
  await expect(row).not.toContainText('+ more')
  await expect.poll(summaries).toEqual(['[Membership] Streaming'])
})

test("while someone's app doesn't know date events yet, extra dates stay out of Google", async ({ page }) => {
  // Another person whose app synced but predates date events: no schema marker.
  await seedDocument('syncState/older-app', { syncToken: 'sync-1' })
  const { google, requests } = await mockGoogle(page)
  const uid = await signInAllowlisted(page, 'owner@household-brain.test')
  await page.getByRole('link', { name: 'Add Membership' }).click()
  await page.getByLabel('Title').fill('Streaming')
  await page.getByLabel('Due date (17:00)').fill('2099-12-14')
  await page.getByRole('button', { name: '+ Add date' }).click()
  await page.getByLabel('Label of date 1').fill('Cancel by')
  await page.getByLabel('Date 1', { exact: true }).fill('2099-11-30')
  await page.getByRole('button', { name: 'Save' }).click()
  const summaries = () => google.live().map(event => event.summary).toSorted()
  await expect.poll(summaries).toEqual(['[Membership] Streaming'])
  await expect.poll(async () => (await readDocument(`syncState/${uid}`))?.schema).toEqual({ integerValue: '2' })
  // Opening the entry pulls again. Outbox steps run one at a time, so once a pull after the entry's
  // insert has gone out, the step that would have written the date event (had the gate been open)
  // is over.
  const isDateInsert = (request: { method: string, body: unknown }) => request.method === 'POST' && JSON.stringify(request.body).includes('Cancel by')
  const entryInsert = requests.findIndex(request => request.method === 'POST' && JSON.stringify(request.body).includes('Streaming'))
  await page.getByRole('region', { name: 'Membership' }).getByRole('link', { name: /Streaming/u }).click()
  await expect.poll(() => requests.slice(entryInsert + 1).some(request => request.method === 'GET' && request.path.endsWith('/events'))).toBe(true)
  expect(requests.some(isDateInsert)).toBe(false)

  // Once that person's app is updated too, the date event follows.
  await seedDocument('syncState/older-app', { schema: 2, syncToken: 'sync-1' })
  await expect.poll(summaries).toEqual(['[Membership] Streaming', '[Membership] Streaming · Cancel by'])
  expect(requests.filter(isDateInsert)).toHaveLength(1)

  await test.step('an entry deleted in Google takes its date event with it', async () => {
    const entryEvent = google.live().find(event => event.summary === '[Membership] Streaming')
    google.delete(String(entryEvent?.id))
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Membership' })).not.toContainText('Streaming')
    await expect.poll(summaries).toEqual([])
  })
})
