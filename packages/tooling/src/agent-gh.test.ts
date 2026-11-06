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

const ghCall = () => {
  const file = path.join(home, 'gh-called')
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'agent-gh-'))
  bin = path.join(home, 'stubs')
  mkdirSync(bin)
  mkdirSync(path.join(home, '.local', 'bin'), { recursive: true })
  script(path.join(bin, 'gh'), 'echo -n "$GH_TOKEN|$*" > "$HOME/gh-called"')
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

  test('takes the repository from -R written together with its value', () => {
    tokenStub('echo bot-token')
    expect(run(wrapper, ['issue', 'list', '-ROwner/repo']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/repo')
  })

  test('finds an api endpoint after the flags', () => {
    tokenStub('echo bot-token')
    expect(run(wrapper, ['api', '-X', 'POST', '/repos/Owner/repo/issues', '-f', 'title=hi']).code).toBe(0)
    expect(readFileSync(path.join(home, 'token-repo'), 'utf8')).toBe('Owner/repo')
  })
})
