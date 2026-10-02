import type { ChangeEvent } from 'react'
import type { Item } from '@household-brain/calendar/lib/items/model'
import { textField } from '@household-brain/calendar/lib/styles'
import { Field } from './Field'

/** An entry's status, offered when editing (a new entry is always open). */
export const StatusField = ({ value, onChange }: { value: Item['status'], onChange: (event: ChangeEvent<HTMLSelectElement>) => void }) => (
  <Field label="Status">
    <select className={textField} value={value} onChange={onChange}>
      <option value="open">Open</option>
      <option value="done">Done</option>
      <option value="cancelled">Cancelled</option>
    </select>
  </Field>
)
