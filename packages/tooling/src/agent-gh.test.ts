/* oxlint-disable import/no-nodejs-modules -- stubs of agent-gh-token and gh in a temporary home; node:fs, node:os and node:path are built into Bun */
// The agent-gh wrappers (bash, and agent-gh.ts for Windows) must never run gh without the bot's token:
// gh would fall back to the owner's stored login and post as the owner (#358). Both run here against
// stubs of agent-gh-token and gh, so no key, token or network is involved.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let home = ''
let bin = ''

const script = (file: string, body: string) => {
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(file, 0o755)
}

// The token stub records which repository it was asked for, then does what `body` says. agent-gh
// finds it on the PATH, agent-gh.ts in ~/.local/bin.
const tokenStub = (body: string) => {
  for (const file of [path.join(bin, 'agent-gh-token'), path.join(home, '.local', 'bin', 'agent-gh-token')]) {
    script(file, `echo -n "$GH_REPO" > "$HOME/token-repo"\n${body}`)
  }
}

const wrappers = {
  bash: [path.join(import.meta.dir, 'agent-gh')],
  windows: [process.execPath, path.join(import.meta.dir, 'agent-gh.ts')],
}

const run = (wrapper: keyof typeof wrappers, args: string[]) => {
  const env = { HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` }
  const result = Bun.spawnSync([...wrappers[wrapper], ...args], { cwd: home, env })
  return { code: result.exitCode, stderr: result.stderr.toString() }
}

// The gh stub answers `gh help <command>` with a flag table in gh's own format, as gh's levels have
// them: the root none, a group (gh issue) only -R, a command its own flags and -R, api no -R. It
// records every other call.
const ghStub = `if [[ $1 == help ]]; then
  if [[ $2 == api ]]; then
    printf 'FLAGS\\n  -X, --method string          The HTTP method for the request\\n  -f, --raw-field key=value    Add a string parameter\\n'
    exit 0
  fi
  if [[ $# -ge 3 ]]; then
    printf 'FLAGS\\n  -t, --title string   Supply a title\\n  -w, --web            Open the browser\\n\\n'
  fi
  if [[ $# -ge 2 ]]; then
    printf 'INHERITED FLAGS\\n      --help                     Show help for command\\n'
    printf '  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format\\n'
  fi
  exit 0
fi
echo -n "$GH_TOKEN|$*" > "$HOME/gh-called"`

const ghCall = () => {
  const file = path.join(home, 'gh-called')
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'agent-gh-'))
  bin = path.join(home, 'stubs')
  mkdirSync(bin)
  mkdirSync(path.join(home, '.local', 'bin'), { recursive: true })
  script(path.join(bin, 'gh'), ghStub)
})

afterEach(() => {
  rmSync(home, { force: true, recursive: true })
})

describe.each(['bash', 'windows'] as const)('agent-gh (%s)', wrapper => {
  test('a failing agent-gh-token stops it before gh runs', () => {
    tokenStub('echo "agent-gh-token: no token here" >&2\nexit 1')
    const { code, stderr } = run(wrapper, ['issue', 'list'])
    expect(code).not.toBe(0)
    expect(ghCall()).toBeNull()
    expect(stderr).toContain('agent-gh: ')
  })

  test('an empty token stops it before gh runs', () => {
    tokenStub('exit 0')
    const { code, stderr } = run(wrapper, ['issue', 'list'])
    expect(code).not.toBe(0)
    expect(ghCall()).toBeNull()
    expect(stderr).toContain('agent-gh: ')
  })

  test('runs gh with the token of the repository -R names', () => {
    tokenStub('echo bot-token')
    expect(run(wrapper, ['-R', 'Owner/repo', 'issue', 'list']).code).toBe(0)
    expect(ghCall()).toBe('bot-token|-R Owner/repo issue list')
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/repo')
  })

  test('an api call asks for the token of the repository in its path', () => {
    tokenStub('echo bot-token')
    expect(run(wrapper, ['api', 'repos/Owner/repo/issues/7/comments', '-f', 'body=hi']).code).toBe(0)
    expect(ghCall()).toBe('bot-token|api repos/Owner/repo/issues/7/comments -f body=hi')
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/repo')
  })

  test('takes no repository from another option\'s value or from after --', () => {
    tokenStub('echo bot-token')
    expect(run(wrapper, ['issue', 'create', '--title', '-ROwner/other', '--', '-R', 'Owner/other']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('')
  })

  test('takes no repository from a value that looks like -R or --repo (#361)', () => {
    tokenStub('echo bot-token')
    expect(run(wrapper, ['issue', 'create', '--title', '--repo=Owner/other']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('')
    expect(run(wrapper, ['issue', 'create', '--title', '-R', 'Owner/other']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('')
  })

  test('takes the repository of a real -R after a flag without a value, or bundled (#361)', () => {
    tokenStub('echo bot-token')
    expect(run(wrapper, ['issue', 'create', '--web', '-R', 'Owner/repo']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/repo')
    expect(run(wrapper, ['issue', 'create', '--title', 'hi', '-wR', 'Owner/bundled']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/bundled')
    expect(run(wrapper, ['issue', 'create', '--repo=Owner/attached']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/attached')
    expect(run(wrapper, ['issue', 'view', '123', '-R', 'Owner/after-number']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/after-number')
  })

  test('reads a value that looks like -R with the command\'s flags when -R comes before the command', () => {
    tokenStub('echo bot-token')
    expect(run(wrapper, ['issue', '-R', 'Owner/repo', 'create', '--title', '--repo=Owner/other']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/repo')
    expect(run(wrapper, ['-R', 'Owner/repo', 'issue', 'create', '--title', '-R', 'Owner/other']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/repo')
  })

  test('finds an api endpoint after the flags', () => {
    tokenStub('echo bot-token')
    expect(run(wrapper, ['api', '-X', 'POST', '/repos/Owner/repo/issues', '-f', 'title=hi']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/repo')
  })
})

const tokenScript = path.join(import.meta.dir, 'agent-gh-token')

const mint = (repo: string) => {
  const env = { GH_REPO: repo, HOME: home, LC_ALL: 'C.UTF-8', PATH: `${bin}:${process.env.PATH ?? ''}` }
  const result = Bun.spawnSync([tokenScript], { cwd: home, env })
  return { code: result.exitCode, stderr: result.stderr.toString(), stdout: result.stdout.toString() }
}

describe('agent-gh-token owner (#538)', () => {
  // A token cached under each spelling, so the owner decides the outcome without any key or network.
  const cached = (repo: string, token: string) => {
    const folder = path.join(home, '.cache', 'agent-gh')
    mkdirSync(folder, { recursive: true })
    writeFileSync(path.join(folder, repo), `${token}\n`)
  }

  test.each([
    ['Flixbox/repo', 'flixbox-token'],
    ['flixbox/repo', 'flixbox-token'],
    ['FLIXBOX/repo', 'flixbox-token'],
    ['Coarisfinia/repo', 'coarisfinia-token'],
    ['coarisfinia/repo', 'coarisfinia-token'],
    ['COARISFINIA/repo', 'coarisfinia-token'],
  ])('%s gets its bot', (repo, token) => {
    cached('Flixbox_repo', 'flixbox-token')
    cached('Coarisfinia_repo', 'coarisfinia-token')
    expect(mint(repo)).toMatchObject({ code: 0, stdout: `${token}\n` })
  })

  // A cached token under the exact spelling must not rescue an owner without a bot.
  test.each(['someone', 'flixbox-other', 'xflixbox', 'Fl\u0130xbox'])('%s has no bot', owner => {
    cached(`${owner}_repo`, 'wrong-token')
    cached('Flixbox_repo', 'flixbox-token')
    const { code, stderr, stdout } = mint(`${owner}/repo`)
    expect(code).not.toBe(0)
    expect(stdout).toBe('')
    expect(stderr).toContain(`no agent bot for ${owner}/repo`)
  })
})

describe('agent-gh-token request time limit (#542)', () => {
  // The curl stub answers both requests like GitHub, except that call number `timesOutOn` runs out of
  // time as curl does (exit 28, no output), if it was given a limit. Without one it answers, as a
  // request that hangs would never time out. openssl is a stub too, so no key is involved.
  const stubRequests = (timesOutOn: number) => {
    script(path.join(bin, 'openssl'), 'cat > /dev/null\nprintf signature')
    script(path.join(bin, 'curl'), `echo "$*" >> "$HOME/curl-calls"
call=$(wc -l < "$HOME/curl-calls")
if [[ $call == ${timesOutOn} && " $* " == *" --max-time "* ]]; then
  exit 28
fi
cat > /dev/null
if [[ $call == 1 ]]; then echo '{"id":7}'; else echo '{"token":"minted-token"}'; fi`)
    const conf = path.join(home, '.config', 'household-brain-agent')
    mkdirSync(conf, { recursive: true })
    writeFileSync(path.join(conf, 'app-id'), '1\n')
  }

  const curlCalls = () => readFileSync(path.join(home, 'curl-calls'), 'utf8').trim().split('\n')
  const cachedToken = () => path.join(home, '.cache', 'agent-gh', 'Flixbox_repo')

  test('both requests have a time limit, and a token still comes through', () => {
    stubRequests(0)
    expect(mint('Flixbox/repo')).toMatchObject({ code: 0, stdout: 'minted-token\n' })
    const calls = curlCalls()
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call).toMatch(/--max-time \d+/u)
    }
  })

  test.each([
    ['the installation lookup', 1],
    ['the token request', 2],
  ])('%s timing out fails with no token on stdout', (_name, timesOutOn) => {
    stubRequests(timesOutOn)
    const { code, stdout } = mint('Flixbox/repo')
    expect(code).not.toBe(0)
    expect(stdout).toBe('')
    expect(existsSync(cachedToken())).toBe(false)
    expect(curlCalls()).toHaveLength(timesOutOn)
  })
})
