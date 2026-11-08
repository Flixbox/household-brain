/** Parentheses and quotes as the owner-write guard's shell reader (shell-commands.ts) matches them (#368, #373). */
import { closingQuote } from './shell-ansi-c'

export const indexOrEnd = (text: string, search: string, from: number) => {
  const at = text.indexOf(search, from)
  return at === -1 ? text.length : at
}

/**
 * Where what follows a quoted string, an escape or `$$` (whose second `$` opens no `$'…'`) that
 * starts at `at` starts; `at` itself when none starts there.
 */
const pastQuoted = (text: string, at: number) => {
  if (text[at] === '\\' || text.startsWith('$$', at)) {
    return at + 2
  }
  if (text.startsWith("$'", at)) {
    return closingQuote(text, at + 2, "'") + 1
  }
  if (text[at] === "'") {
    return indexOrEnd(text, "'", at + 1) + 1
  }
  return text[at] === '"' ? closingQuote(text, at + 1, '"') + 1 : at
}

const depthChange = (char: string | undefined) => {
  if (char === '(') {
    return 1
  }
  return char === ')' ? -1 : 0
}

/** The `)` that closes a `$(` whose text starts at `from`: parentheses in between are counted, those in quotes not. */
export const closingParen = (text: string, from: number) => {
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
 * What may move the `)` `closingParen` finds for a `$(…)` from the shell's: a comment, backticks, a
 * `case` pattern's `)`, what `${…}` or `$[…]` takes as text, or a quote, parenthesis or backslash
 * in a here-document's body, which is all that follows the first newline may be (#373).
 */
const unsureSubstitution = /[#`]|\$[[{]|\bcase\b|\n.*["'()\\]/su

/** Where what follows the `$(…)` at `at` starts, if there is one and its `)` is surely the shell's; else `at`. */
const pastSubstitution = (text: string, at: number) => {
  if (!text.startsWith('$(', at)) {
    return at
  }
  const end = closingParen(text, at + 2)
  return unsureSubstitution.test(text.slice(at + 2, end)) ? at : end + 1
}

/** A text without the substitutions whose `)` is surely the shell's. `$$` is the process id, whose second `$` opens none. */
const outsideSubstitutions = (text: string) => {
  let at = 0
  let kept = ''
  while (at < text.length) {
    const step = text.startsWith('$$', at) ? 2 : 1
    const past = step === 2 ? at : pastSubstitution(text, at)
    kept += past === at ? text.slice(at, at + step) : ''
    at = past === at ? at + step : past
  }
  return kept
}

/**
 * Quotes, escapes, comments, newlines (which here-document bodies need) and parentheses (a `case`
 * pattern's `)` in a substitution): where they sit outside a substitution it can follow,
 * `closingParen` may find a `)` other than the shell's.
 */
const unsure = /["#'(\\`\n]/u

/**
 * Whether the `((` at `at` is surely arithmetic: the `)` that closes its second `(` is followed by
 * another, and nothing between them could move that `)`. Otherwise it may be a subshell, as
 * `((gh pr close 1) )` is (review on #374), and fails closed.
 */
export const opensArithmetic = (text: string, at: number) => {
  const close = closingParen(text, at + 2)
  return text.startsWith('((', at) && text[close + 1] === ')' && !unsure.test(outsideSubstitutions(text.slice(at + 2, close)))
}

/** `&` ends a command, but not in a redirection (`2>&1`, `&>file`). */
const endsWithAmpersand = (text: string, at: number) =>
  text[at] === '&' && text[at - 1] !== '>' && text[at - 1] !== '<' && text[at + 1] !== '>'

const separators = new Set(['(', ')', ';', '|'])

export const isSeparator = (text: string, at: number) => separators.has(text[at] ?? '') || endsWithAmpersand(text, at)
