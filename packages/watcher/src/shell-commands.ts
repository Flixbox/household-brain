/**
 * A shell command line read into its simple commands (#368), closely enough for the owner-write
 * guard: the commands of a pipeline, list, group or subshell, of `$(…)` and backticks (also inside
 * double quotes), each as its words with quotes and escapes taken off, and comments left out. It
 * expands nothing: variables and globs stay as written.
 */

/** The scan of a command line: the simple commands found so far, and the one being read. */
interface Scan {
  commands: string[][]
  /** The texts of `$(…)` and backticks inside double quotes, each read as a command line of its own. */
  nested: string[]
  /** The word being read, null between words. */
  word: string | null
  words: string[]
}

const endWord = (scan: Scan) => {
  if (scan.word !== null) {
    scan.words.push(scan.word)
    scan.word = null
  }
}

const endCommand = (scan: Scan) => {
  endWord(scan)
  if (scan.words.length > 0) {
    scan.commands.push(scan.words)
    scan.words = []
  }
}

const append = (scan: Scan, text: string) => {
  scan.word = (scan.word ?? '') + text
}

const indexOrEnd = (text: string, search: string, from: number) => {
  const at = text.indexOf(search, from)
  return at === -1 ? text.length : at
}

/** The `)` that closes a `$(` whose text starts at `from`, counting the parentheses in between. */
const closingParen = (text: string, from: number) => {
  let depth = 1
  let at = from
  while (at < text.length) {
    depth += text[at] === '(' ? 1 : 0
    depth -= text[at] === ')' ? 1 : 0
    if (depth === 0) {
      return at
    }
    at += 1
  }
  return text.length
}

/** A `$(…)` or backtick substitution inside double quotes, which ends at `end`, kept to be read on its own. */
const substitution = (scan: Scan, inner: string, end: number): [string, number] => {
  scan.nested.push(inner)
  return ['', end + 1]
}

/** One piece of a double-quoted string: its text and where the next piece starts. */
const doubleQuotedPart = (scan: Scan, text: string, at: number): [string, number] => {
  if (text[at] === '\\') {
    return [text[at + 1] ?? '', at + 2]
  }
  if (text.startsWith('$(', at)) {
    const end = closingParen(text, at + 2)
    return substitution(scan, text.slice(at + 2, end), end)
  }
  if (text[at] === '`') {
    const end = indexOrEnd(text, '`', at + 1)
    return substitution(scan, text.slice(at + 1, end), end)
  }
  return [text[at] ?? '', at + 1]
}

const doubleQuoted = (scan: Scan, text: string, from: number) => {
  let at = from + 1
  let value = ''
  while (at < text.length && text[at] !== '"') {
    const [part, next] = doubleQuotedPart(scan, text, at)
    value += part
    at = next
  }
  append(scan, value)
  return at + 1
}

const singleQuoted = (scan: Scan, text: string, from: number) => {
  const end = indexOrEnd(text, "'", from + 1)
  append(scan, text.slice(from + 1, end))
  return end + 1
}

/** A backslash: the next character as it is, or nothing for a line continuation. */
const escaped = (scan: Scan, text: string, at: number) => {
  const next = text[at + 1] ?? ''
  if (next !== '\n') {
    append(scan, next)
  }
  return at + 2
}

/** `&` ends a command, but not in a redirection (`2>&1`, `&>file`). */
const endsWithAmpersand = (text: string, at: number) =>
  text[at] === '&' && text[at - 1] !== '>' && text[at - 1] !== '<' && text[at + 1] !== '>'

const separators = new Set(['\n', '(', ')', ';', '`', '|'])

const isSeparator = (text: string, at: number) =>
  separators.has(text[at] ?? '') || endsWithAmpersand(text, at) || text.startsWith('$(', at)

/** What reads a quoted string or an escaped character, by its first character. */
const readers = new Map([['"', doubleQuoted], ["'", singleQuoted], ['\\', escaped]])

type Reader = (scan: Scan, text: string, at: number) => number

const blank: Reader = (scan, _text, at) => {
  endWord(scan)
  return at + 1
}

const separator: Reader = (scan, text, at) => {
  endCommand(scan)
  return at + (text[at] === '$' ? 2 : 1)
}

const comment: Reader = (_scan, text, at) => indexOrEnd(text, '\n', at)

const plain: Reader = (scan, text, at) => {
  append(scan, text[at] ?? '')
  return at + 1
}

/** What reads the thing that starts at `at`; each returns where the next thing starts. */
const readerAt = (scan: Scan, text: string, at: number): Reader => {
  const char = text[at] ?? ''
  if (char === ' ' || char === '\t') {
    return blank
  }
  if (isSeparator(text, at)) {
    return separator
  }
  if (char === '#' && scan.word === null) {
    return comment
  }
  return readers.get(char) ?? plain
}

/** Every simple command of a command line, as its words. */
export const commandsOf = (text: string): string[][] => {
  const scan: Scan = { commands: [], nested: [], word: null, words: [] }
  let at = 0
  while (at < text.length) {
    at = readerAt(scan, text, at)(scan, text, at)
  }
  endCommand(scan)
  return [...scan.commands, ...scan.nested.flatMap(inner => commandsOf(inner))]
}
