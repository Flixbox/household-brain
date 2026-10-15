import { CURRENCIES } from '@household-brain/entries/lib/items/currency'
import { INTERVALS } from '@household-brain/entries/lib/items/interval'
import { textFieldClass } from '@household-brain/entries/lib/styles'
import { Field, type FormField } from './Field'
import { FieldProblems } from './FieldProblems'

/** The usual currencies, plus the entry's own should it be another (one set in another app). */
const choicesFor = (current: string): readonly string[] =>
  (current === '' || CURRENCIES.some(code => code === current) ? CURRENCIES : [...CURRENCIES, current])

/**
 * The amount, its currency ('' shows as euros) and how often it is due ('' for a one-off price),
 * side by side; on a narrow screen the interval wraps under them.
 */
export const AmountField = ({ amount, currency, interval }: { amount: FormField, currency: FormField, interval: FormField }) => (
  <div className="flex flex-wrap gap-2">
    <div className="flex-1">
      <Field label="Amount">
        <input inputMode="decimal" title="A number, e.g. 9.99" className={textFieldClass} value={amount.state.value} onChange={event => { amount.handleChange(event.target.value) }} />
        <FieldProblems errors={amount.state.meta.errors} />
      </Field>
    </div>
    <Field label="Currency">
      {/* Euros are stored as '', like every entry from before currencies existed. */}
      <select className={textFieldClass} value={currency.state.value || 'EUR'} onChange={event => { currency.handleChange(event.target.value === 'EUR' ? '' : event.target.value) }}>
        {choicesFor(currency.state.value).map(code => <option key={code} value={code}>{code}</option>)}
      </select>
    </Field>
    <Field label="Every">
      <select className={textFieldClass} value={interval.state.value} onChange={event => { interval.handleChange(event.target.value) }}>
        <option value="">Once</option>
        {INTERVALS.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
    </Field>
  </div>
)
