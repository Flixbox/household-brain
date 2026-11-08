import { plainWord } from './shell-commands'

/**
 * The `gh` commands inside programs that interpreters and `make` run, for the owner-write guard (#394).
 * The guard catches accidents and is no boundary (#389), so these languages aren't parsed: a program's
 * text is cut into words, and a word naming `gh` with what follows it on its line counts as a command.
 * So a program that only prints `gh issue close` is refused too, and one that builds the command from
 * variables, or goes through an interpreter not listed here, passes.
 */

export const isGh = (word: string) => /(?:^|[/\\])gh(?:\.exe)?$/u.test(word)

export const baseName = (word: string) => word.replace(/^.*[/\\]/u, '')

/** An interpreter's name, and the flag that gives it a program to run, with the program attached or as the next argument. */
const inlineFlags: readonly (readonly [RegExp, RegExp])[] = [
  [/^python[\d.]*$/u, /^-[A-Zabd-z]*c(?<attached>.*)$/su],
  [/^perl[\d.]*$/u, /^-[A-DF-Za-df-z]*[Ee](?<attached>.*)$/su],
  [/^ruby[\d.]*$/u, /^-[A-Za-df-z]*e(?<attached>.*)$/su],
  [/^node(?:js)?$/u, /^(?:--(?:eval|print)=?|-[A-Za-df-oq-z]*[ep])(?<attached>.*)$/su],
]

/** `awk` takes its program as a plain argument, so all its arguments count as program text. */
const awk = /^[gmn]?awk$/u

const make = /^g?make$/u

const stdinNames = new Set(['-', '/dev/stdin'])

const nameOf = (word: string) => baseName(word).replace(/\.exe$/u, '')

const programsAfter = (flag: RegExp, args: readonly string[]) =>
  args.flatMap((arg, at) => {
    const attached = flag.exec(arg)?.groups?.attached
    if (typeof attached === 'undefined') {
      return []
    }
    return [attached === '' ? (args[at + 1] ?? '') : attached]
  })

/** The programs a command gives its interpreter in its arguments. */
const inlinePrograms = ([word = '', ...args]: readonly string[]) => {
  const name = nameOf(word)
  if (awk.test(name)) {
    return args
  }
  const flag = inlineFlags.find(([interpreter]) => interpreter.test(name))?.[1]
  return typeof flag === 'undefined' ? [] : programsAfter(flag, args)
}

const isInterpreter = (name: string) => awk.test(name) || inlineFlags.some(([interpreter]) => interpreter.test(name))

/** Whether `make`'s arguments name its input as the makefile (`-f -`, `-f-`, `--file=-`, `--makefile /dev/stdin`). */
const makefileFromInput = (args: readonly string[]) =>
  args.some((arg, at) => {
    const attached = /^(?:-f|--(?:make)?file=)(?<file>.+)$/su.exec(arg)?.groups?.file
    return stdinNames.has(attached ?? (/^(?:-f|--(?:make)?file)$/u.test(arg) ? (args[at + 1] ?? '') : ''))
  })

/** Whether a command runs its input as a program: an interpreter given no script, or told to read the program from input. */
const runsInput = ([word = '', ...args]: readonly string[]) => {
  const name = nameOf(word)
  if (make.test(name)) {
    return makefileFromInput(args)
  }
  return isInterpreter(name) && (args.every(arg => arg.startsWith('-')) || args.some(arg => stdinNames.has(arg)))
}

/** What ends a command in a program; a line ending in a comma goes on, as an argument list spread over lines does. */
const commandEnd = /(?<!,)\n|\|+|&&|[);\]]/u

const wordBreak = /[\s"'`,([]+/u

/** Whether what follows `gh` is only a mention of GraphQL, which the guard would count as a write for want of a query. */
const bareGraphql = (args: readonly string[]) => args.includes('graphql') && !args.some(arg => arg.startsWith('-'))

/** The commands naming `gh` in one piece of a program, each up to the next `gh`, so a long text is read once. */
const ghCommandsIn = (piece: string) => {
  const words = piece.split(wordBreak).filter(word => word !== '')
  const starts = words.flatMap((word, at) => (isGh(plainWord(word)) ? [at] : []))
  return starts
    .map((start, nth) => words.slice(start, starts[nth + 1]).with(0, 'gh'))
    .filter(args => !bareGraphql(args))
}

/**
 * The `gh` commands in the programs on a command line: those given inline, and the here-documents and
 * here-strings when anything on the line runs its input, as the guard reads for shells (#382).
 * `commands` come without their redirections.
 */
export const programCommands = (commands: readonly (readonly string[])[], fed: readonly string[]) =>
  [...commands.flatMap(command => inlinePrograms(command)), ...(commands.some(command => runsInput(command)) ? fed : [])]
    .flatMap(program => program.split(commandEnd))
    .flatMap(piece => ghCommandsIn(piece))
