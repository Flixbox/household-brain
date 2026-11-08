/** Pacing that reads GitHub's rate limit (#400). Only the shape so far: the tests come first. */
interface Budget {
  limit: number
  remaining: number
  resetMs: number
}
export interface Limits {
  blockedUntilMs: number
  budgets: Record<string, Budget>
}
export const NO_LIMITS: Limits = { blockedUntilMs: 0, budgets: {} }

export const updatedLimits: (limits: Limits, log: string, call: { failed: boolean, nowMs: number }) => Limits = limits => limits
export const stretchFor: (limits: Limits, nowMs: number) => number = () => 1
export const pauseMs: (look: { baseMs: number, busy: boolean, quietLooks: number, stretch: number }) => number = look => look.baseMs
