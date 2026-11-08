import { ansiCValue, dynamic } from './shell-ansi-c'

/** Here-documents as the owner-write guard's shell reader (shell-commands.ts) sees them (#368). */

/** A here-document opened on the line being read; its body starts on the next line. */
export interface Heredoc {
  delimiter: string
  /** `<<'EOF'` (or `"EOF"`, `\\EOF`): the body is taken as written; else the shell runs its `$(…)`. */
  quoted: boolean
  /** `<<-`: tabs before the closing line don't count. */
  tabs: boolean
}

/**
 * `<<`, `<<-`, and a delimiter read whole: one quoted part or one bare one, and the word ends there.
 * Anything else (`<<E'O'F`, `<<"E\\"`, `<<"$(x)"`, `<<$(x)`) doesn't match, and the reader refuses it (#381): bash's
 * rules for the word are many, and a delimiter read wrong hides the commands after it.
 */
const plainOpener = /^<<(?<tabs>-?)[\t ]*(?:'(?<single>[^']*)'|"(?<double>[^!"$\\`]*)"|(?<escape>\\)?(?<bare>[^\s!"#$&'();<>\\`|-][^\s!"$&'();<>\\`|]*))/u

/** `<<` and a `$'…'` delimiter (#378), whose `\\'` and `\\\\` stay inside it; tried first, as a bare `$` would match the other. */
const ansiCOpener = /^<<(?<tabs>-?)[\t ]*\$'(?<ansi>(?:[^'\\]|\\[\s\S])*)'/u

/** What may stand after a delimiter read whole: a blank or operator, but no `<(` or `>(`, which bash keeps in the word. */
const wordEnd = /^(?![<>]\()(?:[\t\n &);<>|]|$)/u

/** The here-document opener a text starts with, if its delimiter is read whole. */
export const heredocOpener = (text: string) => {
  const match = ansiCOpener.exec(text) ?? plainOpener.exec(text)
  return match !== null && wordEnd.test(text.slice(match[0].length)) ? match : null
}

/**
 * A `$'…'` delimiter's value. Bash compares bytes, and the decoder can't spell bytes above 0x7F as the
 * line they'd match, so such a delimiter counts as one the shell may change, which the reader refuses (review on #379).
 */
const ansiCDelimiter = (ansi: string) => {
  const value = ansiCValue(ansi)
  return /\P{ASCII}/u.test(value) ? dynamic + value : value
}

/** The here-document an opener names. */
export const heredocOf = (match: RegExpExecArray): Heredoc => {
  const { ansi, bare, double, escape, single, tabs } = match.groups ?? {}
  return {
    delimiter: single ?? double ?? (typeof ansi === 'string' ? ansiCDelimiter(ansi) : null) ?? bare ?? '',
    quoted: typeof escape === 'string' || typeof bare !== 'string',
    tabs: tabs === '-',
  }
}

/** The text a shell reading a body as a script sees: a `<<-` body loses its leading tabs, and an unquoted body one level of `\$`, `` \` ``, `\\` and line continuations first. */
export const bodyAsRead = (heredoc: Heredoc, body: string) => {
  // Line continuations go first: the shell joins lines before it takes off tabs, so a continued line keeps its own.
  const joined = heredoc.quoted ? body : body.replaceAll(/\\[\s\S]/gu, pair => (pair === '\\\n' ? '' : pair))
  const text = heredoc.tabs ? joined.replaceAll(/^\t+/gmu, '') : joined
  return heredoc.quoted ? text : text.replaceAll(/\\(?<char>[$`\\])/gu, '$<char>')
}

/**
 * Whether a shell may read a body other than as written here: an unquoted body with a `$` or backtick
 * not escaped, or a `<<-` body where a continued line starts with a tab, as shells may differ on what goes first.
 */
export const bodyExpands = (heredoc: Heredoc, body: string) =>
  !heredoc.quoted && (/^(?:[^\\$`]|\\.)*[$`]/su.test(body) || (heredoc.tabs && /\\\n\t/u.test(body)))

/** A here-string's operator; a here-document's body is handed over as one too, so whoever reads the commands treats both alike. */
export const hereStringOperator = '<<<'

/** The unquoted `${…}` and `[…]` still open, inside which a `<<` may be a shift (#385). */
export interface Enclosures {
  /** How many `${` are open: bash reads to their `}`, whatever stands in between. */
  braces: number
  /** How many `[` are open; a subscript or `$[` runs to its `]` the same way. */
  brackets: number
}

const countBrace = (open: Enclosures, char: string | undefined, afterDollar: boolean) => {
  if (char === '{' && (open.braces > 0 || afterDollar)) {
    open.braces += 1
  } else if (char === '}') {
    open.braces = Math.max(0, open.braces - 1)
  }
}

/** Any `[` counts, as telling a subscript from a pattern or `[ … ]` would be modelling bash; inside `${…}` only its braces count. */
const countBracket = (open: Enclosures, char: string | undefined) => {
  if (open.braces > 0) {
    return
  }
  if (char === '[') {
    open.brackets += 1
  } else if (char === ']') {
    open.brackets = Math.max(0, open.brackets - 1)
  }
}

/** Counts an unquoted character into what is open. */
export const countEnclosure = (open: Enclosures, char: string | undefined, afterDollar: boolean) => {
  countBracket(open, char)
  countBrace(open, char, afterDollar)
}

const closerOpenedBy = (rest: string, at: number, top: string | undefined) => {
  const nests = rest[at - 1] === '$'
  if (rest[at] === '{' && (nests || top === '}')) {
    return '}'
  }
  return rest[at] === '[' && (nests || top === ']') ? ']' : null
}

/** Opens or closes what `rest[at]` opens or closes: a closer counts only for the innermost expansion, as in bash. */
const trackExpansion = (open: string[], rest: string, at: number) => {
  const closer = closerOpenedBy(rest, at, open.at(-1))
  if (closer !== null) {
    open.push(closer)
  } else if (rest[at] === open.at(-1)) {
    open.pop()
  }
}

/** A quote, or a substitution with closers of its own: past this the reader can't follow bash. */
const unfollowable = (rest: string, at: number) => /["'`]/u.test(rest[at] ?? '') || rest.startsWith('$(', at)

/** Whether the expansion `rest` starts with has something unfollowable before its closer, or has none. */
const expansionUnfollowable = (rest: string) => {
  const open: string[] = []
  let at = 1
  while (at < rest.length) {
    if (unfollowable(rest, at)) {
      return true
    }
    trackExpansion(open, rest, at)
    if (open.length === 0) {
      return false
    }
    at += rest[at] === '\\' ? 2 : 1
  }
  return true
}

/**
 * Whether a `$[` or `${` in double quotes starts at `from` and holds a quote or substitution: bash pairs
 * a `"` inside the expansion, where the reader would end the string (clearing review of #391).
 */
export const quoteInExpansion = (text: string, from: number) => {
  const rest = text[from] === '$' ? text.slice(from).replaceAll('\\\n', '') : ''
  return /^\$[[{]/u.test(rest) && expansionUnfollowable(rest)
}

const insideEnclosure = (open: Enclosures) => open.braces > 0 || open.brackets > 0

/** Where the line starting at `from` ends. */
const indexOrEnd = (text: string, from: number) => {
  const at = text.indexOf('\n', from)
  return at === -1 ? text.length : at
}

/** Where a here-document's body ends (the start of its closing line) and what follows it starts. */
export const closingLine = (heredoc: Heredoc, text: string, from: number) => {
  let start = from
  while (start < text.length) {
    const end = indexOrEnd(text, start)
    const line = text.slice(start, end)
    if ((heredoc.tabs ? line.replace(/^\t+/u, '') : line) === heredoc.delimiter) {
      return { after: end + 1, start }
    }
    start = end + 1
  }
  return { after: text.length, start: text.length }
}

export const opensHereString = (text: string, at: number) => text.startsWith(hereStringOperator, at)

export const opensHeredoc = (text: string, at: number) => text.startsWith('<<', at) && !opensHereString(text, at)

/** Inside an open `[` or `${` bash has no comments or `((`; the reader skipping them could miss a closer or an opener. */
export const unsureInEnclosure = (open: Enclosures & { word: string | null }, text: string, at: number) =>
  insideEnclosure(open) && (opensHeredoc(text, at) || (open.word === null && (text[at] === '#' || text.startsWith('((', at))))
