// Gh as the agent bot, built into a Windows executable so Bun's shell (the household-brain watcher) can run it.
// Gets the token from the agent-gh-token bash script and passes it to gh through GH_TOKEN.
import { spawnSync, which } from 'bun'

const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const bash = which('bash') ?? `${home}/scoop/apps/git/current/bin/bash.exe`
const minted = spawnSync([bash, `${home}/.local/bin/agent-gh-token`], { stderr: 'inherit' })
if (minted.exitCode === 0) {
  const gh = spawnSync(['gh', ...process.argv.slice(2)], {
    env: { ...process.env, GH_TOKEN: minted.stdout.toString().trim() },
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  process.exitCode = gh.exitCode
} else {
  process.exitCode = minted.exitCode
}
