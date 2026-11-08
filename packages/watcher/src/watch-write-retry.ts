/** Stand-in until #402's fix: a failed write doesn't wait. */
export const retryDelayMs = (_failures: number): number => 0
