import { isForeign } from './currency'
import { reminderMinutes } from './reminders'
import type { Category } from '../categories'
import type { EditableField, Item } from './model'

export const DUE_TIME = '17:00:00'
export const END_TIME = '17:15:00'

/** Google Calendar event fields the app writes (a subset of the events resource). */
/** A start or end: timed (`dateTime`) or, for all-day events made in Google Calendar, a `date`. */
export interface EventTime {
  dateTime?: string
  /** Null in a patch clears it (needed when turning an all-day event into a timed one). */
  date?: string | null
  timeZone?: string
}

export interface CalendarEvent {
  id?: string
  summary?: string
  description?: string
  colorId?: string
  start?: EventTime
  end?: EventTime
  reminders?: { useDefault: boolean, overrides?: { method: string, minutes: number }[] }
  /** When Google last changed the event (RFC 3339, UTC). */
  updated?: string
  /** Set on the first event of a repeating series. */
  recurrence?: string[]
  /** Set on a single occurrence of a repeating series. */
  recurringEventId?: string
  extendedProperties?: { private?: Record<string, string> }
  etag?: string
  /** "confirmed", "tentative", or "cancelled" for a deleted event. */
  status?: string
}

/** What turning an entry into an event needs besides the entry. */
export interface EventContext {
  timeZone: string
  categories: readonly Category[]
}

export const labelOf = (item: Pick<Item, 'category'>, categories: readonly Category[]) =>
  categories.find(category => category.slug === item.category)

/** The title tag of a done or cancelled entry, which replaces its category's (#43). */
export const STATUS_TAGS = { cancelled: 'Cancelled', done: 'Done' } as const

/**
 * `[Coupon] Amazon 10€`: the prefix keeps entries readable in Google Calendar itself. A done or
 * cancelled entry says so instead: `[Done] Amazon 10€`. An uncategorised one (an event added by hand)
 * keeps its own title.
 */
export const summaryOf = (item: Pick<Item, 'title' | 'category'> & Partial<Pick<Item, 'status'>>, categories: readonly Category[]): string => {
  const category = labelOf(item, categories)
  const tag = category && item.status && item.status !== 'open' ? STATUS_TAGS[item.status] : category?.label
  return tag ? `[${tag}] ${item.title}` : item.title
}

type Reminders = NonNullable<CalendarEvent['reminders']>

/**
 * Open entries remind with each person's defaults, or with the entry's own reminders when it has
 * them (#35); done and cancelled ones don't remind at all.
 */
export const remindersOf = (item: Pick<Item, 'status'> & { reminders?: string }): Reminders => {
  if (item.status !== 'open') {
    return { overrides: [], useDefault: false }
  }
  if (!item.reminders) {
    return { useDefault: true }
  }
  return { overrides: reminderMinutes(item.reminders).map(minutes => ({ method: 'popup', minutes })), useDefault: false }
}

/** The reminders as a write sends them: overrides cleared explicitly, as Google rejects them next to the defaults. */
export const remindersPatch = (item: Pick<Item, 'status'> & { reminders?: string }): Reminders => {
  const { overrides = [], useDefault } = remindersOf(item)
  return { overrides, useDefault }
}

const minutesOf = (reminders: Reminders | undefined) => (reminders?.overrides ?? []).map(reminder => reminder.minutes).toSorted((one, other) => one - other).join(',')

/** Whether a person's reminders on an event are the ones expected (popup or not, only the times count). */
export const sameReminders = (actual: Reminders | undefined, expected: Reminders) =>
  actual?.useDefault === expected.useDefault && minutesOf(actual) === minutesOf(expected)

/** The entry's fields kept in the event's private properties; date events carry them too. */
export const privateProperties = (item: Item): Record<string, string> => (
  {
    'hb.amount': item.amount,
    // An uncategorised entry (an event added by hand) stays without one, so it stays untouched.
    ...item.category === 'uncategorised' ? {} : { 'hb.category': item.category },
    'hb.code': item.code,
    // Like the currency: only when the entry has reminders of its own, so other events stay as they were.
    ...item.reminders ? { 'hb.reminders': item.reminders } : {},
    // Only when it isn't euros, so the events of every other entry stay as they were. Back in euros,
    // a patch of the entry's own event clears it; its extra dates' events keep the old value, which
    // nothing reads back (the entry's own event is the one a pull reads the currency from).
    ...isForeign(item.currency) ? { 'hb.currency': item.currency } : {},
    'hb.start': item.startDate ?? '',
    'hb.status': item.status,
    'hb.url': item.url,
    'hb.v': '1',
  }
)

const groups = {
  date: (item: Item, { timeZone }: EventContext): CalendarEvent => ({
    // `date: null` turns an all-day event (e.g. one added by hand) into a timed one; Google rejects
    // an event with both.
    end: { date: null, dateTime: `${item.dueDate}T${END_TIME}`, timeZone },
    start: { date: null, dateTime: `${item.dueDate}T${DUE_TIME}`, timeZone },
  }),
  notes: (item: Item): CalendarEvent => ({ description: item.notes }),
  // In a patch, overrides are cleared explicitly: Google merges nested fields, and rejects default
  // reminders next to overrides someone added in Google.
  reminders: (item: Item): CalendarEvent => ({ reminders: remindersPatch(item) }),
  // The status tag replaces the category's; an uncategorised event (added by hand) is left alone.
  tag: (item: Item, context: EventContext): CalendarEvent => (item.category === 'uncategorised' ? {} : groups.title(item, context)),
  title: (item: Item, { categories }: EventContext): CalendarEvent => ({
    colorId: labelOf(item, categories)?.colorId ?? '8',
    summary: summaryOf(item, categories),
  }),
}

const GROUP_OF: Record<EditableField, (keyof typeof groups)[]> = {
  amount: [],
  category: ['title'],
  code: [],
  currency: [],
  dueDate: ['date'],
  notes: ['notes'],
  reminders: ['reminders'],
  startDate: [],
  status: ['tag', 'reminders'],
  title: ['title'],
  url: [],
}

/** The private property each field is stored in. */
const PROPERTY_OF: Partial<Record<EditableField, string>> = {
  amount: 'hb.amount',
  category: 'hb.category',
  code: 'hb.code',
  currency: 'hb.currency',
  reminders: 'hb.reminders',
  startDate: 'hb.start',
  status: 'hb.status',
  url: 'hb.url',
}

/** The full event for a new entry: due 17:00–17:15, reminding while open (`remindersOf`). */
export const eventFor = (item: Item, context: EventContext): CalendarEvent => {
  // A new event has no all-day date to clear, so the patch-only `date: null` is left out.
  const { start, end } = groups.date(item, context)
  return {
    id: item.id,
    ...groups.title(item, context),
    ...groups.notes(item),
    end: { dateTime: end?.dateTime, timeZone: end?.timeZone },
    extendedProperties: { private: privateProperties(item) },
    reminders: remindersOf(item),
    start: { dateTime: start?.dateTime, timeZone: start?.timeZone },
  }
}

/**
 * Only the private properties of the changed fields. Google merges them key by key, so a property
 * someone else changed in the meantime is left alone, also when a conflict makes the patch go again.
 */
const changedProperties = (item: Item, dirty: readonly EditableField[]): CalendarEvent => {
  const all = privateProperties(item)
  // An uncategorised entry leaves the event's category alone; any other property left out is cleared.
  const keys = dirty.flatMap(field => PROPERTY_OF[field] ?? []).filter(key => key in all || key !== 'hb.category')
  if (keys.length === 0) {
    return {}
  }
  return { extendedProperties: { private: { 'hb.v': all['hb.v'] ?? '1', ...Object.fromEntries(keys.map(key => [key, all[key] ?? ''])) } } }
}

/** Only the parts of the event that the changed fields affect, for `events.patch`. */
export const patchFor = (item: Item, dirty: readonly EditableField[], context: EventContext): CalendarEvent => {
  const touched = new Set(dirty.flatMap(field => GROUP_OF[field]))
  return Object.assign({}, ...[...touched].map(group => groups[group](item, context)), changedProperties(item, dirty)) as CalendarEvent
}
