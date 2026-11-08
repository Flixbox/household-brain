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

/**
 * The jobs of a cancelled deploy (#417), by run and attempt. It can't be settled, as a later run on main
 * can still replace it, but a run that has ended keeps its jobs. Rare, and gone with the watcher.
 */
const cancelledJobs = new Map<string, string[]>()
const attemptOf = ({ attempt, id }: RunId) => `${id} ${attempt}`

/** The jobs kept for this attempt of a cancelled deploy; null when there are none. */
export const keptJobs = (run: RunId): string[] | null => cancelledJobs.get(attemptOf(run)) ?? null

/** This attempt of a deploy was cancelled, with these jobs. */
export const keepJobs = (run: RunId, jobs: string[]): void => {
  cancelledJobs.set(attemptOf(run), jobs)
}

/** Whether this is the run already finished with at this place. */
export const isSettled = (place: RunPlace, { attempt, id }: RunId): boolean => {
  const known = settled.get(placeOf(place))
  return known?.sha === place.sha && known.id === id && known.attempt === attempt
}

/** This completed run has been reported. */
export const settle = (place: RunPlace, { attempt, id }: RunId): void => {
  settled.set(placeOf(place), { attempt, id, sha: place.sha })
}
