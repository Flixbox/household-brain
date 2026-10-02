// Amounts in other currencies, shown with their approximate euro value (#56).

/** What the currency select offers; an entry's own currency is offered too, should it be another. */
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'BRL', 'PLN', 'CZK', 'DKK', 'SEK', 'NOK', 'TRY', 'JPY', 'CAD', 'AUD'] as const

/** An entry's currency: an ISO 4217 code, or '' for euros (also for entries stored without one). */
export const isForeign = (currency: string | undefined): currency is string => Boolean(currency) && currency !== 'EUR'

export interface EuroRates {
  /** The day (`YYYY-MM-DD`, household time) they were fetched; a new day fetches again. */
  checked: string
  /** Units of each currency per euro, e.g. `{ BRL: 5.88 }`. */
  rates: Record<string, number>
}

/** The rates in the service's answer, `[{ quote: 'BRL', rate: 5.88 }, …]`; anything malformed is left out. */
export function ratesOf(answer: unknown): Record<string, number> {
  if (!Array.isArray(answer)) {
    return {}
  }
  const valid = (answer as { quote?: unknown, rate?: unknown }[])
    .filter(entry => typeof entry.quote === 'string' && typeof entry.rate === 'number' && entry.rate > 0)
  return Object.fromEntries(valid.map(entry => [entry.quote as string, entry.rate as number]))
}
