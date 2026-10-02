import { CURRENCIES } from '../../lib/items/currency'
import { textField } from '../settings/styles'
import { Field } from './Field'

/** The usual currencies, plus the entry's own should it be another (one set in another app). */
const choicesFor = (current: string): readonly string[] =>
  (current === '' || (CURRENCIES as readonly string[]).includes(current) ? CURRENCIES : [...CURRENCIES, current])

type Change = (event: { target: { value: string } }) => void

/** The amount and its currency side by side; '' (an entry without one) shows as euros. */
export function AmountField({ amount, currency, onAmount, onCurrency }: { amount: string, currency: string, onAmount: Change, onCurrency: Change }) {
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <Field label="Amount"><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" title="A number, e.g. 9.99" className={textField} value={amount} onChange={onAmount} /></Field>
      </div>
      <Field label="Currency">
        {/* Euros are stored as '', like every entry from before currencies existed. */}
        <select className={textField} value={currency || 'EUR'} onChange={event => onCurrency({ target: { value: event.target.value === 'EUR' ? '' : event.target.value } })}>
          {choicesFor(currency).map(code => <option key={code} value={code}>{code}</option>)}
        </select>
      </Field>
    </div>
  )
}
