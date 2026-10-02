import { type Category, DEFAULT_CATEGORIES } from '@household-brain/calendar/lib/categories'
import type { CalendarApi, Reminder } from './api'

/** The calendar calls household setup needs. */
export type SetupApi = Pick<CalendarApi, 'findOwnedCalendars' | 'getListEntry' | 'insertCalendar' | 'insertListEntry' | 'setDefaultReminders'>

export const CALENDAR_NAME = 'Household Brain'
export const TIME_ZONE = 'Europe/Berlin'

/**
 * Every open entry notifies each person 2 days and 1 day before its 17:00 due time. Reminders are per
 * person in Google Calendar, so these are each person's default notifications on the shared calendar,
 * set by their own device; events use the defaults (`useDefault: true`) unless the entry has reminders
 * of its own (#35).
 */
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
export const createHousehold = async (api: SetupApi, store: HouseholdStore, ownerUid: string): Promise<HouseholdConfig> => {
  let config = await store.config()
  if (!config) {
    // Reuse a calendar left by an earlier attempt (a retry after a failure, or a second tab), so the
    // owner never ends up with two "Household Brain" calendars.
    const [existing] = await api.findOwnedCalendars(CALENDAR_NAME)
    const calendar = existing ?? await api.insertCalendar({
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
export const joinHousehold = async (api: SetupApi, config: HouseholdConfig): Promise<boolean> => {
  const entry = await api.getListEntry(config.calendarId)
  if (!entry) {
    await api.insertListEntry(config.calendarId, [...DEFAULT_REMINDERS])
    return true
  }
  if (sameReminders(entry.defaultReminders)) {
    return false
  }
  await api.setDefaultReminders(config.calendarId, [...DEFAULT_REMINDERS])
  return true
}
