/* oxlint-disable import/no-nodejs-modules -- Bun has no path resolving of its own; node:path is built into Bun */
/**
 * Refusing a `git push` that would go out under the owner's login (#455). Plain `git push` never passes
 * through `agent-gh`: its identity is whichever credential helper git asks first. Every worktree of a
 * clone shares one `.git/config`, so an agent setting up its worktree once put the global `gh` helper
 * ahead of the bot's for a moment, and another agent's push went out as the owner.
 *
 * A catch for accidents (#389), not a boundary: a clone none of whose helpers is the bot's is left
 * alone, since not every repository has a bot, and a directory the shell fills in is ignored.
 */
import path from 'node:path'
import { isDynamic } from './shell-commands'
import { baseName } from './shell-interpreters'

/** Git's own options that take the next word as their value, before the subcommand. */
const valueOptions = new Set(['--attr-source', '--config-env', '--git-dir', '--namespace', '--super-prefix', '--work-tree', '-C', '-c'])

/** The directories of a git call's `-C` options, and its subcommand. */
const readGit = (args: readonly string[]) => {
  const dirs: string[] = []
  let at = 0
  while (args[at]?.startsWith('-') === true) {
    if (args[at] === '-C') {
      dirs.push(args[at + 1] ?? '')
    }
    at += valueOptions.has(args[at] ?? '') ? 2 : 1
  }
  return { dirs, subcommand: args[at] ?? '' }
}

/** The directory after a `cd` or `-C` to this word; one the shell fills in changes nothing. */
const moveTo = (dir: string, word: string) => (isDynamic(word) ? dir : path.resolve(dir, word.replace(/^~(?=\/|$)/u, Bun.env.HOME ?? '~')))

/** The directory each `git push` runs in, following the `cd`s before it in the line. */
const pushDirs = (commands: readonly (readonly string[])[], cwd: string) => {
  let dir = cwd
  const dirs: string[] = []
  for (const [name = '', ...args] of commands) {
    if (name === 'cd' && args.length > 0) {
      dir = moveTo(dir, args.at(-1) ?? '')
    } else if (baseName(name) === 'git') {
      const call = readGit(args)
      if (call.subcommand === 'push') {
        dirs.push(call.dirs.reduce(moveTo, dir))
      }
    }
  }
  return dirs
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

/** The directory of the first `git push` among these commands that would not go out as the bot, or null when there is none. */
export const pushNotAsBot = (commands: readonly (readonly string[])[], cwd: string) =>
  pushDirs(commands, cwd).find(dir => wrongOrder(helpersOf(dir))) ?? null
