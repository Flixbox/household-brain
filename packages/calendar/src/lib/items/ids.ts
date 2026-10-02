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
