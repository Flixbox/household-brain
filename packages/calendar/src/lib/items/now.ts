import { atom, onMount } from 'nanostores'
import { Temporal } from 'temporal-polyfill'
import { TIME_ZONE } from '../calendar/setup'

const current = () => Temporal.Now.zonedDateTimeISO(TIME_ZONE)

/** The household's current time, refreshed every minute while something shows it. */
export const $now = atom(current())

onMount($now, () => {
  $now.set(current())
  const every = setInterval(() => $now.set(current()), 60_000)
  return () => clearInterval(every)
})
