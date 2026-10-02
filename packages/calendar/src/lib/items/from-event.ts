import type { Category } from '../categories'
import { type CalendarEvent, DUE_TIME, END_TIME, type EventContext, summaryOf } from './event'
import type { ItemDraft } from './model'

const PREFIX = /^\[(?<label>[^\]]+)\]\s*(?<rest>.*)$/u

function prefixCategory(event: CalendarEvent, categories: readonly Category[]) {
  const { label = '', rest = '' } = PREFIX.exec(event.summary ?? '')?.groups ?? {}
  const category = categories.find(entry => label !== '' && entry.label.toLowerCase() === label.trim().toLowerCase())
  return { category, rest }
}

/**
 * The category and title of an event: from `hb.category`, else from a `[Label]` title prefix. A
 * leading `[…]` is only treated as a prefix when it names a category, so "[Draft] Foo" stays whole.
 */
function categoryAndTitle(event: CalendarEvent, categories: readonly Category[]): { category: string, title: string } {
  const { category, rest } = prefixCategory(event, categories)
  const stored = event.extendedProperties?.private?.['hb.category']
  return { category: stored ?? category?.slug ?? 'uncategorised', title: category ? rest : event.summary ?? '' }
}

/** An event someone put into the calendar by hand, without the app's category or a category prefix. */
export function isForeign(event: CalendarEvent, categories: readonly Category[]): boolean {
  return !event.extendedProperties?.private?.['hb.category'] && !prefixCategory(event, categories).category
}

/** Repeating events aren't supported yet: they are left alone entirely. */
export const isRecurring = (event: CalendarEvent) => Boolean(event.recurrence?.length || event.recurringEventId)

/** The calendar date an event falls on, as `YYYY-MM-DD` (its local date for timed events). */
export function dueDateOf(event: CalendarEvent): string {
  return (event.start?.date ?? event.start?.dateTime ?? '').slice(0, 10)
}

/** The entry fields an event carries. */
export function draftFrom(event: CalendarEvent, categories: readonly Category[]): ItemDraft {
  const properties = event.extendedProperties?.private ?? {}
  const status = properties['hb.status']
  return {
    ...categoryAndTitle(event, categories),
    amount: properties['hb.amount'] ?? '',
    code: properties['hb.code'] ?? '',
    dueDate: dueDateOf(event),
    notes: event.description ?? '',
    startDate: properties['hb.start'] ?? '',
    status: status === 'done' || status === 'cancelled' ? status : 'open',
    url: properties['hb.url'] ?? '',
  }
}

// A timed event's dateTime carries an offset ("…T17:00:00+01:00"); only the clock time matters here.
const isAt = (time: CalendarEvent['start'], clock: string, timeZone: string) =>
  time?.timeZone === timeZone && time.dateTime?.slice(10, 19) === `T${clock}`

function timeFix(event: CalendarEvent, draft: ItemDraft, timeZone: string): CalendarEvent {
  return isAt(event.start, DUE_TIME, timeZone) && isAt(event.end, END_TIME, timeZone)
    ? {}
    : {
      // `date: null` clears an all-day date; Google rejects an event with both.
      end: { date: null, dateTime: `${draft.dueDate}T${END_TIME}`, timeZone },
      start: { date: null, dateTime: `${draft.dueDate}T${DUE_TIME}`, timeZone },
    }
}

function categoryFix(event: CalendarEvent, draft: ItemDraft, categories: readonly Category[]): CalendarEvent {
  if (event.extendedProperties?.private?.['hb.category']) {
    return {}
  }
  return {
    colorId: categories.find(entry => entry.slug === draft.category)?.colorId ?? '8',
    extendedProperties: { private: { ...event.extendedProperties?.private, 'hb.category': draft.category, 'hb.v': '1' } },
    summary: summaryOf(draft, categories),
  }
}

/**
 * What an event made or changed directly in Google Calendar needs to fit the app's rules, as an
 * `events.patch` body, or null when it already fits: due 17:00–17:15, the person's own default
 * reminders, and a category with its title prefix and colour.
 */
export function normalisationFor(event: CalendarEvent, draft: ItemDraft, context: EventContext): CalendarEvent | null {
  // Events put into the calendar by hand (a birthday, an appointment) are shown but never rewritten.
  if (isForeign(event, context.categories) || isRecurring(event)) {
    return null
  }
  const patch: CalendarEvent = {
    ...timeFix(event, draft, context.timeZone),
    // Overrides must be cleared explicitly: Google rejects default reminders next to overrides.
    ...event.reminders?.useDefault === true ? {} : { reminders: { overrides: [], useDefault: true } },
    ...categoryFix(event, draft, context.categories),
  }
  return Object.keys(patch).length > 0 ? patch : null
}
