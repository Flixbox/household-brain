import { textFieldClass } from '@household-brain/entries/lib/styles'
import { Field, type FormField } from './Field'
import { FieldProblems } from './FieldProblems'

interface Props {
  label: string
  field: FormField
  required?: boolean
  /** `date` for a date picker; `notes` for a multi-line text area. */
  kind?: 'text' | 'date' | 'notes'
  title?: string
}

/** A labelled text, date or notes control bound to one form field, with what the schema found wrong. */
export const TextField = ({ label, field, required = false, kind = 'text', title }: Props) => {
  const change = (event: { target: { value: string } }) => { field.handleChange(event.target.value) }
  return (
    <Field label={label} required={required}>
      {kind === 'notes'
        ? <textarea rows={3} className={textFieldClass} value={field.state.value} onChange={change} />
        : <input type={kind} required={kind === 'date' && required} title={title} className={textFieldClass} value={field.state.value} onChange={change} />}
      <FieldProblems errors={field.state.meta.errors} />
    </Field>
  )
}
