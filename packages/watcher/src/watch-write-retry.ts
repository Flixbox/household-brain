/** How long a failed write waits before its next try (#402); pure, so it is tested without a repository. */
const MINUTE_MS = 60_000
const RETRY_MINUTES = [1, 2, 5, 10]

/** How long the write waits after its `failures`th failure in a row: 1, 2, 5, then every 10 minutes. */
export const retryDelayMs = (failures: number): number =>
  (RETRY_MINUTES[Math.min(failures, RETRY_MINUTES.length) - 1] ?? 0) * MINUTE_MS
