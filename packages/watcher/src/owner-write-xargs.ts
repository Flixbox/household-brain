/**
 * `gh` behind `xargs` (#387): xargs adds what comes in on its input to the arguments, so `xargs gh`
 * runs whatever the input says. The guard is a catch for accidents (#389): the command counts as a
 * write unless gh's group and subcommand (for `gh api`, its endpoint) are written out, and then it is
 * judged by those words as any gh call. Flags the input might add to a read go unseen.
 */
import { isDynamic } from './shell-commands'
import { baseName, isGh } from './shell-interpreters'

/** The arguments that are no flag, leaving out the value of `-R`/`--repo`, the one flag gh takes before the subcommand. */
export const positionals = (args: readonly string[]) =>
  args.filter((arg, at) => !arg.startsWith('-') && args[at - 1] !== '-R' && args[at - 1] !== '--repo')

/** A short xargs flag, alone or last in a bundle (`-0rn 2`), whose value is the next word. */
const shortWithValue = /^-[0oprtx]*[EILPadns]$/u

/** The long xargs flags whose value may be the next word. */
const longWithValue = new Set(['--arg-file', '--delimiter', '--max-args', '--max-chars', '--max-procs', '--process-slot-var'])

/** Where the command xargs runs starts in its arguments, past xargs's own flags and their values. */
const commandAt = (args: readonly string[]) => {
  let at = 0
  while (args[at]?.startsWith('-') === true) {
    const flag = args[at] ?? ''
    at += shortWithValue.test(flag) || longWithValue.has(flag) ? 2 : 1
  }
  return at
}

/** A word that is really there: neither missing nor a replacement string such as `{}` or `%`. */
const writtenOut = (word: string) => isDynamic(word) || /^[/a-z]/iu.test(word)

/** Whether xargs runs gh with a command its input may supply. */
export const xargsFillsIn = (name: string, args: readonly string[]) => {
  const [command = '', ...rest] = args.slice(commandAt(args))
  const [group = '', subcommand = ''] = positionals(rest)
  return baseName(name) === 'xargs' && isGh(command) && !(writtenOut(group) && writtenOut(subcommand))
}
