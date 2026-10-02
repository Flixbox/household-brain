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
  const dateEventId = String(google.live().find(event => String(event.summary).endsWith('· Cancel by'))?.id)

  await test.step('other edits to a date event in Google Calendar are put back', async () => {
    // In the same session that inserted it, without a reload: putting it back is a new write, not a
    // repeat of the insert the outbox remembers having done.
    google.edit(dateEventId, { summary: 'Renamed in Google' })
    await row.click()
    await expect.poll(summaries).toEqual(['[Membership] Streaming', '[Membership] Streaming · Cancel by'])
    await page.getByRole('link', { name: 'Cancel' }).click()
  })

  await test.step('a date event moved in Google Calendar moves the date in the app', async () => {
    google.edit(dateEventId, {
      end: { dateTime: '2099-11-28T17:15:00+01:00', timeZone: 'Europe/Berlin' },
      start: { dateTime: '2099-11-28T17:00:00+01:00', timeZone: 'Europe/Berlin' },
    })
    await page.reload()
    await expect(row).toContainText('2099-11-28 + more')
    await expect.poll(() => google.live().find(event => event.id === dateEventId)?.start).toMatchObject({ dateTime: '2099-11-28T17:00:00' })
  })

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
  await expect.poll(async () => (await readDocument(`syncState/${uid}`))?.schema).toEqual({ integerValue: '3' })
  // Opening the entry pulls again; then wait until the app has made no Google request for a full
  // second. The outbox acts on its triggers at once, so had the gate been open, the date event would
  // have been written by then (whatever the pull reuse window).
  const isDateInsert = (request: { method: string, body: unknown }) => request.method === 'POST' && JSON.stringify(request.body).includes('Cancel by')
  const opened = requests.length
  await page.getByRole('region', { name: 'Membership' }).getByRole('link', { name: /Streaming/u }).click()
  await expect.poll(() => requests.slice(opened).some(request => request.method === 'GET' && request.path.endsWith('/events'))).toBe(true)
  await expect.poll(async () => {
    const before = requests.length
    await new Promise(resolve => {
      setTimeout(resolve, 1000)
    })
    return requests.length === before
  }, { timeout: 15_000 }).toBe(true)
  expect(requests.some(isDateInsert)).toBe(false)

  // Once that person's app is updated too, the date event follows.
  await seedDocument('syncState/older-app', { schema: 2, syncToken: 'sync-1' })
  await expect.poll(summaries).toEqual(['[Membership] Streaming', '[Membership] Streaming · Cancel by'])
  expect(requests.filter(isDateInsert)).toHaveLength(1)

  await test.step('a date event deleted in Google Calendar removes the date in the app', async () => {
    const row = page.getByRole('region', { name: 'Membership' }).getByRole('link', { name: /Streaming/u })
    await page.goto('/')
    await expect(row).toContainText('2099-11-30 + more')
    google.delete(String(google.live().find(event => String(event.summary).endsWith('· Cancel by'))?.id))
    await page.reload()
    await expect(row).not.toContainText('+ more')
    await expect.poll(summaries).toEqual(['[Membership] Streaming'])
    // Added again, for the next step.
    await row.click()
    // That other app still can't handle an entry's own reminders, so the form doesn't offer them yet.
    await expect(page.getByRole('group', { name: 'Reminders' })).toHaveCount(0)
    await page.getByRole('button', { name: '+ Add date' }).click()
    await page.getByLabel('Label of date 1').fill('Cancel by')
    await page.getByLabel('Date 1', { exact: true }).fill('2099-11-30')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(summaries).toEqual(['[Membership] Streaming', '[Membership] Streaming · Cancel by'])
  })

  await test.step('an entry deleted in Google takes its date event with it', async () => {
    const entryEvent = google.live().find(event => event.summary === '[Membership] Streaming')
    google.delete(String(entryEvent?.id))
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Membership' })).not.toContainText('Streaming')
    await expect.poll(summaries).toEqual([])
  })
})
