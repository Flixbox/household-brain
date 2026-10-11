import { Temporal } from 'temporal-polyfill'

/**
 * Whether something published at `published` is younger than `minimumSeconds` at `now`: the 48-hour
 * rule (#94, #102) for package versions and GitHub Actions alike. A fresh release has had no time
 * for anyone to notice it is compromised.
 */
export const tooYoung = (published: Temporal.Instant, minimumSeconds: number, now = Temporal.Now.instant()): boolean =>
  Temporal.Instant.compare(published, now.subtract({ seconds: minimumSeconds })) > 0

/** Whole hours between `published` and `now`, for messages. */
export const hoursSince = (published: Temporal.Instant, now = Temporal.Now.instant()): number =>
  Math.floor(published.until(now).total('hours'))
