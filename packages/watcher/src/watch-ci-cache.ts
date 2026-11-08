/**
 * The CI runs a watcher has finished with (#401): completed and reported, so their jobs need no reading
 * again. Whether one is still the newest comes from the run list itself, a 304 while nothing changes
 * (#405), and a rerun (a new attempt) changes it. Kept in memory, one per PR and label: a restarted
 * watcher reads each run once, and the reported lines keep it from reporting anything twice.
 */
interface RunPlace {
  label: 'pr' | 'deploy'
  pr: number
  sha: string
}
interface RunId {
  attempt: number
  id: number
}

const settled = new Map<string, RunId & { sha: string }>()
const placeOf = ({ label, pr }: RunPlace) => `${pr} ${label}`

/** Whether this is the run already finished with at this place. */
export const isSettled = (place: RunPlace, { attempt, id }: RunId): boolean => {
  const known = settled.get(placeOf(place))
  return known?.sha === place.sha && known.id === id && known.attempt === attempt
}

/** This completed run has been reported. */
export const settle = (place: RunPlace, { attempt, id }: RunId): void => {
  settled.set(placeOf(place), { attempt, id, sha: place.sha })
}
