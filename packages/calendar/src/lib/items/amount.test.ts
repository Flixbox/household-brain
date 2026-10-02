import { describe, expect, it } from 'vitest'
import { amountLabel } from './amount'
import { ratesOf } from './currency'

// Intl puts a no-break space before the currency sign.
const plain = (text: string | null) => text?.replaceAll('\u00A0', ' ')

describe('amountLabel', () => {
  it('shows a stored amount as euros, whichever decimal mark it was typed with', () => {
    expect(plain(amountLabel('9.99'))).toBe('9,99 €')
    expect(plain(amountLabel('9,9'))).toBe('9,90 €')
    expect(plain(amountLabel('1500'))).toBe('1.500,00 €')
    expect(plain(amountLabel('9.99', 'EUR'))).toBe('9,99 €')
  })

  it('has nothing to show for no amount, and shows anything else as typed', () => {
    expect(amountLabel('')).toBeNull()
    expect(amountLabel('  ')).toBeNull()
    // A document stored without the field (older or stray) must not break the row.
    expect(amountLabel(null)).toBeNull()
    expect(amountLabel('about 10', 'USD')).toBe('about 10')
  })

  it('shows another currency in its own, with the euro value once a rate is known', () => {
    expect(plain(amountLabel('199,99', 'BRL'))).toBe('199,99 R$')
    expect(plain(amountLabel('199,99', 'BRL', { checked: '2026-10-02', rates: { BRL: 5 } }))).toBe('199,99 R$ ≈ 40,00 €')
    // A currency the rates don't cover shows without a conversion.
    expect(plain(amountLabel('10', 'USD', { checked: '2026-10-02', rates: { BRL: 5 } }))).toBe('10,00 $')
  })
})

describe('ratesOf', () => {
  it('reads the rates and leaves out anything malformed', () => {
    expect(ratesOf([{ quote: 'BRL', rate: 5.876 }, { quote: 'USD', rate: '1.1' }, { rate: 2 }, { quote: 'XXX', rate: 0 }])).toEqual({ BRL: 5.876 })
    expect(ratesOf({ error: 'down' })).toEqual({})
  })
})
