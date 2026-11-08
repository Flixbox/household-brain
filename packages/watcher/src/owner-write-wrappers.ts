/**
 * Commands behind a wrapper, for the owner-write guard: a wrapper's options aren't read, so the
 * command may start at any of its words, and each start is read as a command of its own. That is
 * quadratic in the words, so every start is charged to the work budget (#434), and a line that
 * spends it counts as a write. A variable counts as a command only where it can be one: at or before
 * the wrapper's real command, as far as the options can be read (#436).
 */
import { baseName, isGh } from './shell-interpreters'
import { type Work, charged } from './shell-work'
import { isDynamic } from './shell-commands'

/** Commands that run a command given in their arguments, after options that may take values (`sudo -u x gh …`, `nice -n 10 gh …`). Their options aren't read: every later word counts as where the command may start. */
const wrappers = new Set([
  'builtin', 'busybox', 'chroot', 'chrt', 'command', 'coproc', 'doas', 'env', 'exec', 'flock', 'ionice', 'nice', 'nohup', 'script', 'setpriv',
  'setsid', 'stdbuf', 'sudo', 'taskset', 'time', 'timeout', 'unbuffer', 'unshare', 'watch', 'xargs',
])

/** Wrappers with a word of their own before the command (`timeout 5 …`, `flock file …`). */
const takesOperand = new Set(['chroot', 'chrt', 'coproc', 'flock', 'script', 'taskset', 'timeout'])

/** A word that isn't the command, and may be followed by its value: an option, a redirection, or a variable that may be either. */
const optionLike = (word: string) => word.startsWith('-') || isDynamic(word) || /^\d*[<>&]/u.test(word)

/** Where the next word that isn't a wrapper's own starts, from `from` on: past assignments, options and what may be their values. */
const pastOptions = (command: readonly string[], from: number) => {
  let at = from
  while (at < command.length) {
    const word = command[at] ?? ''
    if (optionLike(word)) {
      at += optionLike(command[at + 1] ?? '') ? 1 : 2
    } else if (/^[A-Za-z_]\w*=/u.test(word)) {
      at += 1
    } else {
      return at
    }
  }
  return at
}

/** Where a wrapper's real command stands, behind any wrappers nested in it. Misreading an option's value only moves this later, which keeps more variables as commands. */
const realCommandAt = (command: readonly string[]) => {
  let at = 0
  while (wrappers.has(baseName(command[at] ?? ''))) {
    const next = pastOptions(command, at + 1)
    at = takesOperand.has(baseName(command[at] ?? '')) ? pastOptions(command, next + 1) : next
  }
  return at
}

/** How many words of a start cost one character of the budget: most starts are only looked at, so a long file list behind a wrapper stays well inside it. */
const wordsPerCharacter = 8

/** What reading a command from one start costs: `gh`, or a command the shell fills in, has all its arguments read; any other is only looked at. */
const costOf = (candidate: readonly string[]) => {
  const name = candidate[0] ?? ''
  return isGh(name) || isDynamic(name) ? candidate.join(' ').length : Math.ceil(candidate.length / wordsPerCharacter)
}

/** The commands a simple command may be: itself, and behind a wrapper one per word it can start at until the budget is spent. */
export const commandsFrom = (command: string[], work: Work) => {
  if (!wrappers.has(baseName(command[0] ?? ''))) {
    return [command]
  }
  const realCommand = realCommandAt(command)
  const starts = [...command.keys()].filter(at => at <= realCommand || !isDynamic(command[at] ?? ''))
  const candidates: string[][] = []
  for (const at of starts) {
    const candidate = command.slice(at)
    if (charged(work, costOf(candidate))) {
      break
    }
    candidates.push(candidate)
  }
  return candidates
}
