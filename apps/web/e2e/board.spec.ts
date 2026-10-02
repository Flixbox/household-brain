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

test('the board: category colours, folding, due dates and start dates', async ({ page }) => {
  const { google } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  const eventTitled = (summary: string) => google.live().find(event => event.summary === summary)

  await test.step('each category has a line down its left in its Google Calendar colour', async () => {
    // Coupon is tangerine (colour 6), Membership grape (colour 3), as their events in Google Calendar.
    await expect(page.getByRole('region', { name: 'Coupon' })).toHaveCSS('border-left-color', 'rgb(244, 81, 30)')
    await expect(page.getByRole('region', { name: 'Membership' })).toHaveCSS('border-left-color', 'rgb(142, 36, 170)')
  })

  await test.step('a category collapses, shows its open count, and stays collapsed after a reload', async () => {
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

  await test.step('entries say when they are due, and overdue ones stand out', async () => {
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

  await test.step('an optional start date shows on the entry, as since or from', async () => {
    await page.getByRole('link', { name: 'Add Membership' }).click()
    await page.getByLabel('Title').fill('Gym')
    await page.getByLabel('Due date (17:00)').fill('2099-08-14')
    await page.getByLabel('Start date (optional)').fill('2020-08-15')
    await page.getByRole('button', { name: 'Save' }).click()

    const gym = page.getByRole('region', { name: 'Membership' }).getByRole('link', { name: /Gym/u })
    await expect(gym).toContainText('since 2020-08-15')
    await expect.poll(() => eventTitled('[Membership] Gym')?.extendedProperties).toMatchObject({ private: { 'hb.start': '2020-08-15' } })

    await gym.click()
    await page.getByLabel('Start date (optional)').fill('2099-01-01')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(gym).toContainText('from 2099-01-01')
  })
})

test('finding entries: all by date, then searching', async ({ page }) => {
  await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')

  await test.step('"All by date" lists every entry in one list by due date, labelled with its category', async () => {
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
    await expect(list.getByRole('listitem')).toHaveText([/Early gym.*Membership/u, /Late coupon.*Coupon/u])
    await expect(page.getByRole('region', { name: 'Coupon' })).toHaveCount(0)

    // A search with no match says so once, not also "no entries".
    await page.getByRole('searchbox', { name: 'Search entries' }).fill('sushi')
    await expect(page.getByText('No entries match “sushi”.')).toBeVisible()
    await expect(page.getByText('No entries yet.')).toHaveCount(0)
    await expect(page.getByText('No open entries.')).toHaveCount(0)
    await page.getByRole('searchbox', { name: 'Search entries' }).fill('')

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

  await test.step('searching shows only matching entries, in their categories, even folded ones', async () => {
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
})

test('done entries: marked done in the form, then swiped with Undo', async ({ page }) => {
  const { google } = await mockGoogle(page)
  await signInAllowlisted(page, 'owner@household-brain.test')
  const pizzaEvent = () => google.live().find(event => String(event.summary).endsWith('Pizza'))

  await test.step('an entry marked done leaves the board until "Show completed", and Google gets the status', async () => {
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
    await expect.poll(() => pizzaEvent()?.extendedProperties).toMatchObject({ private: { 'hb.status': 'done' } })
    // In Google Calendar it says done instead of its category, and no longer reminds this person (each
    // person's device clears their own reminders, which Google keeps per person).
    expect(pizzaEvent()).toMatchObject({ reminders: { overrides: [], useDefault: false }, summary: '[Done] Pizza' })

    const toggle = page.getByRole('button', { name: 'Show completed (1)' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(coupons.getByRole('link', { name: /Pizza/u })).toContainText('done')
    // The app shows its title without the tag.
    await expect(coupons.getByRole('link', { name: /Pizza/u })).not.toContainText('[Done]')
    await toggle.click()
    await expect(coupons.getByRole('link', { name: /Pizza/u })).toBeHidden()

    await test.step('reopened, it has its category and reminders again', async () => {
      await toggle.click()
      await coupons.getByRole('link', { name: /Pizza/u }).click()
      await page.getByLabel('Status').selectOption('open')
      await page.getByRole('button', { name: 'Save' }).click()
      await expect.poll(() => pizzaEvent()?.summary).toBe('[Coupon] Pizza')
      expect(pizzaEvent()).toMatchObject({ reminders: { overrides: [], useDefault: true } })
      // "Show completed" is remembered: switch it off again for what follows. With nothing
      // completed, the chip then goes away.
      const off = page.getByRole('button', { name: 'Show completed (0)' })
      await off.click()
      await expect(off).toHaveCount(0)
    })
  })

  await test.step('swiping an entry left marks it done, with Undo', async () => {
    await page.getByRole('link', { name: 'Add Coupon' }).click()
    await page.getByLabel('Title').fill('Swipe me')
    await page.getByLabel('Due date (17:00)').fill('2026-12-01')
    await page.getByRole('button', { name: 'Save' }).click()

    const row = page.getByRole('region', { name: 'Coupon' }).getByRole('link', { name: /Swipe me/u })
    const swipedEvent = () => google.live().find(event => String(event.summary).endsWith('Swipe me'))
    const swipe = async () => {
      const box = await row.boundingBox()
      if (!box) {
        throw new Error('The entry is not on screen')
      }
      const middle = box.y + box.height / 2
      await page.mouse.move(box.x + box.width - 10, middle)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 160, middle, { steps: 8 })
      await page.mouse.up()
    }
    await swipe()
    await expect(page.getByRole('status').filter({ hasText: 'Marked “Swipe me” done.' })).toBeVisible()
    await expect(row).toBeHidden()
    // A swipe isn't a tap: the board stays, no edit form.
    await expect(page.getByRole('heading', { name: 'Edit entry' })).toHaveCount(0)
    await expect.poll(() => swipedEvent()?.extendedProperties).toMatchObject({ private: { 'hb.status': 'done' } })
    // In Google Calendar it says done instead of its category, and no longer reminds this person (each
    // person's device clears their own reminders, which Google keeps per person).
    expect(swipedEvent()).toMatchObject({ reminders: { overrides: [], useDefault: false }, summary: '[Done] Swipe me' })

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(row).toBeVisible()
    await expect.poll(() => swipedEvent()?.extendedProperties).toMatchObject({ private: { 'hb.status': 'open' } })
    expect(swipedEvent()).toMatchObject({ reminders: { overrides: [], useDefault: true }, summary: '[Coupon] Swipe me' })

    // A press dragged away downwards isn't a tap either: the entry doesn't open.
    const box = await row.boundingBox()
    if (!box) {
      throw new Error('The entry is not on screen')
    }
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 20, box.y + box.height / 2 + 80, { steps: 5 })
    await page.mouse.up()
    await expect(page.getByRole('heading', { name: 'Edit entry' })).toHaveCount(0)

    // A gesture the browser cancels (e.g. it starts scrolling) never marks done, whatever the
    // coordinates on the cancel event.
    await row.dispatchEvent('pointerdown', { clientX: 300, isPrimary: true, pointerId: 7, pointerType: 'touch' })
    await row.dispatchEvent('pointercancel', { clientX: 0, isPrimary: true, pointerId: 7, pointerType: 'touch' })
    await expect(row).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Marked' })).toHaveCount(0)
  })
})
