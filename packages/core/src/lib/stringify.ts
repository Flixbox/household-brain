/** JSON.stringify as it behaves: undefined when an object's toJSON says there is nothing to write. */
const toJson: (value: unknown) => string | undefined = JSON.stringify

/** What a value is called when nothing better can be said about it, e.g. `[object Object]`. */
const kindOf = (value: unknown) => Object.prototype.toString.call(value)

/** An error's message, followed by its cause when it has one that isn't already part of the chain. */
const describeError = (error: Error, seen: Set<unknown>): string => {
  seen.add(error)
  const { cause } = error
  if (!Object.hasOwn(error, 'cause') || typeof cause === 'undefined' || seen.has(cause)) {
    return error.message
  }
  return `${error.message} (cause: ${describe(cause, seen)})`
}

const describe = (value: unknown, seen: Set<unknown>): string => {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return describeError(value, seen)
  }
  if (typeof value !== 'object' || value === null) {
    // Numbers, booleans, null, undefined, symbols, bigints and functions read fine as they are.
    return typeof value === 'function' ? kindOf(value) : String(value)
  }
  try {
    return toJson(value) ?? kindOf(value)
  } catch {
    // Cycles and bigints can't be JSON.
    return kindOf(value)
  }
}

/**
 * Any value as readable text, for messages shown to a person and for the Events log (#171): an
 * error's message (with its cause), a string as it is, a plain object as JSON. `String(value)`
 * alone turns objects into `[object Object]`.
 */
export const stringify = (value: unknown): string => describe(value, new Set())
