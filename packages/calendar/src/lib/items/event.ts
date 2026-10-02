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

/** `[Coupon] Amazon 10€`: the prefix keeps entries readable in Google Calendar itself. */
export function summaryOf(item: Pick<Item, 'title' | 'category'>, categories: readonly Category[]): string {
  const category = labelOf(item, categories)
  return category ? `[${category.label}] ${item.title}` : item.title
}

/** The entry's fields kept in the event's private properties; date events carry them too. */
export function privateProperties(item: Item): Record<string, string> {
  return {
    'hb.amount': item.amount,
    // An uncategorised entry (an event added by hand) stays without one, so it stays untouched.
    ...item.category === 'uncategorised' ? {} : { 'hb.category': item.category },
    'hb.code': item.code,
    'hb.start': item.startDate ?? '',
    'hb.status': item.status,
    'hb.url': item.url,
    'hb.v': '1',
  }
}

const groups = {
  date: (item: Item, { timeZone }: EventContext): CalendarEvent => ({
    // `date: null` turns an all-day event (e.g. one added by hand) into a timed one; Google rejects
    // an event with both.
    end: { date: null, dateTime: `${item.dueDate}T${END_TIME}`, timeZone },
    start: { date: null, dateTime: `${item.dueDate}T${DUE_TIME}`, timeZone },
  }),
  notes: (item: Item): CalendarEvent => ({ description: item.notes }),
  title: (item: Item, { categories }: EventContext): CalendarEvent => ({
    colorId: labelOf(item, categories)?.colorId ?? '8',
    summary: summaryOf(item, categories),
  }),
}

const GROUP_OF: Record<EditableField, (keyof typeof groups)[]> = {
  amount: [],
  category: ['title'],
  code: [],
  dueDate: ['date'],
  notes: ['notes'],
  startDate: [],
  status: [],
  title: ['title'],
  url: [],
}

/** The private property each field is stored in. */
const PROPERTY_OF: Partial<Record<EditableField, string>> = {
  amount: 'hb.amount',
  category: 'hb.category',
  code: 'hb.code',
  startDate: 'hb.start',
  status: 'hb.status',
  url: 'hb.url',
}

/** The full event for a new entry: due 17:00–17:15, and each person's default reminders apply. */
export function eventFor(item: Item, context: EventContext): CalendarEvent {
  // A new event has no all-day date to clear, so the patch-only `date: null` is left out.
  const { start, end } = groups.date(item, context)
  return {
    id: item.id,
    ...groups.title(item, context),
    ...groups.notes(item),
    end: { dateTime: end?.dateTime, timeZone: end?.timeZone },
    extendedProperties: { private: privateProperties(item) },
    reminders: { useDefault: true },
    start: { dateTime: start?.dateTime, timeZone: start?.timeZone },
  }
}

/**
 * Only the private properties of the changed fields. Google merges them key by key, so a property
 * someone else changed in the meantime is left alone, also when a conflict makes the patch go again.
 */
function changedProperties(item: Item, dirty: readonly EditableField[]): CalendarEvent {
  const all = privateProperties(item)
  const keys = dirty.flatMap(field => PROPERTY_OF[field] ?? []).filter(key => key in all)
  if (keys.length === 0) {
    return {}
  }
  return { extendedProperties: { private: { 'hb.v': all['hb.v'] ?? '1', ...Object.fromEntries(keys.map(key => [key, all[key] ?? ''])) } } }
}

/** Only the parts of the event that the changed fields affect, for `events.patch`. */
export function patchFor(item: Item, dirty: readonly EditableField[], context: EventContext): CalendarEvent {
  const touched = new Set(dirty.flatMap(field => GROUP_OF[field]))
  return Object.assign({}, ...[...touched].map(group => groups[group](item, context)), changedProperties(item, dirty)) as CalendarEvent
}
