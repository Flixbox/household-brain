import { type EuroRates, isForeign } from './currency'

const EURO = new Intl.NumberFormat('de-DE', { currency: 'EUR', style: 'currency' })
const PLAIN_NUMBER = /^\d+(?:[.,]\d{1,2})?$/u

function foreignLabel(value: number, currency: string, euroRates?: EuroRates | null): string {
  const own = new Intl.NumberFormat('de-DE', { currency, style: 'currency' }).format(value)
  const rate = euroRates?.rates[currency]
  // "≈" sticks to the euro value, so a narrow column wraps before it.
  return rate ? `${own} ≈\u00A0${EURO.format(value / rate)}` : own
}

/**
 * An entry's amount for display, e.g. "9,99 €". It is stored as typed ("9.99" or "9,99"); anything
 * that isn't a plain number is shown as it is. In another currency it shows in that one, with its
 * approximate euro value once a rate is known: "199,99 R$ ≈ 34,04 €". Null when there is none, also
 * for an entry stored without the field at all (an older or stray document).
 */
export function amountLabel(amount: string | null | undefined, currency?: string, euroRates?: EuroRates | null): string | null {
  const text = (amount ?? '').trim()
  if (text === '') {
    return null
  }
  if (!PLAIN_NUMBER.test(text)) {
    return text
  }
  const value = Number(text.replace(',', '.'))
  return isForeign(currency) ? foreignLabel(value, currency, euroRates) : EURO.format(value)
}
