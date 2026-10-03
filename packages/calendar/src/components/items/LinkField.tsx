import { LINK_PATTERN, openableLink } from '@household-brain/calendar/lib/items/link'
import { textField } from '@household-brain/calendar/lib/styles'
import { Field } from './Field'

/** The link field, with a button that opens the link in a new tab once it is a web address (#65). */
export const LinkField = ({ value, onChange }: { value: string, onChange: (event: { target: { value: string } }) => void }) => {
  const href = openableLink(value)
  return (
    // The button sits beside the label, not in it, or it would become part of the field's name.
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Field label="Link">
          <input inputMode="url" autoCapitalize="none" pattern={LINK_PATTERN} title="A web address, e.g. example.de or https://example.de/deal" placeholder="example.de" className={`${textField} w-full`} value={value} onChange={onChange} />
        </Field>
      </div>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Open the link in a new tab" title="Open in a new tab" className="flex h-10.5 items-center rounded-lg border border-stone-300 px-3 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      )}
    </div>
  )
}
