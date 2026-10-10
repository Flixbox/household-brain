// Google Calendar event ids may only use base32hex characters (0-9, a-v), 5–1024 long. The client
// generates them so that a retried insert is idempotent: the second attempt gets 409, not a copy.
const ALPHABET = '0123456789abcdefghijklmnopqrstuv'
const LENGTH = 26

export const newEventId = (fillRandom: (bytes: Uint8Array<ArrayBuffer>) => unknown = bytes => crypto.getRandomValues(bytes)): string => {
  const bytes = new Uint8Array(LENGTH)
  fillRandom(bytes)
  return [...bytes].map(byte => ALPHABET[byte % ALPHABET.length]).join('')
}

export const isEventId = (id: string) => /^[0-9a-v]{5,1024}$/u.test(id)

/**
 * The entry (and event) id for an imported Google Task (#118): the same for the same task on every
 * device, so two pulls importing it at once create one entry. Hex digits are base32hex too. Null for
 * a task id too long to make a valid event id; such a task is left alone.
 */
export const eventIdForTask = (taskId: string): string | null => {
  const id = `t${[...new TextEncoder().encode(taskId)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
  return isEventId(id) ? id : null
}
