import { type InferOutput, check, forward, object, partialCheck, picklist, pipe, safeParse, string } from 'valibot'
import { PLAIN_NUMBER } from './amount'
import { isDate } from './dates'
import { INTERVALS } from './interval'
import { LINK_PATTERN } from './link'

const STATUSES = ['open', 'done', 'cancelled'] as const
const LINK = new RegExp(`^(?:${LINK_PATTERN})$`, 'u')
const CURRENCY = /^[A-Z]{3}$/u

/** A real calendar date as `YYYY-MM-DD` (not 2026-02-30). */
const isCalendarDate = (value: string): boolean => {
  if (!isDate(value)) {
    return false
  }
  try {
    Temporal.PlainDate.from(value, { overflow: 'reject' })
    return true
  } catch {
    return false
  }
}

/** The checks every entry passes before it is saved; the schema below and `repairedDraft` share them. */
const fits = {
  amount: (value: string) => value === '' || PLAIN_NUMBER.test(value),
  category: (value: string) => value !== '',
  currency: (value: string) => value === '' || CURRENCY.test(value),
  date: (value: string) => value === '' || isCalendarDate(value),
  interval: (value: string) => value === '' || INTERVALS.some(interval => interval.value === value),
  title: (value: string) => value.trim() !== '',
  url: (value: string) => value === '' || LINK.test(value),
}

const startsInTime = ({ dueDate, startDate }: { dueDate: string, startDate: string }) =>
  startDate === '' || dueDate === '' || startDate <= dueDate

/**
 * The editable fields of an entry, with the rules the form enforces: a title, a category, real
 * dates, a start date not after the due date, a plain amount and a web address (#194). Every way
 * into the app (the form, Google Calendar, the Google Tasks inbox) is checked against it.
 */
export const draftSchema = pipe(
  object({
    /** A plain number such as `9.99`, or '' for none. */
    amount: pipe(string(), check(fits.amount, 'Enter the amount as a number, e.g. 9.99')),
    category: pipe(string(), check(fits.category, 'Choose a category')),
    code: string(),
    /** The amount's currency: an ISO 4217 code such as `BRL`, or '' for euros. */
    currency: pipe(string(), check(fits.currency, 'Choose a currency')),
    /** `YYYY-MM-DD`, always due at 17:00 Europe/Berlin; '' for an entry that never expires. */
    dueDate: pipe(string(), check(fits.date, 'Enter a real due date')),
    /** How often the amount is due (`interval.ts`): '' for a one-off price. */
    interval: pipe(string(), check(fits.interval, 'Choose how often it is due')),
    notes: string(),
    /** The entry's own reminders as text (`reminders.ts`): '' for the household default. */
    reminders: string(),
    /** `YYYY-MM-DD` it started or becomes valid (a membership's start, a coupon's first day); '' if none. */
    startDate: pipe(string(), check(fits.date, 'Enter a real start date')),
    status: picklist(STATUSES, 'Choose a status'),
    title: pipe(string(), check(fits.title, 'Enter a title')),
    url: pipe(string(), check(fits.url, 'Enter a web address, e.g. example.de')),
  }),
  forward(partialCheck([['dueDate'], ['startDate']], startsInTime, 'The start date can’t be after the due date'), ['startDate']),
)

export type ItemDraft = InferOutput<typeof draftSchema>

/** What is wrong with a draft, one message per problem; empty when it may be saved. */
export const draftProblems = (draft: ItemDraft): string[] => {
  const result = safeParse(draftSchema, draft)
  return result.success ? [] : result.issues.map(issue => issue.message)
}

/** The draft itself, or an error naming what is wrong: the save functions refuse a draft that fails. */
export const checkedDraft = (draft: ItemDraft): ItemDraft => {
  const problems = draftProblems(draft)
  if (problems.length > 0) {
    throw new Error(`Not saved: ${problems.join('; ')}`)
  }
  return draft
}

const withNote = (notes: string, label: string, value: string) => [notes, `${label}: ${value}`].filter(Boolean).join('\n')

/** A field the schema doesn't take, moved into the notes so nothing typed is lost. */
const intoNotes = (field: 'amount' | 'dueDate' | 'startDate' | 'url', label: string) => (draft: ItemDraft): Partial<ItemDraft> =>
  ({ [field]: '', notes: withNote(draft.notes, label, draft[field]) })

/** Each repair, in order: the start date is checked against the due date as already repaired. */
const REPAIRS: readonly { fails: (draft: ItemDraft) => boolean, fix: (draft: ItemDraft) => Partial<ItemDraft>, says: string }[] = [
  { fails: draft => !fits.title(draft.title), fix: () => ({ title: 'Untitled' }), says: 'blank title: "Untitled"' },
  { fails: draft => !fits.category(draft.category), fix: () => ({ category: 'uncategorised' }), says: 'no category: "uncategorised"' },
  { fails: draft => !fits.date(draft.dueDate), fix: intoNotes('dueDate', 'Due date'), says: 'due date not a date: moved to the notes' },
  {
    fails: draft => !fits.date(draft.startDate) || !startsInTime(draft),
    fix: intoNotes('startDate', 'Start date'),
    says: 'start date not a date or after the due date: moved to the notes',
  },
  { fails: draft => !fits.amount(draft.amount), fix: intoNotes('amount', 'Amount'), says: 'amount not a number: moved to the notes' },
  { fails: draft => !fits.currency(draft.currency), fix: () => ({ currency: '' }), says: 'unknown currency: euros' },
  { fails: draft => !fits.interval(draft.interval), fix: () => ({ interval: '' }), says: 'unknown interval: one-off' },
  { fails: draft => !fits.url(draft.url), fix: intoNotes('url', 'Link'), says: 'link not a web address: moved to the notes' },
]

/**
 * A draft from Google (a Calendar event, a Tasks inbox note) made to pass the schema instead of
 * being refused, so an event never loses its entry. Nothing typed is thrown away: a date, link or
 * amount the schema doesn't take moves into the notes. `repairs` says what changed, for the event log.
 */
export const repairedDraft = (draft: ItemDraft): { draft: ItemDraft, repairs: string[] } => REPAIRS.reduce<{ draft: ItemDraft, repairs: string[] }>(
  (done, repair) => (repair.fails(done.draft) ? { draft: { ...done.draft, ...repair.fix(done.draft) }, repairs: [...done.repairs, repair.says] } : done),
  { draft, repairs: [] },
)
