import type { Category } from '../categories'
import { type CalendarEvent, DUE_TIME, END_TIME, type EventContext, summaryOf } from './event'
import type { ItemDraft } from './model'

const PREFIX = /^\[(?<label>[^\]]+)\]\s*(?<rest>.*)$/u

/** The category and title of an event: from `hb.category`, else from a `[Label]` title prefix. */
function categoryAndTitle(event: CalendarEvent, categories: readonly Category[]): { category: string, title: string } {
  const summary = event.summary ?? ''
  const { label = '', rest = '' } = PREFIX.exec(summary)?.groups ?? {}
  const fromPrefix = categories.find(category => label !== '' && category.label.toLowerCase() === label.trim().toLowerCase())
  const title = label !== '' && (fromPrefix || event.extendedProperties?.private?.['hb.category']) ? rest : summary
  const stored = event.extendedProperties?.private?.['hb.category']
  return { category: stored ?? fromPrefix?.slug ?? 'uncategorised', title }
}

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
      end: { dateTime: `${draft.dueDate}T${END_TIME}`, timeZone },
      start: { dateTime: `${draft.dueDate}T${DUE_TIME}`, timeZone },
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
  const patch: CalendarEvent = {
    ...timeFix(event, draft, context.timeZone),
    ...event.reminders?.useDefault === true ? {} : { reminders: { useDefault: true } },
    ...categoryFix(event, draft, context.categories),
  }
  return Object.keys(patch).length > 0 ? patch : null
}
