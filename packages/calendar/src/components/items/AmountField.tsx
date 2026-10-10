import { CURRENCIES } from '@household-brain/calendar/lib/items/currency'
import { INTERVALS } from '@household-brain/calendar/lib/items/interval'
import { textField } from '@household-brain/calendar/lib/styles'
import { Field } from './Field'

/** The usual currencies, plus the entry's own should it be another (one set in another app). */
const choicesFor = (current: string): readonly string[] =>
  (current === '' || CURRENCIES.some(code => code === current) ? CURRENCIES : [...CURRENCIES, current])

type Change = (event: { target: { value: string } }) => void

interface Props {
  amount: string
  currency: string
  interval: string
  onAmount: Change
  onCurrency: Change
  onInterval: Change
}

/**
 * The amount, its currency ('' shows as euros) and how often it is due ('' for a one-off price),
 * side by side; on a narrow screen the interval wraps under them.
 */
export const AmountField = ({ amount, currency, interval, onAmount, onCurrency, onInterval }: Props) => (
  <div className="flex flex-wrap gap-2">
    <div className="flex-1">
      <Field label="Amount"><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" title="A number, e.g. 9.99" className={textField} value={amount} onChange={onAmount} /></Field>
    </div>
    <Field label="Currency">
      {/* Euros are stored as '', like every entry from before currencies existed. */}
      <select className={textField} value={currency || 'EUR'} onChange={event => onCurrency({ target: { value: event.target.value === 'EUR' ? '' : event.target.value } })}>
        {choicesFor(currency).map(code => <option key={code} value={code}>{code}</option>)}
      </select>
    </Field>
    <Field label="Every">
      <select className={textField} value={interval} onChange={onInterval}>
        <option value="">Once</option>
        {INTERVALS.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
    </Field>
  </div>
)
