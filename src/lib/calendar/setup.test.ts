import { describe, expect, it } from 'vitest'
import { type Category, DEFAULT_CATEGORIES } from '../categories'
import type { CalendarApi, CalendarListEntry, Reminder } from './api'
import { CALENDAR_NAME, DEFAULT_REMINDERS, type HouseholdConfig, type HouseholdStore, TIME_ZONE, createHousehold, joinHousehold } from './setup'

function fakeApi(listEntries: Record<string, CalendarListEntry> = {}) {
  const calls: string[] = []
  const api: CalendarApi = {
    getListEntry: async id => {
      calls.push(`get ${id}`)
      return listEntries[id] ?? null
    },
    insertCalendar: async calendar => {
      calls.push(`create ${calendar.summary} ${calendar.timeZone}`)
      return { id: 'cal-1' }
    },
    insertListEntry: async id => {
      calls.push(`add ${id}`)
      listEntries[id] = { id }
      return listEntries[id]
    },
    setDefaultReminders: async (id, reminders: Reminder[]) => {
      calls.push(`reminders ${id} ${reminders.map(reminder => reminder.minutes).join(',')}`)
    },
    shareCalendar: async (id, email) => {
      calls.push(`share ${id} ${email}`)
    },
  }
  return { api, calls }
}

function fakeStore(initial: HouseholdConfig | null = null, categories: readonly Category[] = []) {
  const state = { categories: [...categories], config: initial }
  const store: HouseholdStore = {
    config: async () => state.config,
    hasCategories: async () => state.categories.length > 0,
    saveCategories: async next => {
      state.categories = [...next]
    },
    saveConfig: async config => {
      state.config = config
    },
  }
  return { state, store }
}

describe('createHousehold', () => {
  it('creates the calendar, stores it, seeds categories and sets the owner reminders', async () => {
    const { api, calls } = fakeApi()
    const { state, store } = fakeStore()

    const config = await createHousehold(api, store, 'owner-uid')

    expect(config).toEqual({ calendarId: 'cal-1', ownerUid: 'owner-uid', timeZone: TIME_ZONE })
    expect(state.config).toEqual(config)
    expect(state.categories).toEqual(DEFAULT_CATEGORIES)
    expect(calls).toEqual([`create ${CALENDAR_NAME} Europe/Berlin`, 'get cal-1', 'add cal-1', 'reminders cal-1 2880,1440'])
  })

  it('reuses an existing calendar and leaves edited categories alone', async () => {
    const existing = { calendarId: 'cal-9', ownerUid: 'owner-uid', timeZone: TIME_ZONE }
    const custom: Category[] = [{ colorId: '1', label: 'Mine', slug: 'mine', sortOrder: 1 }]
    const { api, calls } = fakeApi({ 'cal-9': { defaultReminders: [...DEFAULT_REMINDERS], id: 'cal-9' } })
    const { state, store } = fakeStore(existing, custom)

    await createHousehold(api, store, 'owner-uid')

    expect(calls).toEqual(['get cal-9'])
    expect(state.categories).toEqual(custom)
  })
})

describe('joinHousehold', () => {
  const config = { calendarId: 'cal-1', ownerUid: 'owner-uid', timeZone: TIME_ZONE }

  it('adds the shared calendar to the member list and sets their reminders', async () => {
    const { api, calls } = fakeApi()
    expect(await joinHousehold(api, config)).toBe(true)
    expect(calls).toEqual(['get cal-1', 'add cal-1', 'reminders cal-1 2880,1440'])
  })

  it('resets reminders that someone changed', async () => {
    const { api, calls } = fakeApi({ 'cal-1': { defaultReminders: [{ method: 'popup', minutes: 30 }], id: 'cal-1' } })
    expect(await joinHousehold(api, config)).toBe(true)
    expect(calls).toEqual(['get cal-1', 'reminders cal-1 2880,1440'])
  })

  it('changes nothing when everything is already right', async () => {
    const { api, calls } = fakeApi({ 'cal-1': { defaultReminders: [...DEFAULT_REMINDERS].reverse(), id: 'cal-1' } })
    expect(await joinHousehold(api, config)).toBe(false)
    expect(calls).toEqual(['get cal-1'])
  })
})
