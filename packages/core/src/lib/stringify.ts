/** What a value is called when nothing better can be said about it, e.g. `[object Object]`. */
const kindOf = (value: unknown) => Object.prototype.toString.call(value)

/**
 * Any value as readable text, for messages shown to a person and for the Events log (#171): an
 * error's message (with its cause), a string as it is, a plain object as JSON. `String(value)`
 * alone turns objects into `[object Object]`.
 */
export const stringify = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return Object.hasOwn(value, 'cause') ? `${value.message} (cause: ${stringify(value.cause)})` : value.message
  }
  if (typeof value !== 'object' || value === null) {
    // Numbers, booleans, null, undefined, symbols, bigints and functions read fine as they are.
    return typeof value === 'function' ? kindOf(value) : String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    // Cycles and bigints can't be JSON.
    return kindOf(value)
  }
}
