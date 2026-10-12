import { hasText } from '@household-brain/core/lib/read'

/**
 * The app's page addresses, written once (#164). Links and the page list (apps/web/src/pages/Pages.tsx)
 * use these, so a typo or a missing parameter fails to compile, and `useParams<typeof paths.editItem>()`
 * gets its parameter types from the pattern.
 */
export const paths = {
  editItem: '/items/:itemId',
  events: '/events',
  home: '/',
  newItem: '/items/new',
  settings: '/settings',
} as const

/** The edit page of one entry. Entry ids are letters and digits only, so they need no escaping. */
export const itemPath = (id: string) => paths.editItem.replace(':itemId', id)

/** The new-entry page, starting in `category` when given. */
export const newItemPath = (category?: string) =>
  (hasText(category) ? `${paths.newItem}?${new URLSearchParams({ category })}` : paths.newItem)
