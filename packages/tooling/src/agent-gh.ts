// Gh as the agent bot, built into a Windows executable so Bun's shell (the household-brain watcher) can
// run it: the twin of the bash agent-gh, which explains the repository it picks. Gets the token from
// the agent-gh-token bash script and passes it to gh through GH_TOKEN. Without a token it stops
// before gh runs: gh would fall back to the owner's stored login and post as the owner (#358).
//
//   bun build --compile packages/tooling/src/agent-gh.ts --outfile ~/.local/bin/agent-gh.exe
import { spawnSync, which } from 'bun'

const args = process.argv.slice(2)

const repoOf = () => {
  const flag = args.findIndex(arg => arg === '-R' || arg === '--repo')
  const joined = args.find(arg => arg.startsWith('--repo='))
  if (flag !== -1) {
    return args[flag + 1] ?? ''
  }
  if (typeof joined === 'string') {
    return joined.slice('--repo='.length)
  }
  // An api call's endpoint: repos/<owner>/<repo>/…, with or without a leading slash.
  const [repos, owner = '', name = ''] = (args[0] === 'api' ? args[1] ?? '' : '').replace(/^\//u, '').split(/[/?]/u)
  return repos === 'repos' && owner !== '' && name !== '' ? `${owner}/${name}` : ''
}

const repo = repoOf()
const env = repo ? { ...process.env, GH_REPO: repo } : { ...process.env }
const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const bash = which('bash') ?? `${home}/scoop/apps/git/current/bin/bash.exe`
const minted = spawnSync([bash, `${home}/.local/bin/agent-gh-token`], { env, stderr: 'inherit' })
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
