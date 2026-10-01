import { type Category, DEFAULT_CATEGORIES } from '../categories'
import type { CalendarApi, Reminder } from './api'

export const CALENDAR_NAME = 'Household Brain'
export const TIME_ZONE = 'Europe/Berlin'

/** Every entry notifies each person 2 days and 1 day before its 17:00 due time (README section 4.1). */
export const DEFAULT_REMINDERS: readonly Reminder[] = [
  { method: 'popup', minutes: 2 * 24 * 60 },
  { method: 'popup', minutes: 24 * 60 },
]

export interface HouseholdConfig {
  calendarId: string
  timeZone: string
  ownerUid: string
}

/** Where the household's shared settings live (Firestore in the app, an in-memory fake in tests). */
export interface HouseholdStore {
  config: () => Promise<HouseholdConfig | null>
  saveConfig: (config: HouseholdConfig) => Promise<void>
  hasCategories: () => Promise<boolean>
  saveCategories: (categories: readonly Category[]) => Promise<void>
}

/**
 * Owner setup: creates the household calendar once and seeds the categories. Running it again is
 * harmless: an existing calendar is reused and existing categories are left alone.
 */
export async function createHousehold(api: CalendarApi, store: HouseholdStore, ownerUid: string): Promise<HouseholdConfig> {
  let config = await store.config()
  if (!config) {
    const calendar = await api.insertCalendar({
      description: 'Due dates kept by the Household Brain app. Entries are due at 17:00.',
      summary: CALENDAR_NAME,
      timeZone: TIME_ZONE,
    })
    config = { calendarId: calendar.id, ownerUid, timeZone: TIME_ZONE }
    await store.saveConfig(config)
  }
  if (!await store.hasCategories()) {
    await store.saveCategories(DEFAULT_CATEGORIES)
  }
  await joinHousehold(api, config)
  return config
}

const sameReminders = (actual: readonly Reminder[] | undefined) =>
  actual?.length === DEFAULT_REMINDERS.length
  && DEFAULT_REMINDERS.every(wanted => actual.some(reminder => reminder.method === wanted.method && reminder.minutes === wanted.minutes))

/**
 * Per person, on their own device: makes sure the household calendar is in their calendar list and
 * that *their* default notifications on it are the two reminders. Reminders are per person in Google
 * Calendar, so the owner's settings never notify anyone else. Returns whether anything changed.
 */
export async function joinHousehold(api: CalendarApi, config: HouseholdConfig): Promise<boolean> {
  let changed = false
  let entry = await api.getListEntry(config.calendarId)
  if (!entry) {
    entry = await api.insertListEntry(config.calendarId)
    changed = true
  }
  if (!sameReminders(entry.defaultReminders)) {
    await api.setDefaultReminders(config.calendarId, [...DEFAULT_REMINDERS])
    changed = true
  }
  return changed
}
