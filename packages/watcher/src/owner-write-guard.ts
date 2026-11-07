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
import { commandsOf } from './shell-commands'

/** `gh pr` and `gh issue` subcommands that change something on GitHub. */
const prIssueWrites = new Set([
  'close', 'comment', 'create', 'delete', 'develop', 'edit', 'lock', 'merge', 'pin', 'ready', 'reopen',
  'revert', 'review', 'transfer', 'unlock', 'unpin', 'update-branch',
])

const writeMethods = new Set(['DELETE', 'PATCH', 'POST', 'PUT'])

/** `gh api` flags that send a field, so the call is a POST unless a method says otherwise. */
const fieldFlags = new Set(['--field', '--raw-field', '-F', '-f'])

const methodFlags = new Set(['--method', '-X'])

/** Words before the command itself: shell keywords, and wrappers that run the words after them. */
const leadingWords = new Set([
  '!', 'builtin', 'command', 'do', 'elif', 'else', 'env', 'exec', 'if', 'nice', 'nohup', 'sudo', 'then',
  'time', 'timeout', 'until', 'while', 'xargs', '{', '}',
])

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
  return arg.length > 2 ? [arg.slice(0, 2), arg.slice(2).replace(/^=/u, '')] : [arg, null]
}

const takesValue = (name: string) => methodFlags.has(name) || fieldFlags.has(name) || name === '--input'

const record = (flags: ApiFlags, name: string, value: string) => {
  if (methodFlags.has(name)) {
    flags.method = value.toUpperCase()
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

/**
 * Whether a `gh api` call writes: a write method, or, without a method, fields or a body (gh then
 * POSTs). A GraphQL call is always a POST, and writes when it sends a mutation, or a query this
 * can't read (from a file or the body).
 */
const apiWrites = (args: readonly string[]) => {
  const flags = apiFlagsOf(args)
  if (args.includes('graphql')) {
    return flags.input || flags.fields.some(field => /\bmutation\b/u.test(field) || field.startsWith('query=@'))
  }
  if (flags.method !== null) {
    return writeMethods.has(flags.method)
  }
  return flags.input || flags.fields.length > 0
}

/** The arguments that are no flag, leaving out the value of `-R`/`--repo`, the one flag gh takes before the subcommand. */
const positionals = (args: readonly string[]) =>
  args.filter((arg, at) => !arg.startsWith('-') && args[at - 1] !== '-R' && args[at - 1] !== '--repo')

/** Whether `gh` with these arguments changes something on GitHub. */
const ghWrites = (args: readonly string[]) => {
  const [group = '', subcommand = ''] = positionals(args)
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

/** Where the command itself starts: after variable assignments, keywords, wrappers and their options. */
const commandStart = (words: readonly string[]) => {
  const at = words.findIndex(word =>
    !/^[A-Za-z_]\w*=/u.test(word) && !leadingWords.has(word) && !word.startsWith('-') && !/^\d+[smhd]?$/u.test(word))
  return at === -1 ? words.length : at
}

/** The script a command runs as a command line of its own: of `bash -c '…'` (also `-lc`, `-ec`), or of `eval`. */
const innerScript = (words: readonly string[]) => {
  const [name = '', ...args] = words
  if (name === 'eval') {
    return args.join(' ')
  }
  const at = shells.has(baseName(name)) ? args.findIndex(arg => /^-[abd-z]*c[a-z]*$/u.test(arg)) : -1
  return at === -1 ? null : (args[at + 1] ?? null)
}

/** Every simple command a command line runs, from its command word on, with the scripts of `bash -c` and `eval` read too. */
const runCommands = (text: string): string[][] =>
  commandsOf(text).flatMap(words => {
    const command = words.slice(commandStart(words))
    const script = innerScript(command)
    return script === null ? [command] : runCommands(script)
  })

/** The first command in a Bash command line that writes to GitHub through plain `gh`, as its words joined, or null when there is none. */
export const ownerWrite = (command: string): string | null => {
  const found = runCommands(command).find(([name = '', ...args]) => isGh(name) && ghWrites(args))
  return found ? found.join(' ') : null
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
