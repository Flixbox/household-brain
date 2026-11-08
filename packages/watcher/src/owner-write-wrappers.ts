/**
 * Commands behind a wrapper, for the owner-write guard: a wrapper's options aren't read, so the
 * command may start at any of its words, and each start is read as a command of its own. That is
 * quadratic in the words, so a start is only taken when the guard would read its first word further
 * (#456), each one is charged to the work budget (#434), and a line that spends it counts as a write.
 */
import { baseName, isGh } from './shell-interpreters'
import { type Work, charged } from './shell-work'
import { isDynamic } from './shell-commands'

/** Commands that run a command given in their arguments, after options that may take values (`sudo -u x gh …`, `nice -n 10 gh …`). Their options aren't read: every later word counts as where the command may start. */
const wrappers = new Set([
  'builtin', 'busybox', 'chroot', 'chrt', 'command', 'coproc', 'doas', 'env', 'exec', 'flock', 'ionice', 'nice', 'nohup', 'script', 'setpriv',
  'setsid', 'stdbuf', 'sudo', 'taskset', 'time', 'timeout', 'unbuffer', 'unshare', 'watch', 'xargs',
])

/** How many words of a start cost one character of the budget: a start that is no `gh` is only looked at, so several of them stay well inside it. */
const wordsPerCharacter = 8

/** What reading a command from one start costs: `gh`, or a command the shell fills in, has all its arguments read; any other is only looked at. */
const costOf = (candidate: readonly string[]) => {
  const name = candidate[0] ?? ''
  return isGh(name) || isDynamic(name) ? candidate.join(' ').length : Math.ceil(candidate.length / wordsPerCharacter)
}

/**
 * The commands a simple command may be: itself, and behind a wrapper one per word `readFurther` keeps,
 * until the budget is spent. A word it drops costs nothing, so a plain file list can be any length.
 */
export const commandsFrom = (command: string[], work: Work, readFurther: (name: string) => boolean) => {
  if (!wrappers.has(baseName(command[0] ?? ''))) {
    return [command]
  }
  const candidates: string[][] = []
  for (let at = 0; at < command.length; at += 1) {
    if (!readFurther(command[at] ?? '')) {
      continue
    }
    const candidate = command.slice(at)
    if (charged(work, costOf(candidate))) {
      break
    }
    candidates.push(candidate)
  }
  return candidates
}
