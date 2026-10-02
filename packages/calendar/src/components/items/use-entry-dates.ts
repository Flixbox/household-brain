import { useState } from 'react'
import { type EntryDate, sameDates } from '../../lib/items/dates'

/**
 * The form's extra dates. Like the other fields: while nobody has changed them here, they follow a
 * newer version that arrives; once changed here, they stay. `touched` says whether to save them, so
 * saving another field never puts back an older list someone else has replaced meanwhile.
 */
export const useEntryDates = (initial: EntryDate[]) => {
  const [dates, setDates] = useState(initial)
  const [seen, setSeen] = useState(initial)
  const [touched, setTouched] = useState(false)
  if (!sameDates(seen, initial)) {
    setSeen(initial)
    if (!touched) {
      setDates(initial)
    }
  }
  const change = (next: EntryDate[]) => {
    setDates(next)
    setTouched(true)
  }
  return { change, dates, touched }
}
