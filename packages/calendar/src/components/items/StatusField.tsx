import type { ChangeEvent } from 'react'
import type { Item } from '../../lib/items/model'
import { textField } from '../settings/styles'
import { Field } from './Field'

/** An entry's status, offered when editing (a new entry is always open). */
export function StatusField({ value, onChange }: { value: Item['status'], onChange: (event: ChangeEvent<HTMLSelectElement>) => void }) {
  return (
    <Field label="Status">
      <select className={textField} value={value} onChange={onChange}>
        <option value="open">Open</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
    </Field>
  )
}
