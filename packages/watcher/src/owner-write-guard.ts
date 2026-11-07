/**
 * The guard against GitHub writes under the owner's own `gh` login (#368). Agents may read with plain
 * `gh` (only the owner's login sees the owner's pending reviews), but write only through `agent-gh`,
 * as the bot: a comment once fell back to `gh` when the bot was rate-limited, and posted as the owner
 * (`Coarisfinia/khovax#2136`). This is the plugin's PreToolUse hook on Bash (hooks/hooks.json): it
 * refuses a command that writes through plain `gh`, and lets everything else run.
 *
 * `ownerWrite` reads the command as a shell would, closely enough: every simple command of a
 * pipeline, list, group, subshell, `$(…)`, backticks, `bash -c '…'` or `eval`, with quotes and
 * escapes, and only the word in command position (after variable assignments and wrappers such as
 * `env` or `timeout`). A word naming `gh` (or a path ending in `/gh`) is the owner's login;
 * `agent-gh` never is.
 */
import { isRecord, textOf } from './read'
import { commandsOf, isDynamic, plainWord } from './shell-commands'

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

/**
 * Commands that run a command given in their arguments, after options that may take values
 * (`sudo -u x gh …`, `nice -n 10 gh …`). Their options aren't read: every later word counts as
 * where the command may start.
 */
const wrappers = new Set([
  'builtin', 'command', 'doas', 'env', 'exec', 'ionice', 'nice', 'nohup', 'setsid', 'stdbuf', 'sudo', 'time',
  'timeout', 'unbuffer', 'watch', 'xargs',
])

/** A redirection: its operator, and its target when attached (`>out`, `2>/dev/null`, `&>log`). */
const redirection = /^\d*(?:&>>?|>>?|<{1,3}|>&|<&|>\|)(?<target>.*)$/u

const shells = new Set(['bash', 'dash', 'sh', 'zsh'])

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

/** The arguments that are no flag, leaving out the value of `-R`/`--repo`, the one flag gh takes before the subcommand. */
const positionals = (args: readonly string[]) =>
  args.filter((arg, at) => !arg.startsWith('-') && args[at - 1] !== '-R' && args[at - 1] !== '--repo')

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

const isGh = (word: string) => /(?:^|[/\\])gh(?:\.exe)?$/u.test(word)

const baseName = (word: string) => word.replace(/^.*[/\\]/u, '')

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
  const at = shells.has(baseName(name)) ? args.findIndex(arg => /^-[abd-z]*c[a-z]*$/u.test(arg)) : -1
  return at === -1 ? null : (args[at + 1] ?? null)
}

/** Every simple command a command line runs, from its command word on, with the scripts of `bash -c` and `eval` read too. */
const runCommands = (text: string): string[][] =>
  commandsOf(text)
    .map(words => words.slice(commandStart(words)))
    .flatMap(command => startsOf(command).map(at => command.slice(at)))
    .flatMap(command => {
      const script = innerScript(command)
      return script === null ? [command] : runCommands(script)
    })

/**
 * Whether one command writes through plain gh, or may: a command word the shell fills in counts when
 * its arguments would be a gh write, or when it has none (`$SCRIPT`, or what `eval "$SCRIPT"` and
 * `bash -c "$SCRIPT"` run), as it may be a whole command line.
 */
const writes = ([name = '', ...words]: readonly string[]) => {
  const args = withoutRedirections(words)
  return (isGh(name) && ghWrites(args)) || (isDynamic(name) && (args.length === 0 || ghWrites(args)))
}

/** The first command in a Bash command line that writes to GitHub through plain `gh`, as its words joined, or null when there is none. */
export const ownerWrite = (command: string): string | null => {
  const found = runCommands(command).find(words => writes(words))
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
    'A command the guard cannot read for certain (a command, method or query the shell fills in, as in `"$METHOD"` or `query="$(cat q.graphql)"`) counts as a write.',
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
