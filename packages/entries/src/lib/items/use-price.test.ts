import { afterEach, describe, expect, it, vi } from 'vitest'
import { $euroRates, refreshEuroRates } from './use-price'

const answer = [{ base: 'EUR', date: '2026-10-02', quote: 'BRL', rate: 5 }]

describe('refreshEuroRates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches once a day, and after a failure again only once the retry time has passed', async () => {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify(answer)))
    vi.stubGlobal('fetch', fetch)

    await refreshEuroRates('2026-10-02')
    expect($euroRates.get()).toBeNull()
    clock = 60_000
    await refreshEuroRates('2026-10-02')
    expect(fetch).toHaveBeenCalledTimes(1)

    clock = 16 * 60_000
    await refreshEuroRates('2026-10-02')
    expect($euroRates.get()).toEqual({ checked: '2026-10-02', rates: { BRL: 5 } })
    clock = 40 * 60_000
    await refreshEuroRates('2026-10-02')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
