import type { Category } from '../categories'
import { type CalendarEvent, DUE_TIME, END_TIME, type EventContext, STATUS_TAGS, remindersOf, remindersPatch, sameReminders, summaryOf } from './event'
import { remindersFromText } from './reminders'
import type { ItemDraft } from './model'

const PREFIX = /^\[(?<label>[^\]]+)\]\s*(?<rest>.*)$/u
const STATUS_PREFIX = new RegExp(`^\\[(?:${Object.values(STATUS_TAGS).join('|')})\\]\\s*(?<rest>.*)$`, 'u')

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
  // A done or cancelled entry's event carries `[Done]` / `[Cancelled]` instead of its category; only
  // then is it a tag (an open entry may well be called "[Done] …").
  const status = event.extendedProperties?.private?.['hb.status']
  const tagged = stored && (status === 'done' || status === 'cancelled') ? STATUS_PREFIX.exec(event.summary ?? '')?.groups?.rest ?? null : null
  const title = tagged ?? (category ? rest : event.summary ?? '')
  return { category: stored ?? category?.slug ?? 'uncategorised', title }
}

/** An event someone put into the calendar by hand, without the app's category or a category prefix. */
function isForeign(event: CalendarEvent, categories: readonly Category[]): boolean {
  return !event.extendedProperties?.private?.['hb.category'] && !prefixCategory(event, categories).category
}

/** Repeating events aren't supported yet: they are left alone entirely. */
export const isRecurring = (event: CalendarEvent) => Boolean(event.recurrence?.length || event.recurringEventId)

/** The calendar date an event falls on, as `YYYY-MM-DD` (its local date for timed events). */
export function dueDateOf(event: CalendarEvent): string {
  return (event.start?.date ?? event.start?.dateTime ?? '').slice(0, 10)
}

/** An ISO 4217 code another currency is stored as; euros, and anything else, read as ''. */
const currencyOf = (code: string | undefined) => (code && code !== 'EUR' && /^[A-Z]{3}$/u.test(code) ? code : '')

/** The entry fields an event carries. */
export function draftFrom(event: CalendarEvent, categories: readonly Category[]): ItemDraft {
  const properties = event.extendedProperties?.private ?? {}
  const status = properties['hb.status']
  return {
    ...categoryAndTitle(event, categories),
    amount: properties['hb.amount'] ?? '',
    code: properties['hb.code'] ?? '',
    currency: currencyOf(properties['hb.currency']),
    dueDate: dueDateOf(event),
    notes: event.description ?? '',
    reminders: remindersFromText(properties['hb.reminders']),
    // Only a `YYYY-MM-DD` date; anything else another client wrote reads as no start date.
    startDate: /^\d{4}-\d{2}-\d{2}$/u.test(properties['hb.start'] ?? '') ? properties['hb.start'] ?? '' : '',
    status: status === 'done' || status === 'cancelled' ? status : 'open',
    url: properties['hb.url'] ?? '',
  }
}

// A timed event's dateTime carries an offset ("…T17:00:00+01:00"); only the clock time matters here.
export const isAt = (time: CalendarEvent['start'], clock: string, timeZone: string) =>
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

/** The entry's reminders (or the defaults) while open; none at all once done or cancelled (#43). */
const remindersFit = (event: CalendarEvent, draft: ItemDraft) => sameReminders(event.reminders, remindersOf(draft))

/**
 * Google keeps reminders per person, so the other person's push of a done entry, or of new reminders,
 * changed only theirs: this person's reminders on the event, as a patch, or null when they already fit.
 * Events added by hand and repeating ones are left alone.
 */
export function ownRemindersFix(event: CalendarEvent, draft: ItemDraft, categories: readonly Category[]): CalendarEvent | null {
  if (isForeign(event, categories) || isRecurring(event) || remindersFit(event, draft)) {
    return null
  }
  return { reminders: remindersPatch(draft) }
}

/**
 * What an event made or changed directly in Google Calendar needs to fit the app's rules, as an
 * `events.patch` body, or null when it already fits: due 17:00–17:15, the person's own default
 * reminders (none once done or cancelled), and a category with its title prefix and colour.
 */
export function normalisationFor(event: CalendarEvent, draft: ItemDraft, context: EventContext): CalendarEvent | null {
  // Events put into the calendar by hand (a birthday, an appointment) are shown but never rewritten.
  if (isForeign(event, context.categories) || isRecurring(event)) {
    return null
  }
  const patch: CalendarEvent = {
    ...timeFix(event, draft, context.timeZone),
    ...remindersFit(event, draft) ? {} : { reminders: remindersPatch(draft) },
    ...categoryFix(event, draft, context.categories),
  }
  return Object.keys(patch).length > 0 ? patch : null
}
