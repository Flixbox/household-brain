const EURO = new Intl.NumberFormat('de-DE', { currency: 'EUR', style: 'currency' })

/**
 * An entry's amount for display, e.g. "9,99 €". It is stored as typed ("9.99" or "9,99"); anything
 * that isn't a plain number is shown as it is. Null when there is none.
 */
export function amountLabel(amount: string): string | null {
  const text = amount.trim()
  if (text === '') {
    return null
  }
  return /^\d+(?:[.,]\d{1,2})?$/u.test(text) ? EURO.format(Number(text.replace(',', '.'))) : text
}
