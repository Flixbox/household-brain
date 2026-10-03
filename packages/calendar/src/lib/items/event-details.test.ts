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

  it("reads what Google Calendar's own editor writes: HTML", () => {
    const html = '<b>Code:</b> SUMMER25<br>Amount: 10 €<br><a href="https://shop.household-brain.test/deal">the deal</a><br>Only online &amp; not in stores'
    expect(detailsFrom(html)).toEqual({
      amount: '10', code: 'SUMMER25', currency: '', notes: 'Only online & not in stores', url: 'https://shop.household-brain.test/deal',
    })
    expect(detailsFrom('Code: A1\r\nAmount: 5 €\r\nNote')).toMatchObject({ amount: '5', code: 'A1', notes: 'Note' })
  })

  it('takes a currency only when nothing else is left on the line', () => {
    for (const unclear of ['10 € NEW', '€10 (VAT incl.)', '100 kr', '20 %', '2x 10 €']) {
      expect(detailsFrom(`Amount: ${unclear}`)).toMatchObject({ amount: '', notes: `Amount: ${unclear}` })
    }
    expect(detailsFrom('Amount: 10')).toMatchObject({ amount: '10', currency: '' })
    expect(detailsFrom('Amount: 15 usd')).toMatchObject({ amount: '15', currency: 'USD' })
  })

  it('keeps what follows a code as a note, and a link without its sentence punctuation', () => {
    expect(detailsFrom('Code: X1 (in stores only)')).toMatchObject({ code: 'X1', notes: '(in stores only)' })
    expect(detailsFrom('More at https://shop.household-brain.test/deal.')).toMatchObject({ url: 'https://shop.household-brain.test/deal' })
    expect(detailsFrom('Link: https://shop.household-brain.test/deal\nOnly online')).toEqual({
      amount: '', code: '', currency: '', notes: 'Only online', url: 'https://shop.household-brain.test/deal',
    })
  })

  it('takes only the first line of each kind', () => {
    expect(detailsFrom('Code: ONE\nCode: TWO')).toMatchObject({ code: 'ONE', notes: 'Code: TWO' })
  })
})
