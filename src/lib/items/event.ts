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

const labelOf = (item: Pick<Item, 'category'>, categories: readonly Category[]) =>
  categories.find(category => category.slug === item.category)

/** `[Coupon] Amazon 10€`: the prefix keeps entries readable in Google Calendar itself. */
export function summaryOf(item: Pick<Item, 'title' | 'category'>, categories: readonly Category[]): string {
  const category = labelOf(item, categories)
  return category ? `[${category.label}] ${item.title}` : item.title
}

function privateProperties(item: Item): Record<string, string> {
  return {
    'hb.amount': item.amount,
    'hb.category': item.category,
    'hb.code': item.code,
    'hb.status': item.status,
    'hb.url': item.url,
    'hb.v': '1',
  }
}

const groups = {
  date: (item: Item, { timeZone }: EventContext): CalendarEvent => ({
    end: { dateTime: `${item.dueDate}T${END_TIME}`, timeZone },
    start: { dateTime: `${item.dueDate}T${DUE_TIME}`, timeZone },
  }),
  notes: (item: Item): CalendarEvent => ({ description: item.notes }),
  properties: (item: Item): CalendarEvent => ({ extendedProperties: { private: privateProperties(item) } }),
  title: (item: Item, { categories }: EventContext): CalendarEvent => ({
    colorId: labelOf(item, categories)?.colorId ?? '8',
    summary: summaryOf(item, categories),
  }),
}

const GROUP_OF: Record<EditableField, (keyof typeof groups)[]> = {
  amount: ['properties'],
  category: ['title', 'properties'],
  code: ['properties'],
  dueDate: ['date'],
  notes: ['notes'],
  status: ['properties'],
  title: ['title'],
  url: ['properties'],
}

/** The full event for a new entry: due 17:00–17:15, and each person's default reminders apply. */
export function eventFor(item: Item, context: EventContext): CalendarEvent {
  return {
    id: item.id,
    ...groups.title(item, context),
    ...groups.notes(item),
    ...groups.date(item, context),
    ...groups.properties(item),
    reminders: { useDefault: true },
  }
}

/** Only the parts of the event that the changed fields affect, for `events.patch`. */
export function patchFor(item: Item, dirty: readonly EditableField[], context: EventContext): CalendarEvent {
  const touched = new Set(dirty.flatMap(field => GROUP_OF[field]))
  return Object.assign({}, ...[...touched].map(group => groups[group](item, context))) as CalendarEvent
}
