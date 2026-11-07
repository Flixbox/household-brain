/** Here-documents as the owner-write guard's shell reader (shell-commands.ts) sees them (#368). */

/** A here-document opened on the line being read; its body starts on the next line. */
export interface Heredoc {
  delimiter: string
  /** `<<'EOF'` (or `"EOF"`, `\\EOF`): the body is taken as written; else the shell runs its `$(…)`. */
  quoted: boolean
  /** `<<-`: tabs before the closing line don't count. */
  tabs: boolean
}

/** `<<`, `<<-`, and the delimiter, quoted or not. */
export const heredocOpener = /^<<(?<tabs>-?)[\t ]*(?:'(?<single>[^']*)'|"(?<double>[^"]*)"|(?<escape>\\)?(?<bare>[^\s"&'();<>|-][^\s"&'();<>|]*))/u

/** The here-document an opener names. */
export const heredocOf = (match: RegExpExecArray): Heredoc => {
  const { bare, double, escape, single, tabs } = match.groups ?? {}
  return {
    delimiter: single ?? double ?? bare ?? '',
    quoted: typeof escape === 'string' || typeof bare !== 'string',
    tabs: tabs === '-',
  }
}

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
