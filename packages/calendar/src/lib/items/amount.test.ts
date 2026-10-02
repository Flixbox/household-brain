import { describe, expect, it } from 'vitest'
import { amountLabel } from './amount'

// Intl puts a no-break space before the euro sign.
const euro = (text: string | null) => text?.replaceAll(' ', ' ')

describe('amountLabel', () => {
  it('shows a stored amount as euros, whichever decimal mark it was typed with', () => {
    expect(euro(amountLabel('9.99'))).toBe('9,99 €')
    expect(euro(amountLabel('9,9'))).toBe('9,90 €')
    expect(euro(amountLabel('1500'))).toBe('1.500,00 €')
  })

  it('has nothing to show for no amount, and shows anything else as typed', () => {
    expect(amountLabel('')).toBeNull()
    expect(amountLabel('  ')).toBeNull()
    expect(amountLabel('about 10')).toBe('about 10')
  })
})
