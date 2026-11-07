// Gh as the agent bot, built into a Windows executable so Bun's shell (the household-brain watcher) can
// run it: the twin of the bash agent-gh, which explains the repository it picks. Gets the token from
// the agent-gh-token bash script and passes it to gh through GH_TOKEN. Without a token it stops
// before gh runs: gh would fall back to the owner's stored login and post as the owner (#358).
//
//   bun build --compile packages/tooling/src/agent-gh.ts --outfile ~/.local/bin/agent-gh.exe
import { file, spawnSync, which } from 'bun'

const args = process.argv.slice(2)

// Only a real -R/--repo counts, never another option's value such as --title '--repo=Owner/other'
// (#361): the arguments are read like gh reads them, as agent-gh does, with the command's flag table
// from gh's own `gh help <command>` (which prints help and never runs the command). gh takes nothing
// after -- as a flag.
const flags = args.includes('--') ? args.slice(0, args.indexOf('--')) : args

interface FlagTable {
  long: Map<string, boolean>
  repoLetter: string
  short: Map<string, boolean>
}

// One flag of gh's help, and whether it takes a value: only when gh prints its type, and not an
// optional one (--name type[=default]).
const flagLine = /^\s+(?:-(?<letter>\S), )?--(?<name>[A-Za-z0-9-]+)(?: (?<type>\S+))?(?:\s{2,}|$)/u
const flagOf = (line: string) => {
  const { letter = '', name = '', type = '' } = flagLine.exec(line)?.groups ?? {}
  return name === '' ? [] : [{ letter, name, takes: type !== '' && !type.includes('[=') }]
}

// The flag table of the command the arguments name.
const loadFlags = (command: string[]): FlagTable => {
  const help = spawnSync(['gh', 'help', ...command], { stderr: 'ignore' }).stdout.toString()
  const entries = help.split('\n').flatMap(line => flagOf(line))
  return {
    long: new Map(entries.map(entry => [entry.name, entry.takes])),
    repoLetter: entries.find(entry => entry.name === 'repo')?.letter ?? '',
    short: new Map(entries.filter(entry => entry.letter !== '').map(entry => [entry.letter, entry.takes])),
  }
}

// What one argument does, read with the table: the repository it names, if it is -R/--repo, and how
// many of the following arguments it takes. With `lookup`, it is read as cobra does to find the
// command: a flag the table doesn't know (one of the subcommand's) takes the next argument unless it
// is bundled or has its value attached.
interface Step {
  repo: string | null
  skip: number
}

interface Reading {
  lookup: boolean
  table: FlagTable
}

const longStep = ({ lookup, table }: Reading, arg: string, next: string): Step => {
  const [name = '', ...value] = arg.slice(2).split('=')
  if (value.length > 0) {
    return { repo: name === 'repo' ? value.join('=') : null, skip: 0 }
  }
  const takes = name === 'repo' || (table.long.get(name) ?? lookup)
  return { repo: name === 'repo' ? next : null, skip: takes ? 1 : 0 }
}

// Short flags, possibly bundled (-wR Owner/repo); one that takes a value takes the rest of the
// argument (after an optional =), or else the next argument.
const shortStep = ({ lookup, table }: Reading, arg: string, next: string): Step => {
  const letters = arg.slice(1).split('')
  if (lookup && letters.length === 1 && !table.short.has(arg.slice(1))) {
    return { repo: null, skip: 1 }
  }
  const at = letters.findIndex(letter => table.short.get(letter) === true)
  const rest = arg.slice(at + 2)
  const value = rest === '' ? next : rest.replace(/^=/u, '')
  const repo = at !== -1 && letters[at] === table.repoLetter ? value : null
  return { repo, skip: at !== -1 && rest === '' ? 1 : 0 }
}

const stepOf = (reading: Reading, arg: string, next: string): Step | null => {
  if (arg.startsWith('--')) {
    return longStep(reading, arg, next)
  }
  return arg.startsWith('-') && arg.length > 1 ? shortStep(reading, arg, next) : null
}

// The repository a real -R/--repo names (the last one, as gh takes it), and the arguments that are
// no flag or flag value.
const readArgs = (reading: Reading) => {
  let repo: string | null = null
  const positional: string[] = []
  for (let index = 0; index < flags.length; index += 1) {
    const arg = flags[index] ?? ''
    const step = stepOf(reading, arg, flags[index + 1] ?? '')
    positional.push(...(step ? [] : [arg]))
    repo = step?.repo ?? repo
    index += step?.skip ?? 0
  }
  return { positional, repo }
}

// The table is only asked for when an argument looks like -R/--repo. The command is first taken as
// the leading words. A flag before its last word (gh -R x issue create) belongs to it or a parent, so
// the arguments read with that table name the command.
const flagRepo = () => {
  if (!flags.some(arg => /^-[^-]*R|^--repo/u.test(arg))) {
    return null
  }
  const firstFlag = flags.findIndex(arg => arg.startsWith('-'))
  const command = firstFlag === -1 ? flags : flags.slice(0, firstFlag)
  const group = loadFlags(command)
  const found = readArgs({ lookup: true, table: group })
  const leaf = found.positional.length > command.length ? loadFlags(found.positional) : group
  const read = leaf === group ? found : readArgs({ lookup: false, table: leaf })
  return leaf.long.has('repo') ? read.repo : null
}

// An api call's endpoint, repos/<owner>/<repo>/…, with or without a leading slash, wherever it is
// among the call's flags.
const endpointRepo = () => {
  for (const arg of args[0] === 'api' ? args.slice(1) : []) {
    const [repos, owner = '', name = ''] = arg.replace(/^\//u, '').split(/[/?]/u)
    if (repos === 'repos' && owner !== '' && name !== '') {
      return `${owner}/${name}`
    }
  }
  return ''
}

const repo = flagRepo() ?? endpointRepo()
const env = repo ? { ...process.env, GH_REPO: repo } : { ...process.env }
const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const bash = which('bash') ?? `${home}/scoop/apps/git/current/bin/bash.exe`
// The agent-gh-token beside the executable (where install-agent-gh.sh puts both), else in ~/.local/bin.
const beside = process.execPath.replace(/[^\\/]+$/u, 'agent-gh-token')
const helper = (await file(beside).exists()) ? beside : `${home}/.local/bin/agent-gh-token`
const minted = spawnSync([bash, helper], { env, stderr: 'inherit' })
const token = minted.stdout.toString().trim()
if (minted.exitCode !== 0) {
  process.stderr.write('agent-gh: agent-gh-token failed, so gh does not run (it would act as your own login)\n')
  process.exitCode = 1
} else if (token === '') {
  process.stderr.write('agent-gh: agent-gh-token printed no token, so gh does not run (it would act as your own login)\n')
  process.exitCode = 1
} else {
  const gh = spawnSync(['gh', ...args], { env: { ...env, GH_TOKEN: token }, stdio: ['inherit', 'inherit', 'inherit'] })
  process.exitCode = gh.exitCode
}
