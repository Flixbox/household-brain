/**
 * The guard against GitHub writes under the owner's own `gh` login (#368). Agents may read with plain
 * `gh` (only the owner's login sees the owner's pending reviews), but write only through `agent-gh`,
 * as the bot: a comment once fell back to `gh` when the bot was rate-limited, and posted as the owner
 * (`Coarisfinia/khovax#2136`). This is the plugin's PreToolUse hook on Bash, in Claude Code
 * (hooks/hooks.json) and in Codex (the same entry in .codex-plugin/plugin.json, #370; Codex's source maps its
 * `exec_command` tool's `cmd` to `Bash` with a string `tool_input.command`, and takes the same deny
 * answer, but whether the hook fires for calls code mode makes is unconfirmed until #377): it
 * refuses a command that writes through plain `gh`, and lets everything else run.
 *
 * `ownerWrite` reads the command as a shell would, closely enough: every simple command of a
 * pipeline, list, group, subshell, `$(…)`, backticks, `bash -c '…'`, `eval` or what a here-document
 * or here-string feeds a shell, with quotes and escapes, and only the word in command position (after variable assignments and wrappers such as
 * `env` or `timeout`), and the programs interpreters and `make` run (shell-interpreters.ts). A word naming `gh` (or a path ending in `/gh`) is the owner's login;
 * `agent-gh` never is.
 */
import { positionals, xargsFillsIn } from './owner-write-xargs'
import { isRecord, textOf } from './read'
import { commandsOf } from './shell-braces'
import { isDynamic, plainWord } from './shell-commands'
import { baseName, isGh, programCommands } from './shell-interpreters'
import { type Work, newWork } from './shell-work'

/** `gh pr` and `gh issue` subcommands that change something on GitHub. */
const prIssueWrites = new Set([
  'close', 'comment', 'create', 'delete', 'develop', 'edit', 'lock', 'merge', 'pin', 'ready', 'reopen',
  'revert', 'review', 'transfer', 'unlock', 'unpin', 'update-branch',
])

/** The methods a `gh api` call reads with; any other, or one the shell fills in, counts as a write. */
const readMethods = new Set(['GET', 'HEAD'])

/** `gh api` flags that send a field, so the call is a POST unless a method says otherwise. */
const fieldFlags = new Set(['--field', '--raw-field', '-F', '-f'])

const methodFlags = new Set(['--method', '-X'])

/** Shell keywords that may stand before a command. */
const keywords = new Set(['!', 'do', 'elif', 'else', 'if', 'then', 'until', 'while', '{', '}'])

/** Commands that run a command given in their arguments, after options that may take values (`sudo -u x gh …`, `nice -n 10 gh …`). Their options aren't read: every later word counts as where the command may start. */
const wrappers = new Set([
  'builtin', 'busybox', 'chroot', 'chrt', 'command', 'coproc', 'doas', 'env', 'exec', 'flock', 'ionice', 'nice', 'nohup', 'script', 'setpriv',
  'setsid', 'stdbuf', 'sudo', 'taskset', 'time', 'timeout', 'unbuffer', 'unshare', 'watch', 'xargs',
])

/** Wrappers that also take a whole command line after `-c`, as a shell does (`flock x -c '…'`). */
const scriptFlagRunners = new Set(['flock', 'script'])

/** A redirection: its operator, and its target when attached (`>out`, `2>/dev/null`, `&>log`). */
const redirection = /^\d*(?:&>>?|>>?|<{1,3}|>&|<&|>\|)(?<target>.*)$/su

/** A shell by its name, however it is spelled (`mksh`, `bash-5.2`, `zsh.exe`): matching more than shells costs only a false denial. */
const shell = /^[a-z]*sh[-.\d]*(?:\.exe)?$/u

/** Commands that run what comes in on their input (`source /dev/stdin`), the shells apart. */
const stdinRunners = new Set(['.', 'source'])

/** A here-string, or a here-document's body as shell-commands.ts hands it over. */
const hereString = /^\d*<<<(?<text>.*)$/su

// --- Telling a write ------------------------------------------------------------------------

/** What a `gh api` call's flags say: its method, if one is set, the fields it sends, and whether it sends a body. */
interface ApiFlags {
  fields: string[]
  input: boolean
  method: string | null
}

/** A flag and the value attached to it (`--method=POST`, `-XPOST`), or null when its value is the next argument. */
const flagParts = (arg: string): [string, string | null] => {
  if (arg.startsWith('--')) {
    const at = arg.indexOf('=')
    return at === -1 ? [arg, null] : [arg.slice(0, at), arg.slice(at + 1)]
  }
  // `-i` (include the headers) is the only short flag of gh api without a value, so the only one bundled before another.
  const short = arg.replace(/^-i+(?=.)/u, '-')
  return short.length > 2 ? [short.slice(0, 2), short.slice(2).replace(/^=/u, '')] : [short, null]
}

const takesValue = (name: string) => methodFlags.has(name) || fieldFlags.has(name) || name === '--input'

const record = (flags: ApiFlags, name: string, value: string) => {
  if (methodFlags.has(name)) {
    flags.method = value
  } else if (name === '--input') {
    flags.input = true
  } else {
    flags.fields.push(value)
  }
}

const apiFlagsOf = (args: readonly string[]): ApiFlags => {
  const flags: ApiFlags = { fields: [], input: false, method: null }
  let at = 0
  while (at < args.length) {
    const [name, attached] = flagParts(args[at] ?? '')
    if (args[at]?.startsWith('-') === true && takesValue(name)) {
      record(flags, name, attached ?? args[at + 1] ?? '')
      at += attached === null ? 1 : 0
    }
    at += 1
  }
  return flags
}

/** A GraphQL document without its strings and comments, where a word such as "mutation" means nothing. */
const graphqlCode = (document: string) => document.replaceAll(/"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|#.*/gu, ' ')

/** The top level of a GraphQL document, where an operation's type stands: what is inside braces (fields, aliases) is blanked. */
const topLevel = (code: string) => {
  let depth = 0
  let level = ''
  for (const char of code) {
    depth -= char === '}' ? 1 : 0
    level += depth === 0 ? char : ' '
    depth += char === '{' ? 1 : 0
  }
  return level
}

/** Whether a GraphQL call may write: unless its query is written out and holds no mutation, it counts as one. */
const graphqlWrites = (flags: ApiFlags) => {
  const query = flags.fields.find(field => field.startsWith('query='))
  if (flags.input || typeof query === 'undefined' || isDynamic(query) || query.startsWith('query=@')) {
    return true
  }
  // An operation's type stands first in the document, or after the closing brace of the one before it.
  return /(?:^|\})\s*mutation\b/u.test(topLevel(graphqlCode(query.slice('query='.length))))
}

/**
 * Whether a `gh api` call writes: unless a method it reads with is written out, it does when it sends
 * fields or a body (gh then POSTs). A GraphQL call is always a POST, and writes when it may send a
 * mutation (`graphqlWrites`).
 */
const apiWrites = (args: readonly string[]) => {
  const flags = apiFlagsOf(args)
  if (args.includes('graphql')) {
    return graphqlWrites(flags)
  }
  if (flags.method !== null) {
    return isDynamic(flags.method) || !readMethods.has(flags.method.toUpperCase())
  }
  return flags.input || flags.fields.length > 0
}

/** Whether `gh` with these arguments changes something on GitHub, or may: a command the shell fills in counts. */
const ghWrites = (args: readonly string[]) => {
  const [group = '', subcommand = ''] = positionals(args)
  if (isDynamic(group) || (group !== 'api' && isDynamic(subcommand))) {
    return true
  }
  if (group === 'api') {
    return apiWrites(args)
  }
  if (group === 'label') {
    return subcommand !== '' && subcommand !== 'list'
  }
  return (group === 'pr' || group === 'issue') && prIssueWrites.has(subcommand)
}

/** How many words a leading word takes up: an assignment or keyword one, a redirection one or two (with its target), a command none. */
const leadingLength = (word: string) => {
  if (/^[A-Za-z_]\w*=/u.test(word) || keywords.has(word)) {
    return 1
  }
  const target = redirection.exec(word)?.groups?.target
  if (typeof target === 'undefined') {
    return 0
  }
  return target === '' ? 2 : 1
}

/** A command's arguments without its redirections (`>out`, `2>&1`, `< in`), which the command never sees. */
const withoutRedirections = (words: readonly string[]) =>
  words.filter((word, at) => !redirection.test(word) && redirection.exec(words[at - 1] ?? '')?.groups?.target !== '')

/** Where the command itself starts: after variable assignments, keywords and redirections. */
const commandStart = (words: readonly string[]) => {
  let at = 0
  let length = leadingLength(words[0] ?? '')
  while (at < words.length && length > 0) {
    at += length
    length = leadingLength(words[at] ?? '')
  }
  return at
}

/** Where the command may start in a simple command: at its first word, and after a wrapper at any word. */
const startsOf = (command: readonly string[]) =>
  wrappers.has(baseName(command[0] ?? '')) ? command.map((_word, at) => at) : [0]

/** The command line `env -S '…'` (`--split-string`) splits and runs, if one is given. */
const envSplitString = (args: readonly string[]) => {
  const at = args.findIndex(arg => /^(?:-[0iv]*S|--split-string)/u.test(arg))
  const attached = (args[at] ?? '').replace(/^(?:-[0iv]*S|--split-string)=?/u, '')
  if (at === -1) {
    return null
  }
  return attached === '' ? (args[at + 1] ?? null) : attached
}

/** The script a command runs as a command line of its own: of `bash -c '…'` (also `-lc`, `-ec`), `eval` or `env -S`. */
const innerScript = (words: readonly string[]) => {
  const [name = '', ...args] = words
  if (name === 'eval') {
    return args.join(' ')
  }
  if (baseName(name) === 'env') {
    return envSplitString(args)
  }
  const at = shell.test(baseName(name)) || scriptFlagRunners.has(baseName(name)) ? args.findIndex(arg => /^-[abd-z]*c[a-z]*$/u.test(arg)) : -1
  return at === -1 ? null : (args[at + 1] ?? null)
}

/** The texts of a simple command's here-strings, attached (`<<<x`) or the next word (`<<< x`). */
const hereStringsOf = (words: readonly string[]) =>
  words.flatMap((word, at) => {
    const text = hereString.exec(word)?.groups?.text
    if (typeof text === 'undefined') {
      return []
    }
    return [text === '' ? (words[at + 1] ?? '') : text]
  })

/** Whether a command may run what comes in on its input as commands: a shell, `source`, or a command the shell fills in. */
const readsScriptFromInput = ([name = '']: readonly string[]) =>
  shell.test(baseName(name)) || stdinRunners.has(baseName(name)) || isDynamic(name)

/**
 * Every simple command a command line runs, from its command word on, with the scripts of `bash -c` and
 * `eval` read too. When anything on the line may run its input as commands (`eval` and `env -S` too), every here-document and
 * here-string on it counts as commands, not only one on that command itself: pipes, groups and
 * `bash -c bash` hand input on in ways this reader doesn't follow (#382), and a false denial costs less than a missed write. Text the shell expands first may become any commands, so it counts as a command the shell fills in.
 */
const runCommands = (text: string, work: Work): string[][] => {
  const simple = commandsOf(text, work)
  const commands = simple
    .map(words => words.slice(commandStart(words)))
    .flatMap(command => startsOf(command).map(at => command.slice(at)))
  const fed = commands.some(command => readsScriptFromInput(command) || innerScript(command) !== null) ? simple.flatMap(words => hereStringsOf(words)) : []
  return [
    ...commands.flatMap(command => {
      const script = innerScript(command)
      return script === null ? [command] : runCommands(script, work)
    }),
    ...fed.flatMap(script => (isDynamic(script) ? [[script]] : runCommands(script, work))),
    ...programCommands(commands.map(command => withoutRedirections(command)), simple.flatMap(words => hereStringsOf(words))),
  ]
}

/**
 * Whether one command writes through plain gh, or may: a command word the shell fills in counts when
 * its arguments would be a gh write, or when it has none (`$SCRIPT`, or what `eval "$SCRIPT"` and
 * `bash -c "$SCRIPT"` run), as it may be a whole command line.
 */
const writes = ([name = '', ...words]: readonly string[]) => {
  const args = withoutRedirections(words)
  return (isGh(name) && ghWrites(args)) || (isDynamic(name) && (args.length === 0 || ghWrites(args))) || xargsFillsIn(name, args)
}

/** The first command in a Bash command line that writes to GitHub through plain `gh`, as its words joined, or null when there is none. */
export const ownerWrite = (command: string): string | null => {
  const found = runCommands(command, newWork()).find(words => writes(words))
  return found ? found.map(word => plainWord(word)).join(' ') : null
}

// --- The hook -------------------------------------------------------------------------------

/** What the PreToolUse hook answers for a command: a denial with its reason, or null to let it run. */
export const verdict = (input: unknown) => {
  const command = isRecord(input) && isRecord(input.tool_input) ? textOf(input.tool_input.command) : ''
  const found = ownerWrite(command)
  if (found === null) {
    return null
  }
  const reason = [
    `Refused (household-brain #368): \`${found}\` writes to GitHub through plain \`gh\`, the owner's own login, so it would act as the owner.`,
    'A command the guard cannot read for certain (a command, method or query the shell fills in, as in `"$METHOD"` or `query="$(cat q.graphql)"`, a here-document delimiter that mixes quoting, as in `<<E\'O\'F`, or `xargs gh` without its subcommand written out) counts as a write.',
    'Write through `agent-gh` (the bot) instead; reads with `gh` stay allowed.',
    'If agent-gh fails or is rate-limited, wait and retry it, or report it: never fall back to `gh`.',
    'Something only the owner may do, the owner runs themselves.',
  ].join(' ')
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
}

if (import.meta.main) {
  const answer = verdict(JSON.parse(await Bun.stdin.text()))
  if (answer !== null) {
    process.stdout.write(JSON.stringify(answer))
  }
}
