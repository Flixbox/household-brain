import type { Item } from '@household-brain/entries/lib/items/model'
import { textFieldClass } from '@household-brain/entries/lib/styles'
import { Field } from './Field'

const statusOf = (value: string): Item['status'] => (value === 'done' || value === 'cancelled' ? value : 'open')

/** An entry's status, offered when editing (a new entry is always open). */
export const StatusField = ({ value, onChange }: { value: Item['status'], onChange: (value: Item['status']) => void }) => (
  <Field label="Status">
    <select className={textFieldClass} value={value} onChange={event => { onChange(statusOf(event.target.value)) }}>
      <option value="open">Open</option>
      <option value="done">Done</option>
      <option value="cancelled">Cancelled</option>
    </select>
  </Field>
)
