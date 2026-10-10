import { DEFAULT_REMINDERS } from '@household-brain/entries/lib/calendar/setup'

/**
 * An entry's own reminders (#35), kept as text so it travels like the other fields:
 * - '' — the household default, each person's calendar defaults (`useDefault`, 2 days and 1 day);
 * - 'none' — never notifies;
 * - otherwise minutes before the 17:00 due time, largest first: '10080,1440'.
 * Google allows five per event, each up to four weeks ahead.
 */

/** The choices offered, in minutes before 17:00. */
export const REMINDER_CHOICES = [
  { label: '4 weeks', minutes: 4 * 7 * 24 * 60 },
  { label: '2 weeks', minutes: 2 * 7 * 24 * 60 },
  { label: '1 week', minutes: 7 * 24 * 60 },
  { label: '2 days', minutes: 2 * 24 * 60 },
  { label: '1 day', minutes: 24 * 60 },
  { label: 'At 17:00', minutes: 0 },
] as const

export const MAX_REMINDERS = 5
const NONE = 'none'
const LONGEST = 4 * 7 * 24 * 60

const largestFirst = (minutes: readonly number[]) => minutes.toSorted((one, other) => other - one)

const DEFAULT_MINUTES = largestFirst(DEFAULT_REMINDERS.map(reminder => reminder.minutes))

/** The minutes an entry reminds at, largest first; the household default reads as its two reminders. */
export const reminderMinutes = (value: string | undefined): number[] => {
  if (!value) {
    return DEFAULT_MINUTES
  }
  return value === NONE ? [] : value.split(',').map(Number)
}

/**
 * The stored text for a set of reminders: the household default as '', none as 'none'. Anything out of
 * Google's limits is dropped, so a value another client wrote can't break a push.
 */
export const remindersValue = (minutes: readonly number[]): string => {
  const valid = largestFirst([...new Set(minutes)].filter(minute => Number.isInteger(minute) && minute >= 0 && minute <= LONGEST))
    .slice(0, MAX_REMINDERS)
  if (valid.length === 0) {
    return NONE
  }
  return valid.join(',') === DEFAULT_MINUTES.join(',') ? '' : valid.join(',')
}

/**
 * The stored text read from another client (Google's private property), normalised. Anything
 * malformed reads as the household default, also a list whose every time is out of Google's limits:
 * only 'none' itself means never.
 */
export const remindersFromText = (text: string | undefined): string => {
  if (text === 'none') {
    return text
  }
  const value = text && /^\d+(?:,\d+)*$/u.test(text) ? remindersValue(reminderMinutes(text)) : ''
  return value === 'none' ? '' : value
}
