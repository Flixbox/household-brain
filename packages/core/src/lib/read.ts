/** An object read from untyped data (JSON, a Firestore document): not null, not an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A string read from untyped data, or `fallback` when the value is anything else. */
export const textOf = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
