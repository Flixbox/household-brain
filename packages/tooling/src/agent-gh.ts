// Gh as the agent bot, built into a Windows executable so Bun's shell (the household-brain watcher) can
// run it: the twin of the bash agent-gh, which explains the repository it picks. Gets the token from
// the agent-gh-token bash script and passes it to gh through GH_TOKEN. Without a token it stops
// before gh runs: gh would fall back to the owner's stored login and post as the owner (#358).
//
//   bun build --compile packages/tooling/src/agent-gh.ts --outfile ~/.local/bin/agent-gh.exe
import { file, spawnSync, which } from 'bun'

const args = process.argv.slice(2)

// The flags of the command gh would run, from gh's own `gh help <command>` (which prints help and
// never runs it), as agent-gh reads them (#361): whether each long flag and letter takes a value, and
// the letter of --repo. Only asked for when an argument looks like -R/--repo.
const flags = args.includes('--') ? args.slice(0, args.indexOf('--')) : args
const flagTable = () => {
  const long = new Map<string, boolean>()
  const short = new Map<string, boolean>()
  let repoLetter = ''
  if (!flags.some(arg => /^-[^-]*R|^--repo/u.test(arg))) {
    return { long, repoLetter, short }
  }
  const firstFlag = flags.findIndex(arg => arg.startsWith('-'))
  const command = firstFlag === -1 ? flags : flags.slice(0, firstFlag)
  const help = spawnSync(['gh', 'help', ...command], { stderr: 'ignore' }).stdout.toString()
  for (const line of help.split('\n')) {
    const match = /^\s+(?:-(\S), )?--([A-Za-z0-9-]+)(?: (\S+))?(?:\s{2,}|$)/u.exec(line)
    if (match) {
      const [, letter, name = '', type] = match
      // A value only when gh prints its type, and not an optional one (--name type[=default]).
      const takes = type !== undefined && !type.includes('[=')
      long.set(name, takes)
      if (letter !== undefined) {
        short.set(letter, takes)
        repoLetter = name === 'repo' ? letter : repoLetter
      }
    }
  }
  return { long, repoLetter, short }
}

// The repository a real -R/--repo names (the last one, as gh takes it), never another option's
// value such as --title '--repo=Owner/other' (#361), or null.
const flagRepo = () => {
  const { long, repoLetter, short } = flagTable()
  if (!long.has('repo')) {
    return null
  }
  let repo: string | null = null
  for (let index = 0; index < flags.length; index += 1) {
    const arg = flags[index] ?? ''
    if (arg.startsWith('--')) {
      const [name = '', ...value] = arg.slice(2).split('=')
      if (value.length > 0) {
        repo = name === 'repo' ? value.join('=') : repo
      } else if (long.get(name) === true) {
        index += 1
        repo = name === 'repo' ? (flags[index] ?? '') : repo
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Short flags, possibly bundled (-wR Owner/repo); one that takes a value takes the rest of
      // the argument (after an optional =), or else the next argument.
      const at = [...arg.slice(1)].findIndex(letter => short.get(letter) === true) + 1
      if (at > 0) {
        let value = arg.slice(at + 1).replace(/^=/u, '')
        if (arg.length === at + 1) {
          index += 1
          value = flags[index] ?? ''
        }
        repo = arg[at] === repoLetter ? value : repo
      }
    }
  }
  return repo
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
