/**
 * How often an entry's price is due (#86), e.g. a membership paid monthly. Stored as the value,
 * '' for none: a one-off price, as every entry from before intervals had.
 */
export const INTERVALS = [
  { label: 'Daily', per: 'day', value: 'daily' },
  { label: 'Weekly', per: 'week', value: 'weekly' },
  { label: 'Every 2 weeks', per: '2 weeks', value: 'biweekly' },
  { label: 'Monthly', per: 'month', value: 'monthly' },
  { label: 'Quarterly', per: 'quarter', value: 'quarterly' },
  { label: 'Every 6 months', per: 'half-year', value: 'half-yearly' },
  { label: 'Yearly', per: 'year', value: 'yearly' },
] as const

/** A known interval, or '' for anything else (another client's value, an older entry). */
export const intervalFrom = (value: unknown): string => INTERVALS.find(interval => interval.value === value)?.value ?? ''

/** The price as the list shows it: "15,00 € / month", or just the price without an interval. */
export const withInterval = (price: string, interval: string): string => {
  const per = INTERVALS.find(entry => entry.value === interval)?.per
  return per ? `${price} / ${per}` : price
}
