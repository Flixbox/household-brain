/** An object read from untyped data (JSON, a Firestore document): not null, not an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A string read from untyped data, or `fallback` when the value is anything else. */
export const textOf = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

/** An object read from untyped data, or an empty one when the value is anything else. */
export const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

/** The string-valued fields of an object read from untyped data; everything else is left out. */
export const textMapOf = (value: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(recordOf(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
