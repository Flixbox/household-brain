/**
 * Commands behind a wrapper, for the owner-write guard: a wrapper's options aren't read, so the
 * command may start at any of its words, and each start is read as a command of its own. That is
 * quadratic in the words, so a start is only taken when the guard would read its first word further
 * (#456), each one is charged to the work budget (#434), and a line that spends it counts as a write.
 * A variable counts as a command only where it can be one: at or before the wrapper's real command,
 * as far as the options can be read (#436).
 */
import { movesOrPushes } from './owner-push'
import { baseName, isGh, runsPrograms } from './shell-interpreters'
import { type Work, charged } from './shell-work'
import { isDynamic } from './shell-commands'

/** Commands that run a command given in their arguments, after options that may take values (`sudo -u x gh …`, `nice -n 10 gh …`). Their options aren't read: every later word counts as where the command may start. */
const wrappers = new Set([
  'builtin', 'busybox', 'chroot', 'chrt', 'command', 'coproc', 'doas', 'env', 'exec', 'flock', 'ionice', 'nice', 'nohup', 'script', 'setpriv',
  'setsid', 'stdbuf', 'sudo', 'taskset', 'time', 'timeout', 'unbuffer', 'unshare', 'watch', 'xargs',
])

/** Wrappers that also take a whole command line after `-c`, as a shell does (`flock x -c '…'`). */
export const scriptFlagRunners = new Set(['flock', 'script'])

/** A shell by its name, however it is spelled (`mksh`, `bash-5.2`, `zsh.exe`): matching more than shells costs only a false denial. */
export const shell = /^[a-z]*sh[-.\d]*(?:\.exe)?$/u

/** Commands that run what comes in on their input (`source /dev/stdin`), the shells apart. */
export const stdinRunners = new Set(['.', 'source'])

/**
 * Whether the guard reads a command with this first word further than the word itself, so a start
 * behind a wrapper is worth taking: `writes`, `innerScript`, `readsScriptFromInput`, `programCommands`
 * and `pushRefusal`. Whoever reads a new kind of command adds it here too, or behind a wrapper it goes unseen (#456).
 */
const readFurther = (name: string) => {
  const base = baseName(name)
  return isGh(name) || isDynamic(name) || base === 'xargs' || name === 'eval' || base === 'env' || scriptFlagRunners.has(base)
    || shell.test(base) || stdinRunners.has(base) || runsPrograms(name) || movesOrPushes(name)
}

/** Wrappers with a word of their own before the command (`timeout 5 …`, `flock file …`). */
const takesOperand = new Set(['chroot', 'chrt', 'coproc', 'flock', 'script', 'taskset', 'timeout'])

/** A word that isn't the command, and may be followed by its value: an option, a redirection, or a variable that may be either. */
const optionLike = (word: string) => word.startsWith('-') || isDynamic(word) || /^\d*[<>&]/u.test(word)

const namesWrapper = (word: string) => wrappers.has(baseName(word))

/** Where the next word that isn't a wrapper's own starts, from `from` on: past assignments, options and what may be their values, but never past a word naming a wrapper, which may be the next wrapper. */
const pastOptions = (command: readonly string[], from: number) => {
  let at = from
  while (at < command.length) {
    const word = command[at] ?? ''
    if (optionLike(word)) {
      const next = command[at + 1] ?? ''
      at += optionLike(next) || namesWrapper(next) ? 1 : 2
    } else if (/^[A-Za-z_]\w*=/u.test(word)) {
      at += 1
    } else {
      return at
    }
  }
  return at
}

/** Where a wrapper's real command stands, behind any wrappers nested in it. An operand not taken because a wrapper's name stood there stays owed, so that a misread only moves this later, which keeps more variables as commands. */
const realCommandAt = (command: readonly string[]) => {
  let at = 0
  let owed = 0
  while (namesWrapper(command[at] ?? '')) {
    owed += takesOperand.has(baseName(command[at] ?? '')) ? 1 : 0
    at = pastOptions(command, at + 1)
    while (owed > 0 && at < command.length && !namesWrapper(command[at] ?? '')) {
      at = pastOptions(command, at + 1)
      owed -= 1
    }
  }
  return at
}

/** How many words of a start cost one character of the budget: a start that is no `gh` is only looked at, so several of them stay well inside it. */
const wordsPerCharacter = 8

/** What reading a command from one start costs: `gh`, or a command the shell fills in, has all its arguments read; any other is only looked at. */
const costOf = (candidate: readonly string[]) => {
  const name = candidate[0] ?? ''
  return isGh(name) || isDynamic(name) ? candidate.join(' ').length : Math.ceil(candidate.length / wordsPerCharacter)
}

/** The words a wrapped command may start at: any written-out word, and a variable only up to the real command, if the guard reads a command starting there further. A word dropped here costs nothing, so a plain file list can be any length. */
const startsOf = (command: readonly string[]) => {
  const realCommand = realCommandAt(command)
  return [...command.keys()].filter(at => (at <= realCommand || !isDynamic(command[at] ?? '')) && readFurther(command[at] ?? ''))
}

/** The commands a simple command may be: itself, and behind a wrapper one per word it can start at until the budget is spent. */
export const commandsFrom = (command: string[], work: Work) => {
  if (!wrappers.has(baseName(command[0] ?? ''))) {
    return [command]
  }
  const candidates: string[][] = []
  for (const at of startsOf(command)) {
    const candidate = command.slice(at)
    if (charged(work, costOf(candidate))) {
      break
    }
    candidates.push(candidate)
  }
  return candidates
}
