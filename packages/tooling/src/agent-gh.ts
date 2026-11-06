// Gh as the agent bot, built into a Windows executable so Bun's shell (the household-brain watcher) can
// run it: the twin of the bash agent-gh, which explains the repository it picks. Gets the token from
// the agent-gh-token bash script and passes it to gh through GH_TOKEN. Without a token it stops
// before gh runs: gh would fall back to the owner's stored login and post as the owner (#358).
//
//   bun build --compile packages/tooling/src/agent-gh.ts --outfile ~/.local/bin/agent-gh.exe
import { file, spawnSync, which } from 'bun'

const args = process.argv.slice(2)

// The repository -R/--repo names (the last one, as gh takes it), or null.
const flagRepo = (arg: string, next: string) => {
  if (arg === '-R' || arg === '--repo') {
    return next
  }
  if (arg.startsWith('--repo=')) {
    return arg.slice('--repo='.length)
  }
  return arg.startsWith('-R') ? arg.slice('-R'.length) : null
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

const repoOf = () => args.reduce<string | null>((found, arg, index) => flagRepo(arg, args[index + 1] ?? '') ?? found, null) ?? endpointRepo()

const repo = repoOf()
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
