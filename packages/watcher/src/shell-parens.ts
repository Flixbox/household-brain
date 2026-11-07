/** Parentheses and quotes as the owner-write guard's shell reader (shell-commands.ts) matches them (#368, #373). */

export const indexOrEnd = (text: string, search: string, from: number) => {
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

/** Quotes and escapes: where they sit, `closingParen` may find a `)` other than the shell's (#378). */
const quoting = /["'\\`]/u

/**
 * Whether the `((` at `at` is arithmetic: the `)` that closes its second `(` is followed by another.
 * Otherwise the shell reads a subshell in it, as `((gh pr close 1) )` (review on #374). Any quote or
 * escape before that `)` reads it as a subshell too, failing closed: `closingParen` reads quoting
 * (backticks, `$'…'`) other than the shell does.
 */
export const opensArithmetic = (text: string, at: number) => {
  const close = closingParen(text, at + 2)
  return text.startsWith('((', at) && text[close + 1] === ')' && !quoting.test(text.slice(at, close))
}
