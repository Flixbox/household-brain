/**
 * A shell command line read into its simple commands (#368), closely enough for the owner-write
 * guard: the commands of a pipeline, list, group or subshell, of `$(…)` and backticks (also inside
 * double quotes), each as its words with quotes and escapes taken off, and comments left out. It
 * expands nothing: a `$` the shell would expand (outside single quotes) stays in the word, after a
 * mark, so `isDynamic` tells a word the shell may change from one it takes as written.
 */

/** Put before each `$` the shell expands; a private-use character, so no command text has it. */
const dynamic = '\u{E000}'

/** Whether the shell may change a word before the command sees it (a variable, `$(…)`, backticks). */
export const isDynamic = (word: string) => word.includes(dynamic)

/** A word as it reads, without the marks. */
export const plainWord = (word: string) => word.replaceAll(dynamic, '')

/** The scan of a command line: the simple commands found so far, and the one being read. */
interface Scan {
  commands: string[][]
  /** The texts of `$(…)` and backticks, each read as a command line of its own. */
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

/** Where the `"` that closes a double-quoted string starting at `from` is. */
const closingQuote = (text: string, from: number) => {
  let at = from
  while (at < text.length && text[at] !== '"') {
    at += text[at] === '\\' ? 2 : 1
  }
  return at
}

/** Where what follows a quoted string or an escape that starts at `at` starts; `at` itself when none starts there. */
const pastQuoted = (text: string, at: number) => {
  if (text[at] === '\\') {
    return at + 2
  }
  if (text[at] === "'") {
    return indexOrEnd(text, "'", at + 1) + 1
  }
  return text[at] === '"' ? closingQuote(text, at + 1) + 1 : at
}

const depthChange = (char: string | undefined) => {
  if (char === '(') {
    return 1
  }
  return char === ')' ? -1 : 0
}

/** The `)` that closes a `$(` whose text starts at `from`: parentheses in between are counted, those in quotes not. */
const closingParen = (text: string, from: number) => {
  let depth = 1
  let at = from
  while (at < text.length) {
    const past = pastQuoted(text, at)
    depth += past === at ? depthChange(text[at]) : 0
    if (depth === 0) {
      return at
    }
    at = Math.max(past, at + 1)
  }
  return text.length
}

/**
 * A `$(…)` or backtick substitution starting at `at`: its text is kept to be read as a command line
 * of its own, and the word gets it, marked as dynamic. Returns that text and where the next thing starts.
 */
const substitution = (scan: Scan, text: string, at: number): [string, number] => {
  const backtick = text[at] === '`'
  const from = at + (backtick ? 1 : 2)
  const end = backtick ? indexOrEnd(text, '`', from) : closingParen(text, from)
  scan.nested.push(text.slice(from, end))
  return [dynamic + text.slice(at, end + 1), end + 1]
}

const startsSubstitution = (text: string, at: number) => text[at] === '`' || text.startsWith('$(', at)

/** One piece of a double-quoted string: its text and where the next piece starts. */
const doubleQuotedPart = (scan: Scan, text: string, at: number): [string, number] => {
  if (text[at] === '\\') {
    return [text[at + 1] ?? '', at + 2]
  }
  if (startsSubstitution(text, at)) {
    return substitution(scan, text, at)
  }
  return [text[at] === '$' ? `${dynamic}$` : (text[at] ?? ''), at + 1]
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

const separators = new Set(['\n', '(', ')', ';', '|'])

const isSeparator = (text: string, at: number) => separators.has(text[at] ?? '') || endsWithAmpersand(text, at)

/** What reads a quoted string or an escaped character, by its first character. */
const readers = new Map([['"', doubleQuoted], ["'", singleQuoted], ['\\', escaped]])

type Reader = (scan: Scan, text: string, at: number) => number

const blank: Reader = (scan, _text, at) => {
  endWord(scan)
  return at + 1
}

const separator: Reader = (scan, _text, at) => {
  endCommand(scan)
  return at + 1
}

const substituted: Reader = (scan, text, at) => {
  const [part, next] = substitution(scan, text, at)
  append(scan, part)
  return next
}

const comment: Reader = (_scan, text, at) => indexOrEnd(text, '\n', at)

const plain: Reader = (scan, text, at) => {
  append(scan, text[at] === '$' ? `${dynamic}$` : (text[at] ?? ''))
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
  if (startsSubstitution(text, at)) {
    return substituted
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
