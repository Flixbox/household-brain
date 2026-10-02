import { useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { persistentJSON } from '@nanostores/persistent'
import { type EuroRates, isForeign, ratesOf } from './currency'
import { amountLabel } from './amount'
import type { Item } from './model'

/**
 * Each device fetches the day's euro rates itself, at most once a day and only while an entry uses
 * another currency, and keeps them across reloads: offline, the last rates still convert. Entries
 * store only their amount and currency, never a rate.
 */
/** Exported for tests. */
export const $euroRates = persistentJSON<EuroRates | null>('hb:euro-rates', null)

// Free, without a key, and allows calls from any site. Rates are the European Central Bank's and others'.
const RATES_URL = 'https://api.frankfurter.dev/v2/rates?base=EUR'
/** A failed fetch (offline, service down) is tried again after this long, while such an entry shows. */
const RETRY_MS = 15 * 60_000

let lastTry = Number.NEGATIVE_INFINITY

/** Fetches today's rates unless they are already here or the last try was too recent; exported for tests. */
export const refreshEuroRates = async (today: string) => {
  if ($euroRates.get()?.checked === today || performance.now() - lastTry < RETRY_MS) {
    return
  }
  lastTry = performance.now()
  try {
    const response = await fetch(RATES_URL)
    const rates = response.ok ? ratesOf(await response.json()) : {}
    if (Object.keys(rates).length > 0) {
      $euroRates.set({ checked: today, rates })
    }
  } catch {
    // Offline: the last rates keep converting, and the timer below tries again.
  }
}

/** An entry's amount for display, fetching today's euro rates first when it is in another currency. */
export const usePrice = ({ amount, currency }: Pick<Item, 'amount' | 'currency'>, today: string): string | null => {
  const foreign = isForeign(currency)
  useEffect(() => {
    if (foreign) {
      refreshEuroRates(today)
    }
    const every = foreign ? setInterval(() => refreshEuroRates(today), RETRY_MS) : null
    return () => {
      if (every) {
        clearInterval(every)
      }
    }
  }, [foreign, today])
  return amountLabel(amount, currency, useStore($euroRates))
}
