import { isRecord, textOf } from '@household-brain/core/lib/read'

/** What the entry schema found wrong with a field at Save (#195): Standard Schema issues carry a `message`. */
export const FieldProblems = ({ errors }: { errors: readonly unknown[] }) => {
  const messages = errors.map(error => (isRecord(error) ? textOf(error.message) : '')).filter(Boolean)
  return messages.length > 0 ? <span role="alert" className="text-sm text-red-700 dark:text-red-400">{messages.join(' ')}</span> : null
}
