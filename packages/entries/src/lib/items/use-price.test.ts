import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { $euroRates, refreshEuroRates } from './use-price'

const answer = [{ base: 'EUR', date: '2026-10-02', quote: 'BRL', rate: 5 }]

describe('refreshEuroRates', () => {
  afterEach(() => {
    mock.restore()
  })

  it('fetches once a day, and after a failure again only once the retry time has passed', async () => {
    let clock = 0
    spyOn(performance, 'now').mockImplementation(() => clock)
    const fetch = spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify(answer)))

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
