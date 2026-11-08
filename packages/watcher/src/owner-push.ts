/* oxlint-disable import/no-nodejs-modules -- Bun has no path resolving of its own; node:path is built into Bun */
/**
 * Refusing a `git push` that would go out under the owner's login (#455). Plain `git push` never passes
 * through `agent-gh`: its identity is whichever credential helper git asks first. Every worktree of a
 * clone shares one `.git/config`, so an agent setting up its worktree once put the global `gh` helper
 * ahead of the bot's for a moment, and another agent's push went out as the owner.
 *
 * A catch for accidents (#389), not a boundary: a clone none of whose helpers is the bot's is left
 * alone, since not every repository has a bot, and a directory the shell fills in is ignored. A push
 * that goes elsewhere than GitHub over HTTPS never asks those helpers, so it passes (#467).
 */
import path from 'node:path'
import { mayUseGithubHelpers } from './push-destination'
import { isDynamic } from './shell-commands'
import { baseName } from './shell-interpreters'
import { withoutRedirections } from './shell-redirections'

/** Git's own options that take the next word as their value, before the subcommand. */
const valueOptions = new Set(['--attr-source', '--config-env', '--git-dir', '--namespace', '--super-prefix', '--work-tree', '-C', '-c'])

/** Git's own options that can't change where a push goes. */
const inertOptions = new Set(['--no-pager', '--paginate', '-P', '-p'])

/** The directories of a git call's `-C` options, whether it has options that may change where a push goes, its subcommand and that subcommand's arguments. */
const readGit = (args: readonly string[]) => {
  const dirs: string[] = []
  let otherOptions = false
  let at = 0
  while (args[at]?.startsWith('-') === true) {
    if (args[at] === '-C') {
      dirs.push(args[at + 1] ?? '')
    } else if (!inertOptions.has(args[at] ?? '')) {
      otherOptions = true
    }
    at += valueOptions.has(args[at] ?? '') ? 2 : 1
  }
  return { args: args.slice(at + 1), dirs, otherOptions, subcommand: args[at] ?? '' }
}

/** A `git push` in a line: where it runs, its arguments, and whether something before it (a directory the shell fills in, a git option such as `-c`) keeps its destination from being read. */
interface Push {
  args: readonly string[]
  dir: string
  unclear: boolean
}

/** The directory after a `cd` or `-C` to this word; one the shell fills in changes nothing. */
const moveTo = (dir: string, word: string) => (isDynamic(word) ? dir : path.resolve(dir, word.replace(/^~(?=\/|$)/u, Bun.env.HOME ?? '~')))

/** Whether `pushesIn` reads a command with this first word. */
export const movesOrPushes = (name: string) => name === 'cd' || baseName(name) === 'git'

/** The `git push` this git call is, if it is one, run from this directory. */
const pushOf = (gitArgs: readonly string[], from: string, moved: boolean): Push[] => {
  const call = readGit(withoutRedirections(gitArgs))
  if (call.subcommand !== 'push') {
    return []
  }
  return [{ args: call.args, dir: call.dirs.reduce(moveTo, from), unclear: moved || call.otherOptions || call.dirs.some(word => isDynamic(word)) }]
}

/** Each `git push` in the line, following the `cd`s before it. */
const pushesIn = (commands: readonly (readonly string[])[], cwd: string) => {
  let dir = cwd
  let moved = false
  const pushes: Push[] = []
  for (const [name = '', ...args] of commands) {
    if (name === 'cd' && args.length > 0) {
      moved ||= isDynamic(args.at(-1) ?? '')
      dir = moveTo(dir, args.at(-1) ?? '')
    } else if (baseName(name) === 'git') {
      pushes.push(...pushOf(args, dir, moved))
    }
  }
  return pushes
}

/** The helpers git would see for github.com in this directory, in its order: system, global, local. None outside a repository's reach. */
const helpersOf = (dir: string) => {
  const { exitCode, stdout } = Bun.spawnSync(['git', '-C', dir, 'config', '-z', '--get-regexp', String.raw`^credential\.(https://github\.com\.)?helper$`])
  if (exitCode !== 0) {
    return []
  }
  return stdout.toString().split('\0').filter(entry => entry !== '').map(entry => entry.slice(entry.indexOf('\n') + 1))
}

const isBot = (helper: string) => helper.includes('agent-gh-token')

/** Whether this clone has the bot's helper, but git would not ask it first (an empty value clears the helpers before it). */
const wrongOrder = (helpers: readonly string[]) => {
  const effective = helpers.slice(helpers.lastIndexOf('') + 1)
  return helpers.some(helper => isBot(helper)) && !isBot(effective[0] ?? '')
}

/** Why a push from this clone is refused. */
const pushReason = (dir: string) => [
  `Refused (household-brain #455): git in ${dir} would not ask the bot's credential helper first, so this push could go out under the owner's login.`,
  'Check it with `git config --local --get-all credential.https://github.com.helper`: an empty line, then the bot\'s helper, is right.',
  'The config is shared by every worktree of the clone and another agent may be setting it up: retry shortly, and if it stays wrong report it, rather than changing it from a worktree.',
].join(' ')

/** Spellings that can change where a push goes unseen in its words, read with quotes and backslashes removed. */
const hidingSpellings = [
  // A variable git reads, assigned, or named bare as a `for` or `read` might fill it; `$GIT_DIR` only reads it.
  /\bGIT_\w+=|(?<![$\w{])GIT_\w+/u,
  /\bxargs\b/u,
  /(?:^|[\s;&|(])(?:source|\.|pushd|popd)(?=[\s;&|)]|$)/u,
  // `env -C` or `--chdir` (which env lets be abbreviated), before the command env runs. Stopping at the next `env` keeps the scan linear.
  /\benv\b(?:(?!\b(?:env|git)\b)[^;&|\n])*?\s-(?:\S*C|-c)/u,
]

/**
 * Whether the line can change where a push goes unseen in its words. Quotes and backslashes can splice a word together, so they
 * are removed first; a `$'` word can spell any name in escapes, so it counts by itself.
 */
const hidesDestination = (line: string) => {
  const plain = line.replaceAll(/["'\\]/gu, '')
  return line.includes("$'") || hidingSpellings.some(spelling => spelling.test(plain))
}

/** Why the first `git push` among these commands, the ones this line runs, that would not go out as the bot is refused, or null when there is none. */
export const pushRefusal = (commands: readonly (readonly string[])[], cwd: string, line: string) => {
  const hidden = hidesDestination(line)
  const push = pushesIn(commands, cwd).find(({ args, dir, unclear }) => wrongOrder(helpersOf(dir)) && (hidden || unclear || mayUseGithubHelpers(dir, args)))
  return typeof push === 'undefined' ? null : pushReason(push.dir)
}
