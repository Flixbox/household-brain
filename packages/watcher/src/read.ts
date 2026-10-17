// The watcher is installed as a Claude Code plugin, which copies only this package's folder: it can't
// import the repository's own helpers (`@household-brain/core/lib/read`, `ignore`), so it keeps these copies.

/** An object read from untyped data (JSON): not null, not an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a string that may be missing has text; TypeScript then knows it is a string. */
export const hasText = (value: string | null | undefined): value is string => typeof value === 'string' && value !== ''

/** A string read from untyped data, or `fallback` when the value is anything else. */
export const textOf = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

/** For a promise whose outcome no longer matters: an output abandoned after its call failed. */
export const ignoreFailure = (): void => {
  // Nothing to do, on purpose.
}

/**
 * Waits for every one of the promises, then fails with the first failure, if any. Unlike
 * `Promise.all`, nothing is still running when it fails: a watcher that exits on the failure would
 * otherwise drop what the others were about to report.
 */
export const allSettled = async (work: readonly Promise<unknown>[]): Promise<void> => {
  const failed = (await Promise.allSettled(work)).find(result => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }
}
