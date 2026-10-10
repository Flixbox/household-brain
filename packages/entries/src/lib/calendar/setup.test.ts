import { describe, expect, it } from 'vitest'
import { type Category, DEFAULT_CATEGORIES } from '@household-brain/entries/lib/categories'
import type { CalendarListEntry, Reminder } from './api'
import { CALENDAR_NAME, DEFAULT_REMINDERS, type HouseholdConfig, type HouseholdStore, type SetupApi, TIME_ZONE, createHousehold, joinHousehold } from './setup'

const fakeApi = (listEntries: Record<string, CalendarListEntry> = {}, owned: CalendarListEntry[] = []) => {
  const calls: string[] = []
  const api: SetupApi = {
    findOwnedCalendars: async summary => {
      calls.push(`find ${summary}`)
      return owned
    },
    getListEntry: async id => {
      calls.push(`get ${id}`)
      return listEntries[id] ?? null
    },
    insertCalendar: async calendar => {
      calls.push(`create ${calendar.summary} ${calendar.timeZone}`)
      return { id: 'cal-1' }
    },
    insertListEntry: async (id, reminders: Reminder[]) => {
      calls.push(`add ${id} ${reminders.map(reminder => reminder.minutes).join(',')}`)
      listEntries[id] = { defaultReminders: reminders, id }
      return listEntries[id]
    },
    setDefaultReminders: async (id, reminders: Reminder[]) => {
      calls.push(`reminders ${id} ${reminders.map(reminder => reminder.minutes).join(',')}`)
    },
  }
  return { api, calls }
}

const fakeStore = (initial: HouseholdConfig | null = null, categories: readonly Category[] = []) => {
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
    expect(calls).toEqual([`find ${CALENDAR_NAME}`, `create ${CALENDAR_NAME} Europe/Berlin`, 'get cal-1', 'add cal-1 2880,1440'])
  })

  it('adopts a Household Brain calendar left by an earlier attempt instead of creating a second one', async () => {
    const { api, calls } = fakeApi({}, [{ accessRole: 'owner', id: 'cal-old', summary: CALENDAR_NAME }])
    const { state, store } = fakeStore()

    await createHousehold(api, store, 'owner-uid')

    expect(state.config?.calendarId).toBe('cal-old')
    expect(calls).toEqual([`find ${CALENDAR_NAME}`, 'get cal-old', 'add cal-old 2880,1440'])
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
    expect(calls).toEqual(['get cal-1', 'add cal-1 2880,1440'])
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
