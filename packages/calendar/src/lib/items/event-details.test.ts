import { describe, expect, it } from 'vitest'
import { detailsFrom } from './event-details'

describe('detailsFrom', () => {
  it('takes the labelled lines and the link, and leaves the rest as notes', () => {
    const description = 'Code: SUMMER25\nAmount: 10 €\nhttps://shop.household-brain.test/deal\nOnly online, not in stores.'
    expect(detailsFrom(description)).toEqual({
      amount: '10', code: 'SUMMER25', currency: '', notes: 'Only online, not in stores.', url: 'https://shop.household-brain.test/deal',
    })
  })

  it('reads the currency from a symbol or a code, and euros as none', () => {
    expect(detailsFrom('Amount: R$ 199,99')).toMatchObject({ amount: '199,99', currency: 'BRL' })
    expect(detailsFrom('amount: 20 CHF')).toMatchObject({ amount: '20', currency: 'CHF' })
    expect(detailsFrom('Amount: $5')).toMatchObject({ amount: '5', currency: 'USD' })
    expect(detailsFrom('Amount: 10,50 EUR')).toMatchObject({ amount: '10,50', currency: '' })
  })

  it('leaves anything unclear in the notes', () => {
    // A thousands separator isn't a plain amount: kept as written rather than misread.
    expect(detailsFrom('Amount: 1.500,00 €')).toEqual({ amount: '', code: '', currency: '', notes: 'Amount: 1.500,00 €', url: '' })
    expect(detailsFrom('The code is in the email')).toMatchObject({ code: '', notes: 'The code is in the email' })
    // A link inside a sentence stays there, but is still the entry's link.
    expect(detailsFrom('Details at https://shop.household-brain.test today')).toMatchObject({ notes: 'Details at https://shop.household-brain.test today', url: 'https://shop.household-brain.test' })
  })

  it('takes only the first line of each kind', () => {
    expect(detailsFrom('Code: ONE\nCode: TWO')).toMatchObject({ code: 'ONE', notes: 'Code: TWO' })
  })
})
