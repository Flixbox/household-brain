// This plugin is installed on its own, as a copy of this package's folder: it can't import the
// repository's helpers (`@household-brain/core/lib/read`), so it keeps these copies.

/** An object read from untyped data (JSON): not null, not an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A string read from untyped data, or `fallback` when the value is anything else. */
export const textOf = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
