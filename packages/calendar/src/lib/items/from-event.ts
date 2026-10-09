import { type Category, categoryOfTag } from '@household-brain/calendar/lib/categories'
import { type CalendarEvent, DUE_TIME, END_TIME, type EventContext, STATUS_TAGS, remindersOf, remindersPatch, sameReminders, summaryOf } from './event'
import { remindersFromText } from './reminders'
import { detailsFrom } from './event-details'
import type { ItemDraft } from './model'

const PREFIX = /^\[(?<label>[^\]]+)\]\s*(?<rest>.*)$/u
const STATUS_PREFIX = new RegExp(`^\\[(?:${Object.values(STATUS_TAGS).join('|')})\\]\\s*(?<rest>.*)$`, 'u')

const prefixCategory = (event: CalendarEvent, categories: readonly Category[]) => {
  const { label = '', rest = '' } = PREFIX.exec(event.summary ?? '')?.groups ?? {}
  return { category: categoryOfTag(label, categories), rest }
}

const LEADING_TAG = /^(?<tag>\[(?<label>[^\]]+)\]\s*)(?<rest>.*)$/u

/**
 * A title without the leading tags that name a category: "[Deal] Shop" after "[Coupon]" is "Shop".
 * Unknown tags stay as they were written, also between recognised ones ("[Party] [Deal] Cake" is
 * "[Party] Cake").
 */
const withoutTags = (title: string, categories: readonly Category[]): string => {
  const groups = LEADING_TAG.exec(title)?.groups
  if (!groups) {
    return title
  }
  const rest = withoutTags(groups.rest ?? '', categories)
  return categoryOfTag(groups.label ?? '', categories) ? rest : `${groups.tag ?? ''}${rest}`
}

/** The title after its category tag, without further known tags; one of nothing but those keeps them. */
const titleOf = (tagless: string, categories: readonly Category[]) => {
  const stripped = withoutTags(tagless, categories)
  return stripped.trim() === '' ? tagless : stripped
}

/**
 * The category and title of an event: from `hb.category`, else from a `[Label]` title prefix. A
 * leading `[…]` is only treated as a prefix when it names a category (its label or one of its words),
 * so "[Draft] Foo" stays whole. Further tags that name one go too (`[Coupon] [Deal] …`); unknown
 * ones stay part of the title.
 */
const categoryAndTitle = (event: CalendarEvent, categories: readonly Category[]): { category: string, title: string, tagless: string | null } => {
  const { category, rest } = prefixCategory(event, categories)
  const stored = event.extendedProperties?.private?.['hb.category']
  // A done or cancelled entry's event carries `[Done]` / `[Cancelled]` instead of its category; only
  // then is it a tag (an open entry may well be called "[Done] …").
  const status = event.extendedProperties?.private?.['hb.status']
  const tagged = stored && (status === 'done' || status === 'cancelled') ? STATUS_PREFIX.exec(event.summary ?? '')?.groups?.rest ?? null : null
  const tagless = tagged ?? (category ? rest : null)
  const title = tagless === null ? event.summary ?? '' : titleOf(tagless, categories)
  return { category: stored ?? category?.slug ?? 'uncategorised', tagless, title }
}

/** An event someone put into the calendar by hand, without the app's category or a category prefix. */
const isForeign = (event: CalendarEvent, categories: readonly Category[]): boolean =>
  !event.extendedProperties?.private?.['hb.category'] && !prefixCategory(event, categories).category

/** Repeating events aren't supported yet: they are left alone entirely. */
export const isRecurring = (event: CalendarEvent) => Boolean(event.recurrence?.length || event.recurringEventId)

/** The calendar date an event falls on, as `YYYY-MM-DD` (its local date for timed events). */
export const dueDateOf = (event: CalendarEvent): string =>
  (event.start?.date ?? event.start?.dateTime ?? '').slice(0, 10)

/** An ISO 4217 code another currency is stored as; euros, and anything else, read as ''. */
const currencyOf = (code: string | undefined) => (code && code !== 'EUR' && /^[A-Z]{3}$/u.test(code) ? code : '')

/**
 * An event made outside the app that the app is about to take in (a category prefix, but no category
 * of its own yet): its details come from its description (#83), and `categoryFix` writes them to it.
 */
const isAdopting = (event: CalendarEvent, categories: readonly Category[]) =>
  !event.extendedProperties?.private?.['hb.category'] && Boolean(prefixCategory(event, categories).category)

/** Code, amount, currency, link and notes: from the event's own properties, or for one being taken in, its description. */
const detailFields = (event: CalendarEvent, categories: readonly Category[]) => {
  const properties = event.extendedProperties?.private ?? {}
  const details = isAdopting(event, categories) ? detailsFrom(event.description ?? '') : null
  return {
    amount: properties['hb.amount'] ?? details?.amount ?? '',
    code: properties['hb.code'] ?? details?.code ?? '',
    currency: currencyOf(properties['hb.currency'] ?? details?.currency),
    notes: details?.notes ?? event.description ?? '',
    url: properties['hb.url'] ?? details?.url ?? '',
  }
}

/** The entry fields an event carries. */
export const draftFrom = (event: CalendarEvent, categories: readonly Category[]): ItemDraft => {
  const properties = event.extendedProperties?.private ?? {}
  const status = properties['hb.status']
  const { category, title } = categoryAndTitle(event, categories)
  return {
    category,
    title,
    ...detailFields(event, categories),
    dueDate: dueDateOf(event),
    reminders: remindersFromText(properties['hb.reminders']),
    // Only a `YYYY-MM-DD` date; anything else another client wrote reads as no start date.
    startDate: /^\d{4}-\d{2}-\d{2}$/u.test(properties['hb.start'] ?? '') ? properties['hb.start'] ?? '' : '',
    status: status === 'done' || status === 'cancelled' ? status : 'open',
  }
}

// A timed event's dateTime carries an offset ("…T17:00:00+01:00"); only the clock time matters here.
export const isAt = (time: CalendarEvent['start'], clock: string, timeZone: string) =>
  time?.timeZone === timeZone && time.dateTime?.slice(10, 19) === `T${clock}`

const timeFix = (event: CalendarEvent, draft: ItemDraft, timeZone: string): CalendarEvent =>
  isAt(event.start, DUE_TIME, timeZone) && isAt(event.end, END_TIME, timeZone)
    ? {}
    : {
      // `date: null` clears an all-day date; Google rejects an event with both.
      end: { date: null, dateTime: `${draft.dueDate}T${END_TIME}`, timeZone },
      start: { date: null, dateTime: `${draft.dueDate}T${DUE_TIME}`, timeZone },
    }

/** The details taken from the description, as the event's own properties, so later pulls read them back. */
const detailProperties = (draft: ItemDraft): Record<string, string> => Object.fromEntries([
  ['hb.amount', draft.amount],
  ['hb.code', draft.code],
  ['hb.currency', draft.currency],
  ['hb.url', draft.url],
].filter(([, value]) => value !== ''))

const categoryFix = (event: CalendarEvent, draft: ItemDraft, categories: readonly Category[]): CalendarEvent => {
  if (event.extendedProperties?.private?.['hb.category']) {
    // A further tag that names a category (`[Coupon] [Deal] …`) goes from the event's title too.
    const { tagless, title } = categoryAndTitle(event, categories)
    return tagless !== null && tagless !== title ? { summary: summaryOf(draft, categories) } : {}
  }
  const properties = { ...event.extendedProperties?.private, ...detailProperties(draft), 'hb.category': draft.category, 'hb.v': '1' }
  return {
    colorId: categories.find(entry => entry.slug === draft.category)?.colorId ?? '8',
    // The details now live in their own fields: the description keeps only the rest (#83).
    ...(event.description ?? '') === draft.notes ? {} : { description: draft.notes },
    extendedProperties: { private: properties },
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
export const ownRemindersFix = (event: CalendarEvent, draft: ItemDraft, categories: readonly Category[]): CalendarEvent | null => {
  if (isForeign(event, categories) || isRecurring(event) || remindersFit(event, draft)) {
    return null
  }
  return { reminders: remindersPatch(draft) }
}

/**
 * What an event made or changed directly in Google Calendar needs to fit the app's rules, as an
 * `events.patch` body, or null when it already fits: due 17:00–17:15, the entry's reminders (the
 * person's own defaults unless it has its own; none once done or cancelled), and a category with its
 * title prefix and colour.
 */
export const normalisationFor = (event: CalendarEvent, draft: ItemDraft, context: EventContext): CalendarEvent | null => {
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
