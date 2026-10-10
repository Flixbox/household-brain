import { useStore } from '@nanostores/react'
import { $search } from '@household-brain/entries/lib/items/search'
import { textField } from '@household-brain/entries/lib/styles'

/** The board's search field. */
export const SearchBox = () => {
  const query = useStore($search)
  return (
    <input
      type="search"
      aria-label="Search entries"
      placeholder="Search"
      className={`${textField} w-full`}
      value={query}
      onChange={event => $search.set(event.target.value)}
    />
  )
}
