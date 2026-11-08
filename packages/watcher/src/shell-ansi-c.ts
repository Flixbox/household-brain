/**
 * `$'…'` (ANSI-C quoting) as bash reads it, for the owner-write guard's shell reader (#378): a backslash
 * escapes the character after it, so `\'` and `\\` stay inside and the string ends at the first
 * unescaped `'`; its value has the escapes decoded, as `bash -c $'…'` would run it. A byte or code
 * point the guard can't spell as one character (above U+007F) only needs to be no shell syntax, so it
 * stands as U+FFFD or as the Latin-1 character of the byte.
 */

/** Put in a word the shell may change, before each `$` it expands or for what can't be read for certain; a private-use character. */
export const dynamic = '\u{E000}'

/** What a text's own U+E000 stands as. Two different characters then read alike, so a here-document delimiter holding it is refused (clearing review of #475). */
export const standIn = '\uFFFD'

/** A text as written on a command line, or decoded from one: its own U+E000 is plain text, so no mark means anything but an expansion (#390). */
export const withoutMarks = (text: string) => text.replaceAll(dynamic, standIn)

/** Where the `quote` that closes a string whose text starts at `from` is, a backslash escaping the character after it. */
export const closingQuote = (text: string, from: number, quote: string) => {
  let at = from
  while (at < text.length && text[at] !== quote) {
    at += text[at] === '\\' ? 2 : 1
  }
  return at
}

const simple = new Map([
  ['"', '"'], ["'", "'"], ['?', '?'], ['E', '\u001B'], ['\\', '\\'], ['a', '\u0007'], ['b', '\b'], ['e', '\u001B'],
  ['f', '\f'], ['n', '\n'], ['r', '\r'], ['t', '\t'], ['v', '\v'],
])

/**
 * `\c` and the character after it: bash's control character (the low five bits), `\c?` DEL, `\c\`
 * (also `\c\\`) the one of backslash. Before a non-ASCII character bash takes only its first byte, and may end
 * the string there, so the word counts as one the shell may change (fails closed, review on #379).
 */
const control = (char: string) => {
  if ((char.codePointAt(0) ?? 0) > 0x7F) {
    return dynamic
  }
  return String.fromCodePoint(char === '?' ? 0x7F : (char.toUpperCase().codePointAt(0) ?? 0) % 32)
}

const codePoint = (value: number) => (value <= 0x10_FF_FF && (value < 0xD8_00 || value > 0xDF_FF) ? withoutMarks(String.fromCodePoint(value)) : '\uFFFD')

/**
 * The escapes with digits or a character after their letter: octal and `\x` give a byte (bash 5.3's
 * `\x{…}` takes any number of hex digits, of which the byte is the last two), `\u` and `\U` a code point.
 */
const numeric: readonly (readonly [RegExp, (digits: string) => string])[] = [
  [/^(?<digits>[0-7]{1,3})/u, digits => String.fromCodePoint(Number.parseInt(digits, 8) % 256)],
  [/^x\{(?<digits>[\dA-Fa-f]*)\}?/u, digits => String.fromCodePoint(Number.parseInt(`0${digits.slice(-2)}`, 16))],
  [/^x(?<digits>[\dA-Fa-f]{1,2})/u, digits => String.fromCodePoint(Number.parseInt(digits, 16))],
  [/^u(?<digits>[\dA-Fa-f]{1,4})/u, digits => codePoint(Number.parseInt(digits, 16))],
  [/^U(?<digits>[\dA-Fa-f]{1,8})/u, digits => codePoint(Number.parseInt(digits, 16))],
  [/^c(?<digits>\\\\?|[^\\])/u, digits => control(digits.slice(0, 1))],
]

/** The escape whose backslash stands before `rest`, as bash decodes it, and its length; an unknown one stays as written. */
const escapeBefore = (rest: string): [string, number] => {
  for (const [pattern, value] of numeric) {
    const match = pattern.exec(rest)
    if (match !== null) {
      return [value(match.groups?.digits ?? ''), match[0].length + 1]
    }
  }
  const char = rest.slice(0, 1)
  return [simple.get(char) ?? `\\${char}`, char.length + 1]
}

/** The value of the text between `$'` and its closing `'`: a NUL ends it, as in bash. */
export const ansiCValue = (inner: string) => {
  let value = ''
  let at = 0
  while (at < inner.length) {
    const [part, length]: [string, number] = inner[at] === '\\' ? escapeBefore(inner.slice(at + 1)) : [inner[at] ?? '', 1]
    value += part
    at += length
  }
  const nul = value.indexOf('\0')
  return nul === -1 ? value : value.slice(0, nul)
}
