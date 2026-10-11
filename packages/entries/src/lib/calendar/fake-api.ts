import type { CalendarApi } from './api'

const notFaked = (name: string) => () => Promise.reject(new Error(`${name} isn't faked in this test`))

/**
 * A Calendar API for unit tests: the calls a test gives, and every other one failing loudly, so no
 * test has to cast a partial fake.
 */
export const fakeCalendarApi = (calls: Partial<CalendarApi>): CalendarApi => ({
  deleteEvent: notFaked('deleteEvent'),
  findOwnedCalendars: notFaked('findOwnedCalendars'),
  getEvent: notFaked('getEvent'),
  getListEntry: notFaked('getListEntry'),
  insertCalendar: notFaked('insertCalendar'),
  insertEvent: notFaked('insertEvent'),
  insertListEntry: notFaked('insertListEntry'),
  listEvents: notFaked('listEvents'),
  patchEvent: notFaked('patchEvent'),
  setDefaultReminders: notFaked('setDefaultReminders'),
  ...calls,
})
