import { atom } from 'nanostores'
import type { Item } from './model'

/** What the board is searched for; empty shows everything. Not remembered across reloads. */
export const $search = atom('')

/** Empties the search, e.g. on sign-out, so the next person doesn't open a filtered board. */
export function clearSearch() {
  $search.set('')
}

/** Lower case without accents, ß as ss: "cafe" finds "Café", "muller" "Müller", "strasse" "Straße". */
const plain = (text: string) => text.normalize('NFKD').replaceAll(/\p{M}/gu, '').toLowerCase().replaceAll('ß', 'ss')

/** Whether an entry matches every word of the query, in its title, code, notes, link or amount. */
export function matchesSearch(item: Pick<Item, 'title' | 'code' | 'notes' | 'url' | 'amount'>, query: string): boolean {
  const words = plain(query).split(/\s+/u).filter(word => word !== '')
  const haystack = plain([item.title, item.code, item.notes, item.url, item.amount].join(' '))
  return words.every(word => haystack.includes(word))
}
