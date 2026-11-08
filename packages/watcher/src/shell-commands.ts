/**
 * A shell command line read into its simple commands (#368), closely enough for the owner-write
 * guard: the commands of a pipeline, list, group or subshell, of `$(…)` and backticks (also inside
 * double quotes), each as its words with quotes and escapes taken off (`$'…'` decoded, #378), and comments left out. A
 * here-document's body is no command, but comes along as a command of one word, a here-string, for
 * whoever must know what a shell is fed. It
 * expands nothing: a `$` the shell would expand (outside single quotes) stays in the word, after a
 * mark, so `isDynamic` tells a word the shell may change from one it takes as written.
 */
import { type Heredoc, bodyAsRead, bodyExpands, closingLine, hereStringOperator, heredocOf, heredocOpener } from './shell-heredocs'
import { closingParen, indexOrEnd, opensArithmetic } from './shell-parens'
import { ansiCValue, closingQuote, dynamic } from './shell-ansi-c'

/** Whether the shell may change a word before the command sees it (a variable, `$(…)`, backticks). */
export const isDynamic = (word: string) => word.includes(dynamic)

/** A word as it reads, without the marks. */
export const plainWord = (word: string) => word.replaceAll(dynamic, '')

/** The scan of a command line: the simple commands found so far, and the one being read. */
interface Scan {
  commands: string[][]
  heredocs: Heredoc[]
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

/**
 * Text that may be arithmetic or a subshell, failing closed (#373): read as commands, where a `<<`
 * may be a shift and so opens no here-document, and searched for substitutions whatever quotes them,
 * as arithmetic runs one even in single quotes.
 */
const unsureArithmetic = (scan: Scan, inner: string) => {
  scan.nested.push(inner.replaceAll('<<', '  '))
  substitutionsIn(scan, inner)
}

/**
 * A `$(…)` or backtick substitution starting at `at`: its text is kept to be read as a command line
 * of its own, and the word gets it, marked as dynamic; surely arithmetic `$((…))` is data. Returns
 * that text and where the next thing starts.
 */
const substitution = (scan: Scan, text: string, at: number): [string, number] => {
  const backtick = text[at] === '`'
  const from = at + (backtick ? 1 : 2)
  const end = backtick ? indexOrEnd(text, '`', from) : closingParen(text, from)
  const inner = text.slice(from, end)
  if (!text.startsWith('$((', at)) {
    scan.nested.push(inner)
  } else if (!opensArithmetic(text, at + 1)) {
    unsureArithmetic(scan, inner)
  }
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

/** `$'…'` (ANSI-C quoting, #378): `\\'` and `\\\\` stay inside, and the escapes are decoded as bash does. */
const ansiCQuoted = (scan: Scan, text: string, from: number) => {
  const end = closingQuote(text, from + 2, "'")
  append(scan, ansiCValue(text.slice(from + 2, end)))
  return end + 1
}

/** `$$`, the shell's process id: its second `$` opens no `$'…'`. */
const processId = (scan: Scan, _text: string, at: number) => {
  append(scan, `${dynamic}$$`)
  return at + 2
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

const separators = new Set(['(', ')', ';', '|'])

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

const opensHereString = (text: string, at: number) => text.startsWith(hereStringOperator, at)

const opensHeredoc = (text: string, at: number) => text.startsWith('<<', at) && !opensHereString(text, at)

/** `<` and `>` end the word before them, as in the shell, unless it is the file descriptor (`2>`) or the operator so far (`>>`, `&>`). */
const endWordBeforeRedirection = (scan: Scan) => {
  if (!/^\d*[&<>]*$/u.test(scan.word ?? '')) {
    endWord(scan)
  }
}

const redirect: Reader = (scan, text, at) => {
  endWordBeforeRedirection(scan)
  append(scan, text[at] ?? '')
  return at + 1
}

/** `((`: surely arithmetic is data; anything else fails closed. */
const doubleParen: Reader = (scan, text, at) => {
  const end = closingParen(text, at + 1)
  if (!opensArithmetic(text, at)) {
    unsureArithmetic(scan, text.slice(at + 2, end - 1))
  }
  return end + 1
}

/** Keeps a here-document; where its delimiter can't be read, nothing after it can be either, so it counts as a command the guard refuses (review on #379). */
const noteHeredoc = (scan: Scan, match: RegExpExecArray) => {
  const heredoc = heredocOf(match)
  scan.heredocs.push(heredoc)
  if (isDynamic(heredoc.delimiter)) {
    scan.commands.push([dynamic + match[0]])
  }
}

/** A here-document opener that can't be read for certain, as a command word the shell fills in, which the guard refuses (#381). */
const unreadable = (rest: string) => dynamic + (/^\S*/u.exec(rest)?.[0] ?? '')

/** `<<<`: a word of its own, so the word after it, attached or not and even empty, is the next word; no body follows on the next lines. */
const hereString: Reader = (scan, _text, at) => {
  endWordBeforeRedirection(scan)
  append(scan, hereStringOperator)
  endWord(scan)
  return at + hereStringOperator.length
}

const heredocOpen: Reader = (scan, text, at) => {
  const match = heredocOpener(text.slice(at))
  endWordBeforeRedirection(scan)
  if (match === null) {
    scan.commands.push([unreadable(text.slice(at))])
    append(scan, '<<')
    return at + 2
  }
  noteHeredoc(scan, match)
  append(scan, match[0])
  endWord(scan)
  return at + match[0].length
}

/** Reads only the `$(…)` and backtick substitutions of a text the shell otherwise takes as data. */
const substitutionsIn = (scan: Scan, text: string) => {
  let at = 0
  while (at < text.length) {
    const escape = text[at] === '\\' ? 2 : 1
    at = startsSubstitution(text, at) ? substitution(scan, text, at)[1] : at + escape
  }
}

/** A here-document's body: the substitutions the shell runs in it, and the body itself as a here-string. */
const readBody = (scan: Scan, heredoc: Heredoc, body: string) => {
  if (!heredoc.quoted) {
    substitutionsIn(scan, body)
  }
  scan.commands.push([hereStringOperator + (bodyExpands(heredoc, body) ? dynamic : '') + bodyAsRead(heredoc, body)])
}

/**
 * Where what follows the here-documents opened on a line starts. Their bodies are data, but for the
 * substitutions the shell runs in an unquoted one; each is kept as a here-string, in case a shell reads it.
 */
const pastHeredocs = (scan: Scan, text: string, from: number) => {
  const pending = scan.heredocs
  scan.heredocs = []
  let at = from
  for (const heredoc of pending) {
    const { after, start } = closingLine(heredoc, text, at)
    readBody(scan, heredoc, text.slice(at, start))
    at = after
  }
  return at
}

const newline: Reader = (scan, text, at) => {
  endCommand(scan)
  return pastHeredocs(scan, text, at + 1)
}

type Test = (scan: Scan, text: string, at: number) => boolean

/** Which reader reads what starts at `at`, first match first; else a quote's or escape's reader, or `plain`. */
const readerRules: readonly (readonly [Test, Reader])[] = [
  [(_scan, text, at) => text[at] === ' ' || text[at] === '\t', blank],
  [(_scan, text, at) => text[at] === '\n', newline],
  [(_scan, text, at) => opensHereString(text, at), hereString],
  [(_scan, text, at) => opensHeredoc(text, at), heredocOpen],
  [(_scan, text, at) => text[at] === '<' || text[at] === '>', redirect],
  [(scan, text, at) => scan.word === null && text.startsWith('((', at), doubleParen],
  [(_scan, text, at) => isSeparator(text, at), separator],
  [(_scan, text, at) => startsSubstitution(text, at), substituted],
  [(_scan, text, at) => text.startsWith('$$', at), processId],
  [(_scan, text, at) => text.startsWith("$'", at), ansiCQuoted],
  [(scan, text, at) => text[at] === '#' && scan.word === null, comment],
]

/** What reads the thing that starts at `at`; each returns where the next thing starts. */
const readerAt = (scan: Scan, text: string, at: number): Reader =>
  readerRules.find(([test]) => test(scan, text, at))?.[1] ?? readers.get(text[at] ?? '') ?? plain

/** Every simple command of a command line, as its words. */
export const commandsOf = (text: string): string[][] => {
  const scan: Scan = { commands: [], heredocs: [], nested: [], word: null, words: [] }
  let at = 0
  while (at < text.length) {
    at = readerAt(scan, text, at)(scan, text, at)
  }
  endCommand(scan)
  return [...scan.commands, ...scan.nested.flatMap(inner => commandsOf(inner))]
}
